/**
 * Environment readiness: which local env files and variable NAMES a project expects, which are
 * present on this machine, the non-secret identifiers it declares, the optional companions and a
 * list of deterministic consistency checks. Pure; the observer (src/work/envObserver.ts) supplies
 * what it saw on disk and in Git.
 *
 * Nothing here carries a value. An env file is reduced to `name → set | empty` by
 * envKeyPresence, and a declared identifier's value stays in the manifest: the view only says it
 * exists, and "Copy value" reads the manifest again. So everything built from a Readiness (tree,
 * Workbench, snapshot, preparation pack, AI context, report) holds names and states only.
 *
 * Secrets, tokens and passwords are never declared here: a variable without a declared
 * identifier is treated as a secret the person fetches from their local vault (Power Ops).
 * DataPass never guesses that a value is safe to show.
 *
 * 0.18 (manifest v5) adds the project's toolchain (tools and version ranges compared with the
 * probes), identifiers with a value per environment (the ID map) and connections (sign-ins checked
 * read-only on request; bindings DataPass cannot observe are "declared, not checked"). The same
 * rule holds: tool versions, identifier labels, environment names and connection states only.
 */
import { scrub } from "../exchange/aiContext";
import { vetRelativePath } from "../exchange/pathSafety";
import { moduleEnabled } from "../modules";
import type { DataPassProjectManifest } from "../projectManifestModel";
import type { MapProblem } from "../project/projectMap";
import type { RepoView } from "../project/resolve";
import { safeAppUrl } from "../model/safeUrl";
import { ENV_KEY_NAME, isEnvFileName, type KeyPresence } from "./envFile";
import type { ToolObservation } from "../capabilities/tools";
import { buildToolchain, toolStateText, validateToolchain, type ToolchainTool, type ToolchainView } from "../toolchain/toolchain";
import { compareExtensionsJson, extensionsJsonText, EXTENSIONS_JSON, type ExtensionsJsonObservation, type ExtensionsJsonView } from "../toolchain/extensionsJson";
import { buildConnections, CONNECTION_STATE_TEXT, validateConnections, type ConnectionProbe, type ConnectionView } from "../toolchain/connections";

export const MAX_ENV_FILES = 10;
export const MAX_REQUIRED_KEYS = 100;
export const MAX_IDENTIFIERS = 50;
export const MAX_IDENTIFIER_ENVIRONMENTS = 20;
const ID_RE = /^[a-z][a-z0-9_.-]{0,79}$/;
/** Identifier values: plain ids (hex, GUIDs, slugs, numeric ids). No URL, no `=`, no whitespace. */
const IDENTIFIER_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/**
 * Names that denote a credential or something carrying one (URIs and DSNs embed passwords). An
 * identifier may not use them; a required key with such a name is always shown as a vault secret.
 */
const SECRET_NAME = /password|passwd|secret|token|api_?key|private|credential|conn(?:ection)?_?str|(?:^|_)(?:pass|pwd|key|sas|sig|signature|cookie|session|uri|url|dsn)(?:_|$)/i;

// ------------------------------------------------------------------ manifest declarations (v4)

export interface EnvFileDecl {
  /** Path inside the repository (default: the project's own folder). */
  path: string;
  /** Repository key; omitted = the repository holding the manifest. */
  repoRef?: string;
  /** An optional file (e.g. .env.local) is reported, never as a problem when absent. */
  optional?: boolean;
}

export interface LocalEnvDecl {
  /** Env files a developer needs locally; a string is shorthand for `{ path }`. */
  files: Array<string | EnvFileDecl>;
  /** Variable NAMES the project needs. Values are never declared or read. */
  requiredKeys?: string[];
}

export interface IdentifierDecl {
  id: string;
  label: string;
  /** Explicitly non-secret value (account, subscription, workspace or project id). Exactly one of value / values. */
  value?: string;
  /** v5: one non-secret value per declared environment (the ID map): { "dev": "…", "prod": "…" }. */
  values?: Record<string, string>;
  provider?: string;
  /** v5: what the id is (tenant, subscription, workspace, capacity, lakehouse…). */
  kind?: string;
  /** The env variable this identifier fills, when there is one. */
  envKey?: string;
}

export const normalizeEnvFile = (f: string | EnvFileDecl): EnvFileDecl => typeof f === "string" ? { path: f } : f;
export const envFileId = (f: EnvFileDecl) => `${f.repoRef ?? ""}:${f.path}`;
export const looksSecretName = (name: string) => SECRET_NAME.test(name);

/**
 * Validate `localEnv` and `identifiers` (v4), and `toolchain`, `connections` and per-environment
 * identifier `values` (v5). Values are checked for shape only, never echoed.
 */
