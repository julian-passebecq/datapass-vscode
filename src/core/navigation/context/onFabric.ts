/**
 * V4-NAV NAVFAB1: the "On Fabric" context section. For the current Location, what the user needs to
 * act in the Fabric portal: the item (type, display name, logical id, workspace), its parameters,
 * default lakehouse and environment, its schedule, the portal link and the next Fabric action.
 *
 * Every value is read from the files Fabric Git integration commits (`.platform`, notebook META,
 * pipeline / Spark job definitions, `.schedules`) or from the project manifest, so its origin is
 * "static": what Git says, never what runs in production. Holes say what Git cannot tell (the
 * workspace item id differs from the logical id, a schedule kept only in the portal…). Pure: the host
 * passes the files it already read; nothing here touches the network or runs client code.
 */
import { portalFor, type ConnectionDecl } from "../../toolchain/connections";
import type { IdentifierDecl } from "../../readiness/readiness";

// Local stub of the NAVCTX1 section registry shape; replaced by its import when NAVCTX1 merges.
export type SectionOrigin = "static" | "theoretical" | "ai-proposed" | "observed";
export interface SectionHole { readonly reason: string }
export interface SectionFact { readonly label: string; readonly value: string; readonly origin: SectionOrigin; readonly source?: string }
export interface ContextSection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly origin: SectionOrigin;
  readonly holes: readonly SectionHole[];
  readonly facts?: readonly SectionFact[];
  readonly link?: { readonly label: string; readonly url: string };
}
export interface NavLocationLike { readonly level: string; readonly nodeId: string; readonly artifactKind: string }

export type FactKey = "type" | "displayName" | "logicalId" | "workspace" | "workspaceId" | "defaultLakehouse"
  | "lakehouseWorkspace" | "knownLakehouses" | "environment" | "parameter" | "mainFile" | "arguments" | "schedule";

/** Titles, fact labels and per-type next actions: data, overridable from settings. */
export interface OnFabricLabels {
  title: string;
  notFabric: string;
  facts: Record<FactKey, string>;
  /** Next Fabric action per `.platform` item type; `*` = any other type. */
  nextAction: Record<string, string>;
  portalLink: string;
}

export const DEFAULT_ON_FABRIC_LABELS: OnFabricLabels = {
  title: "On Fabric",
  notFabric: "Not a Fabric item: nothing to do in the Fabric portal for this location.",
  facts: {
    type: "Item type", displayName: "Display name", logicalId: "Logical id (Git)", workspace: "Workspace",
    workspaceId: "Workspace id", defaultLakehouse: "Default lakehouse", lakehouseWorkspace: "Lakehouse workspace",
    knownLakehouses: "Other attached lakehouses", environment: "Environment", parameter: "Parameter",
    mainFile: "Main definition file", arguments: "Command-line arguments", schedule: "Schedule"
  },
  nextAction: {
    Notebook: "Open the notebook in the workspace, check its default lakehouse and environment, then run it or add it to a pipeline.",
    SparkJobDefinition: "Open the Spark job definition, check the main file, lakehouse and arguments, then run it or schedule it.",
    DataPipeline: "Open the pipeline, review the parameters, then trigger a run or set its schedule.",
    Lakehouse: "Open the lakehouse to check its tables and shortcuts.",
    Environment: "Open the environment and publish it if its libraries or Spark settings changed.",
    SemanticModel: "Open the semantic model settings to check credentials and refresh.",
    Report: "Open the report and check it is bound to the right semantic model.",
    "*": "Open the workspace and find this item by its display name."
  },
  portalLink: "Open the workspace in Fabric"
};

