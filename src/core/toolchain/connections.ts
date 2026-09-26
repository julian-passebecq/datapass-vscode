/**
 * Connections (manifest v5): what must be signed in or bound for a project to work, and the
 * read-only checks DataPass may run without a prompt. Pure; the runner lives in
 * src/work/connectionChecks.ts.
 *
 *   sign-in           a CLI signed in: `az account show` (tenant and subscription against the ID
 *                     map), `databricks auth profiles` (the profile exists and is valid) and
 *                     `fab auth status` (signed in, tenant). Other tools: declared, not checked.
 *   git-binding       a Fabric workspace (or Databricks Git folder) connected to a repository
 *                     folder and branch. DataPass cannot observe it: "declared, not checked", with
 *                     the portal page where it can be verified.
 *   cloud-connection  a connection object in the service (a Fabric data connection…): declared,
 *                     not checked, with its portal page.
 *
 * Credential files are never opened: not .databrickscfg, not the Azure CLI's profile or token
 * cache, not the Fabric CLI's. Each official CLI reads its own files; DataPass reads only what the
 * CLI prints, keeps a few fields (signed in or not, the tenant and subscription ids, profile names
 * and validity) and drops the rest, including the masked token prefixes `fab auth status` prints
 * and the account name. No manifest value is ever passed to a CLI as an argument.
 */
import { scrub } from "../exchange/aiContext";
import { vetRelativePath } from "../exchange/pathSafety";
import { safeAppUrl } from "../model/safeUrl";
import type { IdentifierDecl } from "../readiness/readiness";
import { TOOL_ID } from "./toolchain";
import { observed, unknown, type EvidenceLink } from "../evidence/chain";