export function validateReadinessSections(doc: Record<string, unknown>, repoKeys: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const v4 = typeof doc.schemaVersion === "number" && doc.schemaVersion >= 4;
  const v5 = typeof doc.schemaVersion === "number" && doc.schemaVersion >= 5;
  for (const key of ["localEnv", "identifiers"]) if (doc[key] !== undefined && !v4) issues.push(`${key} requires schemaVersion 4.`);
  for (const key of ["toolchain", "connections"]) if (doc[key] !== undefined && !v5) issues.push(`${key} requires schemaVersion 5.`);
  if (v5) issues.push(...validateToolchain(doc), ...validateConnections(doc, repoKeys));
  const envIds = new Set(Array.isArray(doc.environments) ? (doc.environments as Array<Record<string, unknown> | null>).map(e => e?.id).filter((x): x is string => typeof x === "string") : []);
  if (doc.localEnv !== undefined) {
    const e = doc.localEnv as Record<string, unknown> | null;
    if (!e || typeof e !== "object" || Array.isArray(e)) issues.push("localEnv must be an object with files and requiredKeys.");
    else {
      if (!Array.isArray(e.files) || !e.files.length || e.files.length > MAX_ENV_FILES) issues.push(`localEnv.files must list 1 to ${MAX_ENV_FILES} env files.`);
      else {
        const seen = new Set<string>();
        e.files.forEach((raw, i) => {
          const at = `localEnv.files[${i}]`;
          const f = typeof raw === "string" ? { path: raw } : raw as Record<string, unknown> | null;
          if (!f || typeof f !== "object" || Array.isArray(f)) { issues.push(`${at} must be a path or an object with path.`); return; }
          if (typeof f.path !== "string" || f.path.length > 200 || !vetRelativePath(f.path).ok) { issues.push(`${at}.path must be a relative path inside the repository.`); return; }
          if (!isEnvFileName(f.path)) issues.push(`${at}.path must name an env file (.env, .env.<name>, <name>.env or .dev.vars); DataPass reads nothing else for variable names.`);
          if (f.repoRef !== undefined && (typeof f.repoRef !== "string" || !repoKeys.has(f.repoRef))) issues.push(`${at}.repoRef must name a declared repository.`);
          if (f.optional !== undefined && typeof f.optional !== "boolean") issues.push(`${at}.optional must be true or false.`);
          const id = `${typeof f.repoRef === "string" ? f.repoRef : ""}:${f.path}`;
          if (seen.has(id)) issues.push(`${at} is listed twice.`);
          seen.add(id);
        });
      }
      if (e.requiredKeys !== undefined) {
        if (!Array.isArray(e.requiredKeys) || e.requiredKeys.length > MAX_REQUIRED_KEYS) issues.push(`localEnv.requiredKeys must be an array of at most ${MAX_REQUIRED_KEYS} names.`);
        else {
          const seen = new Set<string>();
          e.requiredKeys.forEach((k, i) => {
            if (typeof k !== "string" || !ENV_KEY_NAME.test(k)) issues.push(`localEnv.requiredKeys[${i}] must be a variable name (letters, digits and _, not starting with a digit).`);
            else if (seen.has(k)) issues.push(`localEnv.requiredKeys[${i}] "${k}" is listed twice.`);
            else seen.add(k);
          });
        }
      }
    }
  }
  if (doc.identifiers !== undefined) {
    if (!Array.isArray(doc.identifiers) || doc.identifiers.length > MAX_IDENTIFIERS) issues.push(`identifiers must be an array of at most ${MAX_IDENTIFIERS}.`);
    else {
      const ids = new Set<string>(), envKeys = new Set<string>();
      doc.identifiers.forEach((raw, i) => {
        const at = `identifiers[${i}]`;
        const d = raw as Record<string, unknown> | null;
        if (!d || typeof d !== "object" || Array.isArray(d)) { issues.push(`${at} must be an object.`); return; }
        if (typeof d.id !== "string" || !ID_RE.test(d.id)) issues.push(`${at}.id is required (lowercase id).`);
        else if (ids.has(d.id)) issues.push(`${at}.id "${d.id}" is duplicated.`);
        else ids.add(d.id);
        if (typeof d.label !== "string" || !d.label.trim() || d.label.length > 120) issues.push(`${at}.label is required (at most 120 characters).`);
        if (d.provider !== undefined && (typeof d.provider !== "string" || !ID_RE.test(d.provider))) issues.push(`${at}.provider must be a lowercase id (e.g. cloudflare).`);
        if (d.kind !== undefined && (!v5 || typeof d.kind !== "string" || !ID_RE.test(d.kind))) issues.push(v5 ? `${at}.kind must be a lowercase id (e.g. tenant, subscription, workspace).` : `${at}.kind requires schemaVersion 5.`);
        // A value is never echoed in a message: it may be a secret pasted by mistake.
        const checkValue = (v: unknown, where: string) => {
          if (typeof v !== "string" || !IDENTIFIER_VALUE.test(v)) issues.push(`${where} must be a plain identifier (letters, digits, . _ : -, at most 128 characters).`);
          else if (scrub(v) !== v) issues.push(`${where} looks like a credential. Keep secrets in your local vault (Power Ops), never in the manifest.`);
        };
        if (d.values !== undefined && !v5) issues.push(`${at}.values requires schemaVersion 5.`);
        else if (d.values !== undefined) {
          if (d.value !== undefined) issues.push(`${at} has both value and values; use value for one id, values for one id per environment.`);
          const vals = d.values as Record<string, unknown> | null;
          if (!vals || typeof vals !== "object" || Array.isArray(vals) || !Object.keys(vals).length || Object.keys(vals).length > MAX_IDENTIFIER_ENVIRONMENTS) issues.push(`${at}.values must map 1 to ${MAX_IDENTIFIER_ENVIRONMENTS} declared environments to their id.`);
          else for (const [env, v] of Object.entries(vals)) {
            // Environment names are declared ids, so they are safe to name; the value is not.
            const envName = ID_RE.test(env) ? env : "?";
            if (!envIds.has(env)) issues.push(`${at}.values names environment "${envName}", which environments does not declare.`);
            checkValue(v, `${at}.values.${envName}`);
          }
        } else checkValue(d.value, `${at}.value`);
        const secretLabel = [d.id, d.label].some(v => typeof v === "string" && looksSecretName(v.replace(/[\s.:-]+/g, "_")));
        if (secretLabel) issues.push(`${at} is named like a secret (key, token, password, URL…). identifiers holds non-secret ids only; keep secrets in your local vault (Power Ops).`);
        if (d.envKey !== undefined) {
          if (typeof d.envKey !== "string" || !ENV_KEY_NAME.test(d.envKey)) issues.push(`${at}.envKey must be a variable name.`);
          else if (looksSecretName(d.envKey)) issues.push(`${at}.envKey "${d.envKey}" names a secret (key, token, password, URL…); only non-secret ids can be declared.`);
          else if (envKeys.has(d.envKey)) issues.push(`${at}.envKey "${d.envKey}" is already filled by another identifier.`);
          else envKeys.add(d.envKey);
        }
      });
    }
  }
  return issues;
}