export interface OnFabricInput {
  readonly location: NavLocationLike;
  /** Files of the item folder, keyed by name relative to that folder (`.platform`, `notebook-content.py`…). */
  readonly files: Readonly<Record<string, string | undefined>>;
  /** Item folder relative to the project root, for fact sources. */
  readonly folder?: string;
  /** From the project manifest `platforms.fabric`. */
  readonly workspace?: { readonly name?: string; readonly id?: string };
  readonly labels?: Partial<Omit<OnFabricLabels, "facts">> & { facts?: Partial<Record<FactKey, string>> };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export function onFabricSection(input: OnFabricInput): ContextSection {
  const labels = mergeLabels(input.labels);
  const F = labels.facts;
  const src = (name: string) => (input.folder ? `${input.folder.replace(/\\/g, "/").replace(/\/$/, "")}/${name}` : name);
  const platform = parsePlatform(input.files[".platform"]);
  if (!platform) {
    return { id: "on-fabric", title: labels.title, body: labels.notFabric, origin: "static", holes: [{ reason: "not a Fabric item" }] };
  }

  const facts: SectionFact[] = [];
  const holes: SectionHole[] = [];
  const fact = (label: string, value: string | undefined, source: string) => {
    if (value) facts.push({ label, value, origin: "static", source });
  };

  fact(F.type, platform.type, src(".platform"));
  fact(F.displayName, platform.displayName, src(".platform"));
  fact(F.logicalId, platform.logicalId, src(".platform"));
  if (!platform.type) holes.push({ reason: ".platform has no metadata.type" });
  if (platform.logicalId) holes.push({ reason: "The logical id is the Git identity; the item id in the workspace is assigned by Fabric and is not in Git." });

  const ws = input.workspace;
  fact(F.workspace, ws?.name?.trim(), "project manifest");
  const wsId = ws?.id?.trim();
  fact(F.workspaceId, wsId, "project manifest");
  if (!ws?.name?.trim() && !wsId) holes.push({ reason: "No Fabric workspace declared in the project manifest (platforms.fabric.workspaceName / workspaceId)." });

  // Notebook META (Fabric Git format: notebook-content.py / .sql / .scala / .r).
  const nbName = Object.keys(input.files).find(n => /^notebook-content\.[a-z]+$/i.test(n));
  if (nbName) {
    const nb = parseNotebookContent(input.files[nbName] ?? "");
    fact(F.defaultLakehouse, describeId(nb.lakehouseName, nb.lakehouseId), src(nbName));
    if (nb.lakehouseWorkspaceId && nb.lakehouseWorkspaceId !== wsId) fact(F.lakehouseWorkspace, nb.lakehouseWorkspaceId, src(nbName));
    if (nb.knownLakehouses.length) fact(F.knownLakehouses, nb.knownLakehouses.join(", "), src(nbName));
    fact(F.environment, nb.environmentId, src(nbName));
    for (const p of nb.parameters) fact(F.parameter, `${p.name} = ${p.value}`, src(nbName));
    if (!nb.lakehouseId) holes.push({ reason: "No default lakehouse in the notebook META: it is chosen in the portal or at run time." });
    if (!nb.parameters.length) holes.push({ reason: "No parameters cell: the notebook takes no run-time parameters." });
    if (nb.metaError) holes.push({ reason: `Notebook META block could not be read (${nb.metaError}).` });
  }

  // Spark job definition.
  const sjd = parseJsonFile(input.files["SparkJobDefinitionV1.json"]);
  if (sjd) {
    const s = src("SparkJobDefinitionV1.json");
    fact(F.mainFile, str(sjd.executableFile) ?? str(sjd.mainDefinitionFile), s);
    fact(F.defaultLakehouse, nonZero(str(sjd.defaultLakehouseArtifactId)), s);
    fact(F.environment, nonZero(str(sjd.environmentArtifactId)), s);
    fact(F.arguments, str(sjd.commandLineArguments), s);
  }

  // Data pipeline parameters.
  const pipe = parseJsonFile(input.files["pipeline-content.json"]);
  if (pipe) {
    const params = obj(obj(pipe.properties)?.parameters);
    for (const [name, def] of Object.entries(params ?? {})) {
      const d = obj(def);
      const type = str(d?.type) ?? "?";
      const dv = d && "defaultValue" in d ? JSON.stringify(d.defaultValue) : "(no default)";
      fact(F.parameter, `${name}: ${type} = ${dv}`, src("pipeline-content.json"));
    }
  }

  // Schedules (Fabric Git `.schedules`, when the workspace commits them).
  const sched = parseJsonFile(input.files[".schedules"]);
  const schedules = Array.isArray(sched?.schedules) ? (sched!.schedules as unknown[]) : [];
  for (const s of schedules) fact(F.schedule, describeSchedule(obj(s)), src(".schedules"));
  if (!schedules.length) holes.push({ reason: "No schedule in Git: if this item runs on a schedule, it is set only in the portal." });

  const link = wsId && GUID.test(wsId) ? workspaceLink(wsId, labels.portalLink) : undefined;
  if (!link) holes.push({ reason: "No workspace id: the portal link opens the Fabric home page." });
  const next = labels.nextAction[platform.type ?? ""] ?? labels.nextAction["*"] ?? "";
  return {
    id: "on-fabric",
    title: labels.title,
    body: next,
    origin: "static",
    holes,
    facts,
    link: link ?? { label: labels.portalLink, url: "https://app.fabric.microsoft.com/" }
  };
}

/** Uses the existing Fabric portal link builder (connections.ts). */
function workspaceLink(workspaceId: string, label: string): { label: string; url: string } | undefined {
  const decl = { id: "nav-fabric", kind: "git-binding", provider: "fabric", identifier: "ws" } as ConnectionDecl;
  const ident: IdentifierDecl = { id: "ws", label: "Fabric workspace", value: workspaceId };
  const url = portalFor(decl, [ident]);
  return url ? { label, url } : undefined;
}

export interface PlatformFacts { type?: string; displayName?: string; logicalId?: string }

export function parsePlatform(raw: string | undefined): PlatformFacts | undefined {
  const j = parseJsonFile(raw);
  if (!j) return undefined;
  const meta = obj(j.metadata);
  const config = obj(j.config);
  if (!meta && !config) return undefined;
  return { type: str(meta?.type), displayName: str(meta?.displayName), logicalId: str(config?.logicalId) };
}

export interface NotebookFacts {
  lakehouseId?: string; lakehouseName?: string; lakehouseWorkspaceId?: string; knownLakehouses: string[];
  environmentId?: string; parameters: { name: string; value: string }[]; metaError?: string;
}

/** Reads the first `# META` block (notebook dependencies) and the parameters cell. Never executes. */
export function parseNotebookContent(text: string): NotebookFacts {
  const out: NotebookFacts = { knownLakehouses: [], parameters: [] };
  const lines = text.split(/\r?\n/);
  const meta: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) if (/^(#|--|\/\/)\s*METADATA\s*\*+/.test(lines[i] ?? "")) break;
  for (i++; i < lines.length; i++) {
    const m = /^(?:#|--|\/\/)\s?META\s?(.*)$/.exec(lines[i] ?? "");
    if (!m) { if (meta.length) break; continue; }
    meta.push(m[1] ?? "");
  }
  if (meta.length) {
    try {
      const j = obj(JSON.parse(meta.join("\n")));
      const deps = obj(j?.dependencies);
      const lh = obj(deps?.lakehouse);
      out.lakehouseId = nonZero(str(lh?.default_lakehouse));
      out.lakehouseName = str(lh?.default_lakehouse_name);
      out.lakehouseWorkspaceId = nonZero(str(lh?.default_lakehouse_workspace_id));
      const known = Array.isArray(lh?.known_lakehouses) ? lh!.known_lakehouses as unknown[] : [];
      out.knownLakehouses = known.map(k => str(obj(k)?.id)).filter((k): k is string => Boolean(k) && k !== out.lakehouseId);
      out.environmentId = nonZero(str(obj(deps?.environment)?.environmentId));
    } catch (e) {
      out.metaError = e instanceof Error ? e.message.slice(0, 120) : "invalid JSON";
    }
  }
  const p = lines.findIndex(l => /^(#|--|\/\/)\s*PARAMETERS CELL\s*\*+/.test(l));
  if (p >= 0) {
    for (const l of lines.slice(p + 1)) {
      if (/^(#|--|\/\/)\s*(METADATA|CELL|MARKDOWN|PARAMETERS CELL)\s*\*+/.test(l)) break;
      const a = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[^=]+)?=\s*(.+?)\s*$/.exec(l);
      const name = a?.[1];
      const value = a?.[2];
      if (name && value && !/^\s*#/.test(l)) out.parameters.push({ name, value: value.slice(0, 200) });
    }
  }
  return out;
}

export function describeSchedule(s: Record<string, unknown> | undefined): string | undefined {
  if (!s) return undefined;
  const c = obj(s.configuration) ?? {};
  const parts: string[] = [];
  parts.push(s.enabled === false ? "disabled" : s.enabled === true ? "enabled" : "enabled?");
  const job = str(s.jobType);
  if (job) parts.push(job);
  const type = str(c.type);
  if (type) parts.push(type);
  if (typeof c.interval === "number") parts.push(`every ${c.interval} min`);
  if (Array.isArray(c.times) && c.times.length) parts.push(`at ${c.times.map(String).join(", ")}`);
  if (Array.isArray(c.weekdays) && c.weekdays.length) parts.push(`on ${c.weekdays.map(String).join(", ")}`);
  const tz = str(c.localTimeZoneId);
  if (tz) parts.push(`(${tz})`);
  const start = str(c.startDateTime);
  const end = str(c.endDateTime);
  if (start || end) parts.push(`from ${start ?? "?"} to ${end ?? "?"}`);
  return parts.join(" · ");
}

function mergeLabels(o: OnFabricInput["labels"]): OnFabricLabels {
  const d = DEFAULT_ON_FABRIC_LABELS;
  if (!o) return d;
  return { ...d, ...o, facts: { ...d.facts, ...o.facts }, nextAction: { ...d.nextAction, ...o.nextAction } };
}

function describeId(name: string | undefined, id: string | undefined): string | undefined {
  if (name && id) return `${name} (${id})`;
  return name ?? id;
}

function parseJsonFile(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw || raw.length > 2 * 1024 * 1024) return undefined;
  try { return obj(JSON.parse(raw.replace(/^﻿/, ""))); } catch { return undefined; }
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function nonZero(v: string | undefined): string | undefined {
  return v && v !== ZERO_GUID ? v : undefined;
}