export const MAX_CONNECTIONS = 30;
const ID_RE = /^[a-z][a-z0-9_.-]{0,79}$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A Databricks profile NAME (a section of the CLI's own config file), never a path. */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;

export type ConnectionKind = "sign-in" | "git-binding" | "cloud-connection";
export const CONNECTION_KINDS: readonly ConnectionKind[] = ["sign-in", "git-binding", "cloud-connection"];

export interface ConnectionDecl {
  id: string;
  kind: ConnectionKind;
  label?: string;
  /** sign-in: the tool signed in (cli.az, cli.databricks, cli.fab…). */
  tool?: string;
  /** An ID map id: the tenant for az / fab sign-ins, the workspace for a git binding. */
  identifier?: string;
  /** az sign-in: the ID map id of the subscription `az account show` should be set to. */
  subscription?: string;
  /** databricks sign-in: the profile name in the Databricks CLI's configuration. */
  profile?: string;
  /** The environment this connection is for (declared in environments). */
  environment?: string;
  /** git-binding / cloud-connection: fabric, databricks, azure, powerbi… */
  provider?: string;
  /** git-binding: repository key, folder and branch the workspace is connected to. */
  repoRef?: string;
  folder?: string;
  branch?: string;
  /** cloud-connection: its display name in the service (never a connection string). */
  name?: string;
  /** Page where the person verifies it (https). */
  portal?: string;
}

/** Sign-in tools DataPass can check read-only, and the fixed command each runs (nothing from the manifest). */
export const SIGN_IN_CHECKS = {
  "cli.az": { args: ["account", "show", "--output", "json"], text: "az account show" },
  "cli.databricks": { args: ["auth", "profiles", "--output", "json"], text: "databricks auth profiles" },
  "cli.fab": { args: ["auth", "status"], text: "fab auth status" }
} as const;
export type CheckedTool = keyof typeof SIGN_IN_CHECKS;
export const isCheckedTool = (t: string | undefined): t is CheckedTool => !!t && Object.prototype.hasOwnProperty.call(SIGN_IN_CHECKS, t);

/** Validate `connections` (v5) against the declared identifiers, environments and repositories. */
export function validateConnections(doc: Record<string, unknown>, repoKeys: ReadonlySet<string>): string[] {
  if (doc.connections === undefined) return [];
  if (!Array.isArray(doc.connections) || doc.connections.length > MAX_CONNECTIONS) return [`connections must be an array of at most ${MAX_CONNECTIONS}.`];
  const issues: string[] = [];
  const idents = new Map<string, { kind?: unknown; envs?: string[] }>();
  if (Array.isArray(doc.identifiers)) for (const d of doc.identifiers as Array<Record<string, unknown> | null>) {
    if (d && typeof d.id === "string") idents.set(d.id, { kind: d.kind, envs: d.values && typeof d.values === "object" && !Array.isArray(d.values) ? Object.keys(d.values) : undefined });
  }
  const envs = new Set(Array.isArray(doc.environments) ? (doc.environments as Array<Record<string, unknown> | null>).map(e => e?.id).filter((x): x is string => typeof x === "string") : []);
  const seen = new Set<string>();
  doc.connections.forEach((raw, i) => {
    const at = `connections[${i}]`;
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || Array.isArray(c)) { issues.push(`${at} must be an object.`); return; }
    if (typeof c.id !== "string" || !ID_RE.test(c.id)) issues.push(`${at}.id is required (lowercase id).`);
    else if (seen.has(c.id)) issues.push(`${at}.id "${c.id}" is duplicated.`);
    else seen.add(c.id);
    if (!CONNECTION_KINDS.includes(c.kind as ConnectionKind)) { issues.push(`${at}.kind must be sign-in, git-binding or cloud-connection.`); return; }
    const kind = c.kind as ConnectionKind;
    if (c.label !== undefined && (typeof c.label !== "string" || !c.label.trim() || c.label.length > 120)) issues.push(`${at}.label must be a non-empty string (at most 120).`);
    const only = (field: string, allowed: boolean, why: string) => { if (c[field] !== undefined && !allowed) issues.push(`${at}.${field} ${why}.`); };
    only("tool", kind === "sign-in", "only applies to a sign-in");
    only("subscription", kind === "sign-in" && c.tool === "cli.az", "only applies to an Azure CLI sign-in (cli.az)");
    only("profile", kind === "sign-in" && c.tool === "cli.databricks", "only applies to a Databricks CLI sign-in (cli.databricks)");
    for (const f of ["repoRef", "folder", "branch"]) only(f, kind === "git-binding", "only applies to a git-binding");
    only("name", kind === "cloud-connection", "only applies to a cloud-connection");
    only("provider", kind !== "sign-in", "does not apply to a sign-in (the tool says where)");
    if (kind === "sign-in" && (typeof c.tool !== "string" || !TOOL_ID.test(c.tool))) issues.push(`${at}.tool is required for a sign-in (e.g. cli.az, cli.databricks, cli.fab).`);
    if (kind !== "sign-in" && (typeof c.provider !== "string" || !ID_RE.test(c.provider))) issues.push(`${at}.provider is required (lowercase id, e.g. fabric).`);
    const ref = (field: "identifier" | "subscription", wantKind?: string) => {
      const v = c[field];
      if (v === undefined) return;
      if (typeof v !== "string" || !idents.has(v)) { issues.push(`${at}.${field} must name a declared identifier (identifiers[].id).`); return; }
      const { kind: k, envs: valueEnvs } = idents.get(v)!;
      if (wantKind && k !== undefined && k !== wantKind) issues.push(`${at}.${field} names identifier "${v}" of kind ${String(k)}; ${wantKind} expected.`);
      // One value per environment: the connection must say which one, and that one must exist.
      if (valueEnvs && typeof c.environment === "string" && !valueEnvs.includes(c.environment)) issues.push(`${at}.${field} names identifier "${v}", which has no value for environment "${c.environment}".`);
      else if (valueEnvs && valueEnvs.length > 1 && c.environment === undefined) issues.push(`${at} needs an environment: identifier "${v}" has one value per environment (${valueEnvs.join(", ")}).`);
    };
    ref("identifier", kind === "sign-in" && (c.tool === "cli.az" || c.tool === "cli.fab") ? "tenant" : undefined);
    ref("subscription", "subscription");
    if (c.profile !== undefined && (typeof c.profile !== "string" || !PROFILE_NAME.test(c.profile))) issues.push(`${at}.profile must be a profile name (letters, digits, . _ -), never a path.`);
    if (c.environment !== undefined && (typeof c.environment !== "string" || !envs.has(c.environment))) issues.push(`${at}.environment must name a declared environment.`);
    if (c.repoRef !== undefined && (typeof c.repoRef !== "string" || !repoKeys.has(c.repoRef))) issues.push(`${at}.repoRef must name a declared repository.`);
    if (c.folder !== undefined && (typeof c.folder !== "string" || c.folder.length > 200 || !vetRelativePath(c.folder.replace(/\/+$/, "")).ok)) issues.push(`${at}.folder must be a relative folder inside the repository (omit it for the repository root).`);
    if (c.branch !== undefined && (typeof c.branch !== "string" || !BRANCH.test(c.branch) || c.branch.includes(".."))) issues.push(`${at}.branch is not a valid branch name.`);
    if (c.name !== undefined) {
      if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 200) issues.push(`${at}.name must be a non-empty string (at most 200).`);
      else if (scrub(c.name) !== c.name || /[=;]/.test(c.name)) issues.push(`${at}.name looks like a connection string or a credential; give the connection's display name only.`);
    }
    if (kind === "cloud-connection" && c.name === undefined) issues.push(`${at}.name is required for a cloud-connection (its display name in the service).`);
    if (c.portal !== undefined && (typeof c.portal !== "string" || !safeAppUrl(c.portal) || !/^https:\/\//i.test(c.portal))) issues.push(`${at}.portal must be an https:// page without credentials.`);
  });
  return issues;
}

// ------------------------------------------------------------------ what a CLI printed (kept to a few fields)

export type ConnectionOutcome = "ok" | "not-installed" | "failed" | "timeout";
export interface ConnectionProbe {
  tool: CheckedTool;
  ranAt: string;
  outcome: ConnectionOutcome;
  /** Short reason written by DataPass (never the CLI's own text). */
  reason?: string;
  signedIn?: boolean;
  tenantId?: string;
  subscriptionId?: string;
  profiles?: Array<{ name: string; valid: boolean }>;
}

/** What a runner returns for one command. The text never leaves the parsers below. */
export interface CommandResult { ok: boolean; code?: number | null; stdout: string; stderr: string; notFound?: boolean; timedOut?: boolean }

const guid = (v: unknown) => typeof v === "string" && GUID.test(v) ? v.toLowerCase() : undefined;

/** `az account show --output json`: signed in, tenant id and subscription id only. */
export function parseAzAccount(r: CommandResult, ranAt: string): ConnectionProbe {
  const base = { tool: "cli.az" as const, ranAt };
  if (r.notFound) return { ...base, outcome: "not-installed" };
  if (r.timedOut) return { ...base, outcome: "timeout", reason: "az account show did not answer in time" };
  if (!r.ok) {
    // "Please run 'az login' to setup account." (exit 1): the CLI has no current account.
    if (/az login/i.test(r.stderr)) return { ...base, outcome: "ok", signedIn: false };
    return { ...base, outcome: "failed", reason: `az account show failed${typeof r.code === "number" ? ` (exit code ${r.code})` : ""}` };
  }
  try {
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    const tenantId = guid(doc.tenantId), subscriptionId = guid(doc.id);
    if (!tenantId && !subscriptionId) return { ...base, outcome: "failed", reason: "az account show printed no account" };
    return { ...base, outcome: "ok", signedIn: true, tenantId, subscriptionId };
  } catch {
    return { ...base, outcome: "failed", reason: "az account show printed something DataPass does not recognise" };
  }
}

/** `databricks auth profiles --output json`: each profile's name and whether the CLI could use it. */
export function parseDatabricksProfiles(r: CommandResult, ranAt: string): ConnectionProbe {
  const base = { tool: "cli.databricks" as const, ranAt };
  if (r.notFound) return { ...base, outcome: "not-installed" };
  if (r.timedOut) return { ...base, outcome: "timeout", reason: "databricks auth profiles did not answer in time (it contacts each workspace)" };
  if (!r.ok) return { ...base, outcome: "failed", reason: `databricks auth profiles failed${typeof r.code === "number" ? ` (exit code ${r.code})` : ""}` };
  try {
    const doc = JSON.parse(r.stdout) as { profiles?: unknown };
    if (!Array.isArray(doc.profiles)) return { ...base, outcome: "failed", reason: "databricks auth profiles printed no profile list" };
    const profiles = (doc.profiles as Array<Record<string, unknown> | null>)
      .filter((p): p is Record<string, unknown> => !!p && typeof p.name === "string" && PROFILE_NAME.test(p.name))
      .slice(0, 100).map(p => ({ name: p.name as string, valid: p.valid === true }));
    return { ...base, outcome: "ok", profiles, signedIn: profiles.some(p => p.valid) };
  } catch {
    return { ...base, outcome: "failed", reason: "databricks auth profiles printed something DataPass does not recognise" };
  }
}

/**
 * `fab auth status`: "✓ Logged in to …" / "✗ Not logged in to …", then "Key: value" lines. Only
 * "Logged In" and "Tenant ID" are read; the account, principal and app ids and the masked token
 * prefixes are ignored.
 */
export function parseFabStatus(r: CommandResult, ranAt: string): ConnectionProbe {
  const base = { tool: "cli.fab" as const, ranAt };
  if (r.notFound) return { ...base, outcome: "not-installed" };
  if (r.timedOut) return { ...base, outcome: "timeout", reason: "fab auth status did not answer in time" };
  const text = `${r.stdout}\n${r.stderr}`;
  const logged = /^\s*logged[ _]in\s*:\s*(true|false)\s*$/im.exec(text)?.[1]?.toLowerCase();
  const signedIn = logged ? logged === "true" : /not logged in/i.test(text) ? false : /logged in to/i.test(text) ? true : undefined;
  if (signedIn === undefined) return { ...base, outcome: "failed", reason: r.ok ? "fab auth status printed something DataPass does not recognise" : `fab auth status failed${typeof r.code === "number" ? ` (exit code ${r.code})` : ""}` };
  const tenantId = guid(/^\s*tenant[ _]id\s*:\s*(\S+)\s*$/im.exec(text)?.[1]);
  return { ...base, outcome: "ok", signedIn, tenantId: signedIn ? tenantId : undefined };
}

export function parseCheck(tool: CheckedTool, r: CommandResult, ranAt: string): ConnectionProbe {
  return tool === "cli.az" ? parseAzAccount(r, ranAt) : tool === "cli.databricks" ? parseDatabricksProfiles(r, ranAt) : parseFabStatus(r, ranAt);
}

// ------------------------------------------------------------------ view

export type ConnectionState =
  | "ok"             // checked: signed in as declared
  | "mismatch"       // checked: signed in, but to another tenant or subscription
  | "signed-out"     // checked: not signed in
  | "profile-missing" | "profile-invalid"
  | "tool-missing"   // the CLI is not installed
  | "check-failed"   // the check ran and failed (reason from DataPass)
  | "not-checked-yet"
  | "declared";      // DataPass cannot observe it: declared, not checked

export interface ConnectionView {
  id: string;
  kind: ConnectionKind;
  label: string;
  tool?: string;
  environment?: string;
  provider?: string;
  state: ConnectionState;
  /** One line, names only (identifier labels, profile names), never a value. */
  detail: string;
  /** What to do next, when something is needed. Commands are shown to copy, never run. */
  nextStep?: string;
  /**
   * A sign-in command can be copied (signInCommand() builds it from the manifest at click time: the
   * view itself holds no value, not even a non-secret tenant id).
   */
  signIn?: SignInAction;
  /** A page to verify it exists (portalFor() builds it from the manifest at click time). */
  hasPortal?: boolean;
  /** Where to click on that page. */
  portalHint?: string;
  checkedAt?: string;
  /** git-binding: the folder in the local clone, when DataPass could look. */
  folderState?: "found" | "missing" | "not-cloned";
}

export type SignInAction = "az-login" | "az-subscription" | "databricks-create" | "databricks-login" | "fab-login";

export interface ConnectionsInput {
  connections?: ConnectionDecl[];
  identifiers?: IdentifierDecl[];
  probes: ReadonlyMap<string, ConnectionProbe>;
  /** Tools present on this computer (from the probes). */
  present: (tool: string) => boolean | undefined;
  /** git-binding folders observed in local clones, by connection id. */
  bindingFolders?: ReadonlyMap<string, "found" | "missing" | "not-cloned">;
}

/** The identifier's value for an environment (a per-environment value, else the single value). */
export function identifierValue(d: IdentifierDecl | undefined, environment?: string): string | undefined {
  if (!d) return undefined;
  if (d.values) return environment ? d.values[environment] : Object.keys(d.values).length === 1 ? Object.values(d.values)[0] : undefined;
  return d.value;
}

const FABRIC_CONNECTIONS_DOCS = "https://learn.microsoft.com/fabric/data-factory/data-source-management";

/** A default page to verify a declared connection. Only well-known service addresses. */
export function portalFor(c: ConnectionDecl, identifiers: readonly IdentifierDecl[]): string | undefined {
  if (c.portal) return c.portal;
  const ident = identifiers.find(d => d.id === c.identifier);
  const value = identifierValue(ident, c.environment);
  if (c.kind === "git-binding" && c.provider === "fabric") return value && GUID.test(value) ? `https://app.fabric.microsoft.com/groups/${value.toLowerCase()}` : "https://app.fabric.microsoft.com/";
  if (c.kind === "git-binding" && c.provider === "databricks") return "https://learn.microsoft.com/azure/databricks/repos/";
  if (c.kind === "cloud-connection" && (c.provider === "fabric" || c.provider === "powerbi")) return FABRIC_CONNECTIONS_DOCS;
  if (c.provider === "azure") return "https://portal.azure.com/";
  return undefined;
}

const PORTAL_HINT: Partial<Record<string, string>> = {
  "git-binding:fabric": "Workspace settings → Git integration",
  "git-binding:databricks": "Workspace → the Git folder's menu → Git…",
  "cloud-connection:fabric": "Settings → Manage connections and gateways",
  "cloud-connection:powerbi": "Settings → Manage connections and gateways"
};

export function buildConnections(input: ConnectionsInput): ConnectionView[] {
  const idents = input.identifiers ?? [];
  const labelOf = (id?: string) => idents.find(d => d.id === id)?.label ?? id;
  return (input.connections ?? []).map((c): ConnectionView => {
    const label = c.label ?? c.id;
    const base = { id: c.id, kind: c.kind, label, tool: c.tool, environment: c.environment, provider: c.provider };
    const envText = c.environment ? ` (${c.environment})` : "";
    if (c.kind !== "sign-in") {
      const portal = portalFor(c, idents);
      const hint = PORTAL_HINT[`${c.kind}:${c.provider}`];
      const what = c.kind === "git-binding"
        ? `${labelOf(c.identifier) ?? c.provider} ↔ ${[c.repoRef, c.folder, c.branch && `branch ${c.branch}`].filter(Boolean).join(" · ") || "a repository"}${envText}`
        : `${c.provider} connection "${c.name}"${envText}`;
      const folderState = c.kind === "git-binding" ? input.bindingFolders?.get(c.id) : undefined;
      const folderNote = folderState === "missing" ? ` The folder ${c.folder} is not in the local clone.` : folderState === "found" ? ` The folder ${c.folder} is in the local clone.` : "";
      return { ...base, state: "declared", hasPortal: Boolean(portal), portalHint: hint, folderState,
        detail: `declared, not checked · ${what}`,
        nextStep: `DataPass cannot see this binding. Verify it in the portal${hint ? ` (${hint})` : ""}.${folderNote}` };
    }
    const tool = c.tool!;
    if (!isCheckedTool(tool)) return { ...base, state: "declared", detail: `declared, not checked · DataPass has no read-only check for ${tool}` };
    const check = SIGN_IN_CHECKS[tool];
    const probe = input.probes.get(tool);
    const present = input.present(tool);
    // A check that ran proves the CLI is installed, even if the (cached) tool probe said otherwise.
    if (probe?.outcome === "not-installed" || (present === false && !probe)) return { ...base, state: "tool-missing", detail: `${check.text.split(" ")[0]} is not installed here`, nextStep: "Install it (Tools & versions shows the command to copy), then check the connections again." };
    if (!probe) return { ...base, state: "not-checked-yet", detail: `not checked yet · Check connections runs ${check.text} (read-only, no prompt)` };
    const checkedAt = probe.ranAt;
    if (probe.outcome !== "ok") return { ...base, state: "check-failed", checkedAt, detail: probe.reason ?? `${check.text} failed` };
    const tenant = idents.find(d => d.id === c.identifier);
    const tenantValue = identifierValue(tenant, c.environment)?.toLowerCase();
    if (tool === "cli.az") {
      if (!probe.signedIn) return { ...base, state: "signed-out", checkedAt, detail: "the Azure CLI is not signed in", nextStep: `Sign in: ${tenantValue ? "az login --tenant <the tenant id from the ID map>" : "az login"} (copy it from here).`, signIn: "az-login" };
      if (tenant && tenantValue && probe.tenantId !== tenantValue) return { ...base, state: "mismatch", checkedAt, detail: `signed in to another tenant, not "${tenant.label}"`, nextStep: "Sign in to the project's tenant (copy the command from here).", signIn: "az-login" };
      const sub = idents.find(d => d.id === c.subscription);
      const subValue = identifierValue(sub, c.environment)?.toLowerCase();
      if (sub && subValue && probe.subscriptionId !== subValue) {
        return { ...base, state: "mismatch", checkedAt, detail: `signed in${tenant ? ` to "${tenant.label}"` : ""}, but the current subscription is not "${sub.label}"`, nextStep: "Select the project's subscription (copy the command from here).", signIn: "az-subscription" };
      }
      return { ...base, state: "ok", checkedAt, detail: ["signed in", tenant && tenantValue ? `tenant "${tenant.label}" ✓` : undefined, sub && subValue ? `subscription "${sub.label}" ✓` : undefined].filter(Boolean).join(" · ") };
    }
    if (tool === "cli.databricks") {
      const name = c.profile ?? "DEFAULT";
      const p = probe.profiles?.find(x => x.name === name);
      if (!p) return { ...base, state: "profile-missing", checkedAt, detail: `no profile "${name}" in the Databricks CLI`, nextStep: `Create it: databricks auth login --host <workspace URL> --profile ${name}`, signIn: "databricks-create" };
      if (!p.valid) return { ...base, state: "profile-invalid", checkedAt, detail: `profile "${name}" exists but could not be used (expired or wrong workspace)`, nextStep: `Sign in again: databricks auth login --profile ${name}`, signIn: "databricks-login" };
      return { ...base, state: "ok", checkedAt, detail: `profile "${name}" valid` };
    }
    // cli.fab
    if (!probe.signedIn) return { ...base, state: "signed-out", checkedAt, detail: "the Fabric CLI is not signed in", nextStep: "Sign in: fab auth login (copy it from here).", signIn: "fab-login" };
    if (tenant && tenantValue && probe.tenantId && probe.tenantId !== tenantValue) return { ...base, state: "mismatch", checkedAt, detail: `signed in to another tenant, not "${tenant.label}"`, nextStep: "Sign in to the project's tenant (copy the command from here).", signIn: "fab-login" };
    return { ...base, state: "ok", checkedAt, detail: ["signed in", tenant && tenantValue && probe.tenantId ? `tenant "${tenant.label}" ✓` : undefined].filter(Boolean).join(" · ") };
  });
}

export const CONNECTION_STATE_TEXT: Record<ConnectionState, string> = {
  "ok": "ok", "mismatch": "signed in elsewhere", "signed-out": "signed out", "profile-missing": "profile missing", "profile-invalid": "profile invalid",
  "tool-missing": "tool missing", "check-failed": "check failed", "not-checked-yet": "not checked yet", "declared": "declared, not checked"
};

/**
 * The sign-in command to copy for a connection. Built from the manifest when the person clicks:
 * it may carry the declared (non-secret) tenant or subscription id, so it is never part of a view.
 * DataPass copies it; the person runs it (a sign-in opens the browser, which DataPass never does).
 */
export function signInCommand(c: ConnectionDecl, identifiers: readonly IdentifierDecl[], action: SignInAction): string {
  const value = (id?: string) => identifierValue(identifiers.find(d => d.id === id), c.environment)?.toLowerCase();
  const tenant = value(c.identifier);
  const profile = c.profile ?? "DEFAULT";
  switch (action) {
    case "az-login": return `az login${tenant ? ` --tenant ${tenant}` : ""}`;
    case "az-subscription": return `az account set --subscription ${value(c.subscription) ?? "<subscription id>"}`;
    case "databricks-create": return `databricks auth login --host <workspace URL> --profile ${profile}`;
    case "databricks-login": return `databricks auth login --profile ${profile}`;
    case "fab-login": return `fab auth login${tenant ? ` --tenant ${tenant}` : ""}`;
  }
}

/** Tools to run for the declared sign-ins (at most one run per tool). */
export function toolsToCheck(connections: readonly ConnectionDecl[] | undefined): CheckedTool[] {
  return [...new Set((connections ?? []).filter(c => c.kind === "sign-in" && isCheckedTool(c.tool)).map(c => c.tool as CheckedTool))];
}

// ------------------------------------------------------------------ evidence (D-22)

/**
 * The "authenticated identity" link of a CLI's evidence chain, from the read-only sign-in check
 * the person ran (never from the CLI's own credential files). Declared sign-ins add whether the
 * identity is the declared tenant / subscription / profile; that is still not access to a target.
 */
export function signInEvidence(tool: CheckedTool, probe: ConnectionProbe | undefined, declared: readonly ConnectionView[] = []): EvidenceLink {
  const text = SIGN_IN_CHECKS[tool].text;
  if (!probe) return unknown("authenticated", declared.length
    ? `not checked yet: "Check connections" runs ${text} (read-only, no prompt)`
    : `no sign-in declared for it in connections; DataPass runs ${text} only for a declared sign-in`);
  if (probe.outcome === "not-installed") return unknown("authenticated", `${text} could not run: the CLI was not found`);
  if (probe.outcome !== "ok") return unknown("authenticated", probe.reason ?? `${text} failed`);
  const match = declared.find(c => c.state === "ok") ? "as declared" : declared.find(c => c.state === "mismatch" || c.state === "profile-missing" || c.state === "profile-invalid")?.detail;
  if (tool === "cli.databricks") {
    const valid = probe.profiles?.filter(p => p.valid).map(p => p.name) ?? [];
    return observed("authenticated", valid.length > 0, text, probe.ranAt, valid.length ? `valid profile(s): ${valid.slice(0, 5).join(", ")}${match ? ` · ${match}` : ""}` : "no valid profile");
  }
  return observed("authenticated", probe.signedIn === true, text, probe.ranAt, probe.signedIn ? match : undefined);
}