// ------------------------------------------------------------------ observation (from the observer)

export type EnvFileState = "found" | "missing" | "not-cloned" | "unreadable" | "too-large" | "not-checked";
/** Git status of an env file: it should be ignored, never tracked. */
export type EnvFileGit = "ignored" | "tracked" | "not-ignored" | "unknown";

export interface EnvFileObservation {
  state: EnvFileState;
  /** Presence of the declared names only (never values, never undeclared names). */
  presence?: ReadonlyMap<string, KeyPresence>;
  git?: EnvFileGit;
  /** Short reason for unreadable / not-checked states (no content). */
  reason?: string;
}

// ------------------------------------------------------------------ view

export interface EnvFileView {
  id: string; path: string; repoKey?: string; repoLabel?: string; optional: boolean;
  state: EnvFileState; git: EnvFileGit; reason?: string;
  /** Declared keys this file defines (set or empty). */
  keysDefined: number;
}
export type EnvKeyState = "set" | "empty" | "missing" | "not-checked";
export interface EnvKeyView {
  name: string; state: EnvKeyState;
  /** Paths of the files defining it (last one wins, like dotenv). */
  definedIn: string[];
  /** "identifier": a non-secret id declared in the manifest fills it; "vault": treat as a secret. */
  source: "identifier" | "vault";
  identifierId?: string;
  identifierLabel?: string;
}
export interface IdentifierView {
  id: string; label: string; provider?: string; kind?: string; envKey?: string;
  /** Environments with their own value (v5 `values`); empty for a single `value`. Names only. */
  environments: string[];
}
export type CompanionState = "disabled" | "not-configured" | "needs-url" | "configured";
export interface CompanionView { module: "mongoku" | "diagramcloud"; label: string; state: CompanionState; detail: string }
export interface RepoReadiness {
  key: string; label: string; state: RepoView["state"]; branch?: string; expectedBranch?: string; head?: string;
  changes?: number; ahead?: number; behind?: number; upstream: boolean;
}
export type CheckSeverity = "error" | "warning" | "info";
export type CheckArea = "environment" | "companion" | "manifest" | "repository" | "tools" | "connection";
export interface ReadinessCheck { id: string; severity: CheckSeverity; area: CheckArea; message: string; nextStep?: string }

export interface Readiness {
  /** The manifest declares localEnv (v4). */
  declared: boolean;
  schemaVersion?: number;
  files: EnvFileView[];
  keys: EnvKeyView[];
  identifiers: IdentifierView[];
  companions: CompanionView[];
  repositories: RepoReadiness[];
  /** v5: declared tools compared with this computer's probes. */
  toolchain: ToolchainView;
  /** v5: .vscode/extensions.json compared with the toolchain's extensions. */
  extensions: ExtensionsJsonView;
  /** v5: declared sign-ins and bindings with their state (names and states only). */
  connections: ConnectionView[];
  checks: ReadinessCheck[];
  summary: { keysSet: number; keysTotal: number; filesFound: number; filesRequired: number; errors: number; warnings: number; infos: number };
}

export interface ReadinessInput {
  manifest?: DataPassProjectManifest;
  coordinationKey: string;
  /** Observations keyed by envFileId. */
  envFiles: ReadonlyMap<string, EnvFileObservation>;
  repositories: readonly RepoView[];
  problems: readonly MapProblem[];
  settings: { mongokuUrl?: string; diagramCloudUrl?: string };
  /** .datapass/diagramcloud.json exists in the project. */
  diagramCloudSidecar: boolean;
  latestSchemaVersion: number;
  /** v5: this computer's tool probes, and the platform (for install commands). */
  tools?: ReadonlyMap<string, ToolObservation>;
  platform?: NodeJS.Platform | string;
  /** 0.21: tools the hub's toolkit describes, so a toolchain may name them (never probed). */
  hubTools?: ReadonlyMap<string, ToolchainTool>;
  /** v5: the last read-only sign-in checks (only run when the person asks), by tool id. */
  connectionProbes?: ReadonlyMap<string, ConnectionProbe>;
  /** v5: the coordination repository's .vscode/extensions.json. */
  extensionsJson?: ExtensionsJsonObservation;
  /** v5: git-binding folders seen in local clones, by connection id. */
  bindingFolders?: ReadonlyMap<string, "found" | "missing" | "not-cloned">;
}

