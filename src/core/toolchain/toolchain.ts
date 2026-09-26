/**
 * A project's toolchain (manifest v5): the tools it needs, the version ranges it accepts and where
 * each one runs, compared with what DataPass probes on this computer. Pure.
 *
 * Tools are named by id only. The program a probe runs and its arguments live in the extension
 * (capabilities/tools.ts), never in the manifest: an id DataPass does not know is shown as unknown
 * and nothing is run for it. Install commands are shown to copy, never run.
 */
import { TOOLS, type InstallHint, type ProbeState, type ToolDefinition, type ToolObservation } from "../capabilities/tools";
import { extractVersion, isRangeError, parseRange, satisfies, versionText, type VersionRange } from "./versions";

export const MAX_TOOLCHAIN_TOOLS = 60;
export type ToolWhere = "local" | "ci" | "fabric";
export const TOOL_WHERE: readonly ToolWhere[] = ["local", "ci", "fabric"];
/** `<family>.<name>`: ext.fabric, cli.az, py.fabric-cicd, pack.powerbi-gbrueckl… */
export const TOOL_ID = /^[a-z][a-z0-9]{0,15}\.[a-z0-9][a-z0-9.-]{0,63}$/;

export interface ToolchainEntry {
  /** Tool id (see knownTools()). */
  tool: string;
  /** Accepted versions, e.g. ">=1.0", "^2.3", ">=1.0 <2.0". */
  version?: string;
  /** Missing is a note, never a warning. */
  optional?: boolean;
  /** Where the tool runs: this computer (default), the CI pipeline, or Fabric notebooks. */
  where?: ToolWhere;
}
export interface ToolchainDecl { tools: ToolchainEntry[] }

export type ToolchainKind = ToolDefinition["kind"] | "python-library" | "agent-plugin";
/** A tool a toolchain may name: the probe registry plus tools DataPass knows but cannot probe. */
export interface ToolchainTool {
  id: string; label: string; kind: ToolchainKind; publisher: ToolDefinition["publisher"];
  extensionIds?: string[]; install?: InstallHint; note?: string;
  /** DataPass has a probe for it on this computer. */
  probe: boolean;
}

/**
 * Known tools without a probe: Python libraries run in CI or in Fabric notebooks (DataPass never
 * looks inside a Python environment), and agent plugins installed in Claude Code or Copilot CLI.
 */
const NOT_PROBED: ToolchainTool[] = [
  { id: "py.fabric-cicd", label: "fabric-cicd (Python)", kind: "python-library", publisher: "microsoft", probe: false,
    note: "Deploys the items of a Fabric Git folder to a workspace; parameter.yml replaces ids per environment. Usually runs in CI.",
    install: { all: "pip install fabric-cicd", docs: "https://microsoft.github.io/fabric-cicd/" } },
  { id: "py.semantic-link-labs", label: "semantic-link-labs (Python)", kind: "python-library", publisher: "microsoft", probe: false,
    note: "Used inside Fabric notebooks: Best Practice Analyzer, VertiPaq statistics, Direct Lake migration, report rebinding.",
    install: { all: "%pip install semantic-link-labs", where: "a Fabric notebook cell (or a custom Fabric environment)", docs: "https://github.com/microsoft/semantic-link-labs" } },
  { id: "plugin.power-bi-agentic-development", label: "Power BI agentic development (plugins)", kind: "agent-plugin", publisher: "community", probe: false,
    note: "data-goblin's plugin marketplace for Claude Code and GitHub Copilot CLI (11 plugins).",
    install: { all: "claude plugin marketplace add data-goblin/power-bi-agentic-development", docs: "https://github.com/data-goblin/power-bi-agentic-development" } }
];

let known: ReadonlyMap<string, ToolchainTool> | undefined;
export function knownTools(): ReadonlyMap<string, ToolchainTool> {
  known ??= new Map([
    ...TOOLS.map((t): [string, ToolchainTool] => [t.id, { id: t.id, label: t.label, kind: t.kind, publisher: t.publisher, extensionIds: t.extensionIds, install: t.install, note: t.note, probe: t.kind === "extension" || t.kind === "cli" || t.kind === "workspace-file" }]),
    ...NOT_PROBED.map((t): [string, ToolchainTool] => [t.id, t])
  ]);
  return known;
}