const VAULT_STEP = "Fetch the value from your local vault (Power Ops) and put it in the env file. DataPass never reads, stores or shows values.";

export function buildReadiness(input: ReadinessInput): Readiness {
  const m = input.manifest;
  const checks: ReadinessCheck[] = [];
  const add = (c: ReadinessCheck) => { if (checks.length < 200) checks.push(c); };
  const repoLabel = (key?: string) => key ? input.repositories.find(r => r.key === key)?.label ?? key : undefined;

  // Env files and keys.
  const decl = m?.localEnv;
  const files: EnvFileView[] = (decl?.files ?? []).map(normalizeEnvFile).map(f => {
    const id = envFileId(f);
    const obs = input.envFiles.get(id);
    const state = obs?.state ?? "not-checked";
    const keysDefined = obs?.presence ? obs.presence.size : 0;
    return { id, path: f.path, repoKey: f.repoRef, repoLabel: repoLabel(f.repoRef), optional: f.optional === true, state, git: obs?.git ?? "unknown", reason: obs?.reason, keysDefined };
  });
  const identifiers: IdentifierView[] = (m?.identifiers ?? []).map(d => ({ id: d.id, label: d.label, provider: d.provider, kind: d.kind, envKey: d.envKey, environments: d.values ? Object.keys(d.values) : [] }));
  const byEnvKey = new Map(identifiers.filter(d => d.envKey).map(d => [d.envKey!, d]));
  const anyChecked = files.some(f => f.state === "found" || f.state === "missing");
  const keys: EnvKeyView[] = (decl?.requiredKeys ?? []).map(name => {
    let state: EnvKeyState = anyChecked ? "missing" : "not-checked";
    const definedIn: string[] = [];
    for (const f of files) {
      const p = input.envFiles.get(f.id)?.presence?.get(name);
      if (!p) continue;
      definedIn.push(f.path);
      state = p;   // the last file wins, like dotenv loading .env then .env.local
    }
    const ident = byEnvKey.get(name);
    return { name, state, definedIn, source: ident ? "identifier" : "vault", identifierId: ident?.id, identifierLabel: ident?.label };
  });

  for (const f of files) {
    const where = f.repoKey ? `${f.path} (${f.repoLabel})` : f.path;
    if (f.state === "missing" && !f.optional) add({ id: `env.file.missing:${f.id}`, severity: "warning", area: "environment", message: `${where} is missing.`, nextStep: `Create ${f.path} (it must stay out of Git) and fill it from your local vault (Power Ops).` });
    else if (f.state === "missing") add({ id: `env.file.optional:${f.id}`, severity: "info", area: "environment", message: `${where} (optional) is not present.` });
    else if (f.state === "not-cloned") add({ id: `env.file.notcloned:${f.id}`, severity: "info", area: "environment", message: `${where} not checked: the repository is not cloned here.` });
    else if (f.state === "unreadable" || f.state === "too-large") add({ id: `env.file.unreadable:${f.id}`, severity: "warning", area: "environment", message: `${where} could not be checked${f.reason ? `: ${f.reason}` : ""}.` });
    if (f.state === "found" && f.git === "tracked") add({ id: `env.file.tracked:${f.id}`, severity: "error", area: "environment", message: `${where} is committed to Git: its values may be exposed.`, nextStep: `Remove it from Git (git rm --cached ${f.path}), add it to .gitignore and rotate the values it held.` });
    else if (f.state === "found" && f.git === "not-ignored") add({ id: `env.file.notignored:${f.id}`, severity: "warning", area: "environment", message: `${where} is not ignored by Git and could be committed by mistake.`, nextStep: `Add ${f.path} to .gitignore.` });
  }
  for (const k of keys) {
    if (k.state === "missing") add({ id: `env.key.missing:${k.name}`, severity: "warning", area: "environment", message: `${k.name} is not set in any expected env file.`, nextStep: k.source === "identifier" ? `It is the non-secret id "${k.identifierLabel}" declared in the manifest: copy it from DataPass into the env file.` : VAULT_STEP });
    else if (k.state === "empty") add({ id: `env.key.empty:${k.name}`, severity: "warning", area: "environment", message: `${k.name} is empty in ${k.definedIn[k.definedIn.length - 1]}.`, nextStep: k.source === "identifier" ? `Copy the declared id "${k.identifierLabel}" from DataPass.` : VAULT_STEP });
  }

  // Optional companions: a disabled module yields exactly one "optional module disabled" row and nothing else.
  const companions: CompanionView[] = [];
  if (!moduleEnabled(m, "mongoku")) companions.push({ module: "mongoku", label: "Mongoku", state: "disabled", detail: "optional module disabled" });
  else {
    const mapped = Boolean(m?.companions?.mongoku);
    const url = safeAppUrl(input.settings.mongokuUrl?.trim());
    // Frozen (0.16): Mongoku reads the project's files from GitHub; nothing to configure in DataPass.
    if (!mapped) companions.push({ module: "mongoku", label: "Mongoku", state: "not-configured", detail: "frozen · reads board.json and project.json from GitHub, no link with DataPass" });
    else if (!url) {
      companions.push({ module: "mongoku", label: "Mongoku", state: "needs-url", detail: "mapped · address not set" });
      add({ id: "companion.mongoku.url", severity: "info", area: "companion", message: "Mongoku is mapped for this project, but its address (datapass.mongoku.url) is not set.", nextStep: "Run \"DataPass: Set Mongoku Address…\"." });
    } else companions.push({ module: "mongoku", label: "Mongoku", state: "configured", detail: "mapped · address set" });
  }
  if (!moduleEnabled(m, "diagramcloud")) companions.push({ module: "diagramcloud", label: "DiagramCloud", state: "disabled", detail: "optional module disabled" });
  else {
    const url = safeAppUrl(input.settings.diagramCloudUrl?.trim());
    if (!input.diagramCloudSidecar) companions.push({ module: "diagramcloud", label: "DiagramCloud", state: "not-configured", detail: "optional · no .datapass/diagramcloud.json" });
    else if (!url) {
      companions.push({ module: "diagramcloud", label: "DiagramCloud", state: "needs-url", detail: "architecture file present · address not set" });
      add({ id: "companion.diagramcloud.url", severity: "info", area: "companion", message: "The project has .datapass/diagramcloud.json, but the DiagramCloud address (datapass.diagramCloud.url) is not set.", nextStep: "Run \"Open Architecture in DiagramCloud\" once to set it." });
    } else companions.push({ module: "diagramcloud", label: "DiagramCloud", state: "configured", detail: "architecture file present · address set" });
  }

  // v5: tools & versions, extensions.json, connections.
  const tools = input.tools ?? new Map<string, ToolObservation>();
  const toolchain = buildToolchain({ toolchain: m?.toolchain, tools, platform: input.platform ?? "linux", hubTools: input.hubTools });
  for (const e of toolchain.entries) {
    const at = `${e.label}${e.where !== "local" ? ` (${e.where})` : ""}`;
    const install = e.install?.command ? `Install it: ${e.install.command}${e.install.where ? ` in ${e.install.where}` : ""} (copy it from DataPass; DataPass installs nothing).` : e.install?.docs ? `Install it from ${e.install.docs}.` : undefined;
    if (e.state === "unknown-tool") add({ id: `tools.unknown:${e.tool}`, severity: "warning", area: "tools", message: `toolchain names "${e.tool}", a tool DataPass does not know: nothing is checked for it.`, nextStep: e.suggestions?.length ? `Check the id in .datapass/project.json (did you mean ${e.suggestions.join(", ")}?).` : "Check the id in .datapass/project.json (docs/PREPARING_A_PROJECT.md lists the known ids)." });
    else if (e.state === "missing") add({ id: `tools.missing:${e.tool}`, severity: e.optional ? "info" : "warning", area: "tools", message: `${at} is ${e.optional ? "optional and " : ""}not installed here${e.range ? ` (the project needs ${e.range})` : ""}.`, nextStep: install });
    else if (e.state === "outside-range") add({ id: `tools.range:${e.tool}`, severity: e.optional ? "info" : "warning", area: "tools", message: `${at} ${e.version} is outside the project's range ${e.range}.`, nextStep: `Update it${e.install?.command ? ` (${e.install.command} installs the current version)` : ""}, or ask for the range to change in .datapass/project.json.` });
    else if (e.state === "version-unknown") add({ id: `tools.version:${e.tool}`, severity: "info", area: "tools", message: `${at} is installed, but DataPass could not read its version to compare with ${e.range}.` });
  }
  const extensions = compareExtensionsJson(m?.toolchain, input.extensionsJson);
  if (extensions.state === "invalid") add({ id: "tools.extensionsJson.invalid", severity: "warning", area: "tools", message: `${EXTENSIONS_JSON} could not be read: ${extensions.reason}.` });
  else if (extensions.state !== "no-toolchain") {
    const notRecommended = extensions.expected.filter(x => !x.recommended && !x.optional);
    if (notRecommended.length) add({ id: "tools.extensionsJson.missing", severity: "info", area: "tools", message: `${EXTENSIONS_JSON} ${extensions.state === "absent" ? "does not exist, so VS Code recommends none of" : "does not recommend"} ${notRecommended.map(x => x.extensionId).join(", ")} from the toolchain.`, nextStep: "Ask the AI to keep .vscode/extensions.json in line with the toolchain (DataPass never writes it)." });
    for (const x of extensions.expected.filter(y => y.unwanted)) add({ id: `tools.extensionsJson.unwanted:${x.tool}`, severity: "warning", area: "tools", message: `${EXTENSIONS_JSON} lists ${x.extensionId} as unwanted, but the toolchain needs ${x.label}.` });
  }
  const connections = buildConnections({
    connections: m?.connections, identifiers: m?.identifiers, probes: input.connectionProbes ?? new Map(),
    present: tool => { const o = tools.get(tool); return o ? o.state === "present" : undefined; }, bindingFolders: input.bindingFolders
  });
  for (const c of connections) {
    const attention = c.state === "mismatch" || c.state === "signed-out" || c.state === "profile-missing" || c.state === "profile-invalid" || c.state === "tool-missing" || c.state === "check-failed";
    if (attention) add({ id: `connection.${c.state}:${c.id}`, severity: "warning", area: "connection", message: `${c.label}: ${c.detail}.`, nextStep: c.nextStep });
    if (c.folderState === "missing") add({ id: `connection.folder:${c.id}`, severity: "info", area: "connection", message: `${c.label}: the bound folder is not in the local clone.` });
  }

  // Manifest consistency.
  if (m && m.schemaVersion < input.latestSchemaVersion) add({ id: "manifest.version", severity: "info", area: "manifest", message: `The manifest is schemaVersion ${m.schemaVersion}; v${input.latestSchemaVersion} can declare ${m.schemaVersion < 4 ? "env files, variable names, non-secret ids, " : ""}the tools and versions the project needs, ids per environment and connections.`, nextStep: "Run \"DataPass: Upgrade Project Manifest\" (a backup copy is kept)." });
  if (m && m.schemaVersion >= 4 && !decl) add({ id: "manifest.localEnv", severity: "info", area: "manifest", message: "No localEnv declared: DataPass cannot tell which env files and variables this project needs." });
  if (m && m.schemaVersion >= 5 && !m.toolchain) add({ id: "manifest.toolchain", severity: "info", area: "manifest", message: "No toolchain declared: DataPass cannot tell which tools and versions this project needs." });
  for (const d of identifiers) {
    if (d.envKey && !(decl?.requiredKeys ?? []).includes(d.envKey)) add({ id: `manifest.identifier.unused:${d.id}`, severity: "info", area: "manifest", message: `Identifier "${d.label}" fills ${d.envKey}, which localEnv.requiredKeys does not list.` });
  }
  const serious = input.problems.filter(p => p.severity !== "info");
  if (serious.length) {
    const errors = serious.filter(p => p.severity === "error").length;
    add({ id: "manifest.problems", severity: errors ? "error" : "warning", area: "manifest", message: `${serious.length} problem(s) in the project files (${errors} error(s)).`, nextStep: "See \"Problems in project files\" in the Project view." });
  }

  // Repository branch / head state.
  const repositories: RepoReadiness[] = input.repositories.map(r => ({
    key: r.key, label: r.label, state: r.state, branch: r.git?.branch, expectedBranch: r.branch, head: r.git?.head?.slice(0, 7),
    changes: r.git?.changes, ahead: r.git?.ahead, behind: r.git?.behind, upstream: Boolean(r.git?.upstream)
  }));
  for (const r of repositories) {
    const id = (what: string) => `repo.${what}:${r.key}`;
    if (r.state === "missing" || r.state === "wrong-remote") add({ id: id(r.state), severity: "error", area: "repository", message: `${r.label}: ${r.state === "missing" ? "not found where the manifest says" : "the folder is a clone of another repository"}.` });
    else if (r.state === "unbound") add({ id: id("unbound"), severity: "info", area: "repository", message: `${r.label} is not cloned on this machine.` });
    else if (r.state === "not-a-repo") add({ id: id("nogit"), severity: "warning", area: "repository", message: `${r.label}: the folder is not a Git repository.` });
    else if (r.state === "restricted") add({ id: id("restricted"), severity: "info", area: "repository", message: `${r.label}: Git state not read (Restricted Mode).` });
    if (r.state !== "local") continue;
    if (r.branch === "(detached)") add({ id: id("detached"), severity: "warning", area: "repository", message: `${r.label} is on a detached HEAD${r.head ? ` at ${r.head}` : ""}.`, nextStep: "Check out a branch before working in it." });
    else if (r.expectedBranch && r.branch && r.branch !== r.expectedBranch) add({ id: id("branch"), severity: "warning", area: "repository", message: `${r.label} is on branch ${r.branch}; the project expects ${r.expectedBranch}.` });
    if (!r.head) add({ id: id("nocommit"), severity: "info", area: "repository", message: `${r.label} has no commit yet.` });
    if (r.head && !r.upstream && r.branch !== "(detached)") add({ id: id("upstream"), severity: "info", area: "repository", message: `${r.label}: branch ${r.branch ?? "?"} has no upstream.` });
    if (r.behind) add({ id: id("behind"), severity: "info", area: "repository", message: `${r.label}: ${r.behind} commit(s) to get (as of the last check).` });
    if (r.ahead) add({ id: id("ahead"), severity: "info", area: "repository", message: `${r.label}: ${r.ahead} local commit(s) not pushed.` });
    if (r.changes) add({ id: id("changes"), severity: "info", area: "repository", message: `${r.label}: ${r.changes} uncommitted change(s).` });
  }

  const rank: Record<CheckSeverity, number> = { error: 0, warning: 1, info: 2 };
  checks.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return {
    declared: Boolean(decl), schemaVersion: m?.schemaVersion, files, keys, identifiers, companions, repositories, toolchain, extensions, connections, checks,
    summary: {
      keysSet: keys.filter(k => k.state === "set").length, keysTotal: keys.length,
      filesFound: files.filter(f => f.state === "found").length, filesRequired: files.filter(f => !f.optional).length,
      errors: checks.filter(c => c.severity === "error").length, warnings: checks.filter(c => c.severity === "warning").length, infos: checks.filter(c => c.severity === "info").length
    }
  };
}

/** One line per state, for trees and reports. */
export function keyStateText(k: EnvKeyView): string {
  const where = k.definedIn.length ? ` in ${k.definedIn[k.definedIn.length - 1]}` : "";
  switch (k.state) {
    case "set": return `set${where}`;
    case "empty": return `empty${where}`;
    case "missing": return "missing";
    default: return "not checked";
  }
}
export function keySourceText(k: EnvKeyView): string {
  return k.source === "identifier" ? `non-secret id "${k.identifierLabel}" declared in the manifest` : "secret: from your local vault (Power Ops)";
}
export function fileStateText(f: EnvFileView): string {
  switch (f.state) {
    case "found": return `found · ${f.keysDefined} expected name(s)${f.git === "tracked" ? " · COMMITTED TO GIT" : f.git === "not-ignored" ? " · not git-ignored" : ""}`;
    case "missing": return f.optional ? "optional · not present" : "missing";
    case "not-cloned": return "repository not cloned";
    case "unreadable": return "could not be checked";
    case "too-large": return "too large to check";
    default: return "not checked";
  }
}

/**
 * Names-and-states-only projection for the environment snapshot, AI context and reports. Built
 * from the Readiness (which holds no value) and nothing else.
 */
export interface ReadinessSnapshot {
  declared: boolean;
  files: Array<{ path: string; repository?: string; optional: boolean; state: EnvFileState; git: EnvFileGit }>;
  keys: Array<{ name: string; state: EnvKeyState; source: "identifier" | "vault" }>;
  identifiers: Array<{ id: string; label: string; provider?: string; kind?: string; envKey?: string; environments?: string[] }>;
  tools?: Array<{ tool: string; where: string; optional: boolean; range?: string; version?: string; state: string }>;
  connections?: Array<{ id: string; kind: string; tool?: string; provider?: string; environment?: string; state: string }>;
  companions: Array<{ module: string; state: CompanionState }>;
  repositories: Array<{ key: string; state: string; branch?: string; head?: string; changes?: number; ahead?: number; behind?: number }>;
  checks: { errors: number; warnings: number; infos: number; items: Array<{ severity: CheckSeverity; area: CheckArea; message: string }> };
}