/** Closest known ids to a mistyped one (same family first), for "did you mean". */
export function suggestTools(id: string, max = 3): string[] {
  const family = id.split(".")[0];
  const name = id.slice(family!.length + 1);
  const score = (k: string) => {
    const [f, ...rest] = k.split(".");
    const n = rest.join(".");
    return (f === family ? 0 : 3) + (n.includes(name) || name.includes(n) ? 0 : distance(n, name) / Math.max(1, n.length));
  };
  return [...knownTools().keys()].map(k => [k, score(k)] as const).filter(([, s]) => s < 3.6).sort((a, b) => a[1] - b[1]).slice(0, max).map(([k]) => k);
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** Validate `toolchain` (v5). Unknown but well-formed ids are not errors: Readiness shows them as unknown. */
export function validateToolchain(doc: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (doc.toolchain === undefined) return issues;
  const t = doc.toolchain as Record<string, unknown> | null;
  if (!t || typeof t !== "object" || Array.isArray(t)) return ["toolchain must be an object with tools."];
  if (!Array.isArray(t.tools) || t.tools.length > MAX_TOOLCHAIN_TOOLS) return [`toolchain.tools must be an array of at most ${MAX_TOOLCHAIN_TOOLS} tools.`];
  const seen = new Set<string>();
  t.tools.forEach((raw, i) => {
    const at = `toolchain.tools[${i}]`;
    const e = raw as Record<string, unknown> | null;
    if (!e || typeof e !== "object" || Array.isArray(e)) { issues.push(`${at} must be an object with tool.`); return; }
    if (typeof e.tool !== "string" || !TOOL_ID.test(e.tool)) { issues.push(`${at}.tool must be a tool id such as cli.az, ext.fabric or py.fabric-cicd (lowercase family, a dot, then the name).`); return; }
    if (e.version !== undefined) {
      const r = parseRange(e.version);
      if (isRangeError(r)) issues.push(`${at}.version ${r.error}.`);
    }
    if (e.optional !== undefined && typeof e.optional !== "boolean") issues.push(`${at}.optional must be true or false.`);
    if (e.where !== undefined && !TOOL_WHERE.includes(e.where as ToolWhere)) issues.push(`${at}.where must be local, ci or fabric.`);
    const key = `${e.tool}@${typeof e.where === "string" ? e.where : "local"}`;
    if (seen.has(key)) issues.push(`${at}: ${e.tool} is listed twice for the same place (where).`);
    seen.add(key);
  });
  return issues;
}

// ------------------------------------------------------------------ view

export type ToolchainState =
  | "ok"              // present, and the version is in the range (or no range)
  | "outside-range"   // present, version outside the declared range
  | "version-unknown" // present, but DataPass cannot read its version
  | "missing"         // probed and absent
  | "not-checked"     // runs in CI or Fabric, or DataPass has no probe for it (desktop apps, Python libraries)
  | "unknown-tool";   // DataPass does not know this id: nothing is run for it

export interface ToolchainEntryView {
  tool: string;
  label: string;
  kind?: ToolchainKind;
  publisher?: ToolDefinition["publisher"];
  where: ToolWhere;
  optional: boolean;
  range?: string;
  /** The version the probe saw (x.y.z), when it could be read. */
  version?: string;
  state: ToolchainState;
  detail: string;
  /** The command to copy for this platform, and the docs page. Never run by DataPass. */
  install?: { command?: string; where?: string; docs?: string };
  /** First Marketplace id of an extension tool. */
  extensionId?: string;
  suggestions?: string[];
}
export interface ToolchainView {
  declared: boolean;
  entries: ToolchainEntryView[];
  summary: { ok: number; attention: number; notChecked: number; total: number };
}

export interface ToolchainInput {
  toolchain?: ToolchainDecl;
  tools: ReadonlyMap<string, ToolObservation>;
  platform: NodeJS.Platform | string;
  /** 0.23: tools the hub's toolkit describes (known, never probed). The extension's registry wins. */
  hubTools?: ReadonlyMap<string, ToolchainTool>;
}

/** The install command for a platform: platform-specific first, then the one for every platform. */
export function installFor(tool: ToolchainTool, platform: string): ToolchainEntryView["install"] {
  const ext = tool.kind === "extension" && tool.extensionIds?.[0];
  const hint = tool.install;
  const command = ext ? `code --install-extension ${ext}`
    : platform === "win32" ? hint?.windows ?? hint?.all
    : platform === "darwin" ? hint?.macos ?? hint?.all
    : hint?.linux ?? hint?.all;
  const docs = hint?.docs ?? (ext ? `https://marketplace.visualstudio.com/items?itemName=${ext}` : undefined);
  return command || docs ? { command, where: hint?.where, docs } : undefined;
}

const WHERE_TEXT: Record<ToolWhere, string> = { local: "this computer", ci: "the CI pipeline", fabric: "Fabric notebooks" };

export function buildToolchain(input: ToolchainInput): ToolchainView {
  const catalog = knownTools();
  const entries: ToolchainEntryView[] = (input.toolchain?.tools ?? []).map(e => {
    const where = e.where ?? "local";
    const optional = e.optional === true;
    const parsed = e.version !== undefined ? parseRange(e.version) : undefined;
    const range = parsed && !isRangeError(parsed) ? parsed : undefined;
    const tool = catalog.get(e.tool) ?? input.hubTools?.get(e.tool);
    if (!tool) {
      const suggestions = suggestTools(e.tool);
      return { tool: e.tool, label: e.tool, where, optional, range: range?.text, state: "unknown-tool", suggestions,
        detail: `DataPass does not know "${e.tool}", so nothing is checked for it.${suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : ""}` };
    }
    const base = { tool: tool.id, label: tool.label, kind: tool.kind, publisher: tool.publisher, where, optional, range: range?.text, extensionId: tool.kind === "extension" ? tool.extensionIds?.[0] : undefined };
    const install = installFor(tool, String(input.platform));
    if (where !== "local") return { ...base, state: "not-checked", detail: `Runs in ${WHERE_TEXT[where]}: not checked on this computer.`, install };
    if (!tool.probe) {
      const why = !catalog.has(tool.id) ? "the hub's toolkit describes it; DataPass has no probe for it" : tool.kind === "python-library" ? "DataPass does not look inside Python environments" : tool.kind === "agent-plugin" ? "agent plugins are installed inside Claude Code or Copilot CLI" : "DataPass cannot probe this application";
      return { ...base, state: "not-checked", detail: `Not checked: ${why}.`, install };
    }
    const obs = input.tools.get(tool.id);
    return { ...base, ...compareObserved(obs?.state, obs?.version, range), install };
  });
  const attention = entries.filter(e => !e.optional && (e.state === "missing" || e.state === "outside-range" || e.state === "unknown-tool")).length;
  return {
    declared: Boolean(input.toolchain),
    entries,
    summary: { ok: entries.filter(e => e.state === "ok").length, attention, notChecked: entries.filter(e => e.state === "not-checked" || e.state === "version-unknown").length, total: entries.length }
  };
}

function compareObserved(state: ProbeState | undefined, raw: string | undefined, range: VersionRange | undefined): Pick<ToolchainEntryView, "state" | "detail" | "version"> {
  if (state === "absent") return { state: "missing", detail: "Not found on this computer." };
  if (state !== "present") return { state: "not-checked", detail: "Not probed yet." };
  const v = extractVersion(raw);
  const version = v ? versionText(v) : undefined;
  if (!range) return { state: "ok", version, detail: version ? `${version} found.` : "Found." };
  if (!v) return { state: "version-unknown", detail: `Found, but DataPass could not read its version to compare with ${range.text}.` };
  return satisfies(v, range)
    ? { state: "ok", version, detail: `${version} is in ${range.text}.` }
    : { state: "outside-range", version, detail: `${version} is outside the project's range ${range.text}.` };
}

export function toolStateText(e: ToolchainEntryView): string {
  const where = e.where === "local" ? "" : ` · ${e.where === "ci" ? "CI" : "Fabric"}`;
  const opt = e.optional ? " · optional" : "";
  switch (e.state) {
    case "ok": return `${e.version ?? "found"}${e.range ? ` ✓ ${e.range}` : ""}${where}${opt}`;
    case "outside-range": return `${e.version} ✗ needs ${e.range}${where}${opt}`;
    case "version-unknown": return `found · version not read${e.range ? ` (needs ${e.range})` : ""}${where}${opt}`;
    case "missing": return `missing${e.range ? ` (needs ${e.range})` : ""}${opt}`;
    case "not-checked": return `not checked${e.range ? ` · ${e.range}` : ""}${where}${opt}`;
    case "unknown-tool": return "unknown to DataPass";
  }
}

/**
 * Declared version ranges of tools that are present here, for operation preflight: a version
 * outside its range is a warning on the phases that use the tool, never a blocker, never on reading.
 */
export function toolRangeWarnings(view: ToolchainView): ReadonlyMap<string, string> {
  return new Map(view.entries.filter(e => e.where === "local" && e.state === "outside-range").map(e => [e.tool, `${e.label} ${e.version} is outside this project's range ${e.range} (toolchain in .datapass/project.json).`]));
}