export function readinessSnapshot(r: Readiness): ReadinessSnapshot {
  return {
    declared: r.declared,
    files: r.files.map(f => ({ path: f.path, repository: f.repoKey, optional: f.optional, state: f.state, git: f.git })),
    keys: r.keys.map(k => ({ name: k.name, state: k.state, source: k.source })),
    identifiers: r.identifiers.map(d => ({ id: d.id, label: d.label, provider: d.provider, kind: d.kind, envKey: d.envKey, ...(d.environments.length ? { environments: d.environments } : {}) })),
    ...(r.toolchain.declared ? { tools: r.toolchain.entries.map(e => ({ tool: e.tool, where: e.where, optional: e.optional, range: e.range, version: e.version, state: e.state })) } : {}),
    ...(r.connections.length ? { connections: r.connections.map(c => ({ id: c.id, kind: c.kind, tool: c.tool, provider: c.provider, environment: c.environment, state: c.state })) } : {}),
    companions: r.companions.map(c => ({ module: c.module, state: c.state })),
    repositories: r.repositories.map(x => ({ key: x.key, state: x.state, branch: x.branch, head: x.head, changes: x.changes, ahead: x.ahead, behind: x.behind })),
    checks: { errors: r.summary.errors, warnings: r.summary.warnings, infos: r.summary.infos, items: r.checks.slice(0, 50).map(c => ({ severity: c.severity, area: c.area, message: c.message })) }
  };
}

/**
 * v5 lines for AI contexts: the toolchain state, the ID map (logical ids, labels, kinds and which
 * environments have a value, never the values) and the connection states. Empty without v5 data.
 */
export function toolchainContextLines(r: Readiness): string[] {
  const lines: string[] = [];
  if (r.toolchain.declared) {
    lines.push("- Tools & versions (toolchain in .datapass/project.json, compared with my computer):");
    for (const e of r.toolchain.entries) lines.push(`  - \`${e.tool}\`${e.label !== e.tool ? ` (${e.label})` : ""}: ${toolStateText(e)}`);
    if (r.extensions.state !== "no-toolchain") lines.push(`- ${EXTENSIONS_JSON}: ${extensionsJsonText(r.extensions)}`);
  }
  const mapped = r.identifiers.filter(d => d.kind || d.environments.length);
  if (mapped.length) {
    lines.push("- ID map (logical ids; the values are in .datapass/project.json, refer to them by id):");
    for (const d of mapped) lines.push(`  - \`${d.id}\` ${d.label}${d.provider ? ` · ${d.provider}` : ""}${d.kind ? ` ${d.kind}` : ""}${d.environments.length ? ` · per environment: ${d.environments.join(", ")}` : ""}`);
  }
  if (r.connections.length) {
    lines.push("- Connections (names and states only):");
    for (const c of r.connections) lines.push(`  - \`${c.id}\` ${c.kind}${c.tool ? ` ${c.tool}` : c.provider ? ` ${c.provider}` : ""}${c.environment ? ` (${c.environment})` : ""}: ${CONNECTION_STATE_TEXT[c.state]}`);
  }
  return lines;
}

/** Lines for AI contexts (preparation pack, Copy AI context): names and states only. */
export function readinessContextLines(r: Readiness): string[] {
  if (!r.declared && !r.identifiers.length) return [];
  const lines = ["- Names and states only. I keep every secret value in my local vault; never ask me for a value, tell me which variable to set."];
  for (const f of r.files) lines.push(`- Env file \`${f.path}\`${f.repoKey ? ` (repository ${f.repoKey})` : ""}: ${fileStateText(f)}`);
  for (const k of r.keys) lines.push(`- \`${k.name}\`: ${keyStateText(k)} · ${k.source === "identifier" ? "non-secret id declared in the manifest" : "secret, kept in my local vault"}`);
  if (r.identifiers.length) lines.push(`- Non-secret ids declared in the manifest: ${r.identifiers.map(d => `${d.label}${d.envKey ? ` (→ \`${d.envKey}\`)` : ""}`).join(", ")}`);
  const serious = r.checks.filter(c => c.severity !== "info" && (c.area === "environment" || c.area === "repository")).slice(0, 10);
  for (const c of serious) lines.push(`- ${c.severity}: ${c.message}`);
  return lines;
}

/** Markdown report of the deterministic checks (names and states only). */
export function readinessReport(r: Readiness, project: { id: string; title: string } | undefined, generatedAt: string): string {
  const lines: string[] = [];
  lines.push(`# Readiness — ${project?.title ?? "Project"}${project ? ` (\`${project.id}\`)` : ""}`);
  lines.push("", `Deterministic local checks run by DataPass on ${generatedAt}. Names and states only: no value is read into this report.`);
  lines.push("", `**${r.summary.errors} error(s) · ${r.summary.warnings} warning(s) · ${r.summary.infos} note(s)**`);
  lines.push("", "## Local environment");
  if (!r.declared) lines.push("- No `localEnv` declared in .datapass/project.json.");
  for (const f of r.files) lines.push(`- \`${f.path}\`${f.repoLabel ? ` in ${f.repoLabel}` : ""}: ${fileStateText(f)}`);
  for (const k of r.keys) lines.push(`- \`${k.name}\`: ${keyStateText(k)} · ${keySourceText(k)}`);
  if (r.identifiers.length) {
    lines.push("", "## Non-secret identifiers declared in the manifest");
    for (const d of r.identifiers) lines.push(`- ${d.label}${d.provider || d.kind ? ` (${[d.provider, d.kind].filter(Boolean).join(" ")})` : ""}${d.envKey ? ` → \`${d.envKey}\`` : ""} — ${d.environments.length ? `one value per environment (${d.environments.join(", ")})` : "value"} in the manifest; copy it from DataPass`);
  }
  if (r.toolchain.declared) {
    lines.push("", "## Tools & versions");
    for (const e of r.toolchain.entries) lines.push(`- ${e.label} (\`${e.tool}\`): ${toolStateText(e)}${e.state === "missing" || e.state === "outside-range" ? e.install?.command ? ` — install: \`${e.install.command}\`${e.install.where ? ` in ${e.install.where}` : ""}` : e.install?.docs ? ` — ${e.install.docs}` : "" : ""}`);
    lines.push(`- ${EXTENSIONS_JSON}: ${extensionsJsonText(r.extensions)}`);
  }
  if (r.connections.length) {
    lines.push("", "## Connections");
    for (const c of r.connections) lines.push(`- ${c.label} (${c.kind}${c.environment ? `, ${c.environment}` : ""}): ${CONNECTION_STATE_TEXT[c.state]} — ${c.detail}${c.checkedAt ? ` (checked ${c.checkedAt})` : ""}`);
  }
  lines.push("", "## Optional companions");
  for (const c of r.companions) lines.push(`- ${c.label}: ${c.detail}`);
  lines.push("", "## Repositories");
  for (const x of r.repositories) lines.push(`- ${x.label}: ${x.state === "local" ? `${x.branch ?? "?"} @ ${x.head ?? "no commit"}${x.changes ? ` · ${x.changes} change(s)` : " · clean"}${x.behind ? ` · ${x.behind} to get` : ""}${x.ahead ? ` · ${x.ahead} to push` : ""}` : x.state}`);
  lines.push("", "## Checks");
  if (!r.checks.length) lines.push("- Nothing to report.");
  for (const c of r.checks) lines.push(`- **${c.severity}** · ${c.area} — ${c.message}${c.nextStep ? ` Next: ${c.nextStep}` : ""}`);
  lines.push("", "Secrets, tokens and passwords stay in your local vault (Power Ops). DataPass never reads, stores, displays or exports their values.");
  return lines.join("\n") + "\n";
}
