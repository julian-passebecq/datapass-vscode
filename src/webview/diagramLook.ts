/**
 * How the architecture diagram looks (V1-UI-POLISH): one mapping used by the diagram only. It reads the
 * component's provider, kind, entry file and health; it never changes a format, a schema or the model.
 *
 *   side band + icon   the provider (Azure blue, Fabric green, Power BI yellow, Databricks orange-red…)
 *   top edge + symbol  the state (available ✓, prepared or planned ◐, choice only ○, unverified ?, blocked ✕)
 *   entry chip         the entry file's type, in the colour of VS Code's default file icon theme (Seti)
 *
 * Provider colours are fixed brand-like hex values; state colours are VS Code theme colours, so the two are
 * never the same value, and a state always carries its symbol. High-contrast themes drop the provider colours
 * (CSS) and keep the icon and the symbol.
 */
import { DIAGRAM_ICONS, type DiagramIcon } from "./diagramIcons";

export interface ProviderLook { family: string; label: string; color: string; icon: string }

/** Provider families, as the legend names them. */
export const FAMILY_COLORS: Record<string, { label: string; color: string }> = {
  azure: { label: "Azure", color: "#0078d4" },
  fabric: { label: "Microsoft Fabric", color: "#117865" },
  powerbi: { label: "Power BI", color: "#f2c811" },
  databricks: { label: "Databricks", color: "#ff3621" },
  python: { label: "Python", color: "#3776ab" },
  git: { label: "Git / CI", color: "#8250df" },
  sql: { label: "SQL / databases", color: "#f55385" },
  google: { label: "Google Cloud", color: "#4285f4" },
  infra: { label: "Infrastructure", color: "#2b7489" },
  tools: { label: "Other tools", color: "#e8702a" },
  neutral: { label: "Unknown", color: "#c8ccd0" }
};

const P = (family: string, icon: string) => ({ family, icon });
/** providerId → family and icon. Anything else falls back to the neutral look. */
const PROVIDERS: Record<string, { family: string; icon: string }> = {
  "azure-functions": P("azure", "co:symbol-method"),
  "azure-data-factory": P("azure", "co:git-merge"),
  "azure-storage": P("azure", "co:archive"),
  "cosmos-nosql": P("azure", "co:database"),
  "azure-pipelines": P("azure", "co:azure-devops"),
  bicep: P("azure", "co:azure"),
  fabric: P("fabric", "co:layers"),
  powerbi: P("powerbi", "co:graph"),
  databricks: P("databricks", "si:databricks"),
  python: P("python", "si:python"),
  jupyter: P("tools", "si:jupyter"),
  "github-actions": P("git", "si:githubactions"),
  "gitlab-ci": P("git", "si:gitlab"),
  sql: P("sql", "co:database"),
  postgres: P("sql", "si:postgresql"),
  neon: P("sql", "si:neon"),
  "mongodb-atlas": P("sql", "si:mongodb"),
  "google-cloud-storage": P("google", "si:googlecloud"),
  "google-drive": P("google", "si:googledrive"),
  bigquery: P("google", "si:googlebigquery"),
  terraform: P("infra", "si:terraform"),
  vm: P("infra", "co:vm"),
  docker: P("infra", "si:docker"),
  airflow: P("tools", "si:apacheairflow"),
  grafana: P("tools", "si:grafana"),
  manual: P("neutral", "co:person")
};

/** A few kinds refine the icon inside a family (a Fabric lakehouse, notebook or pipeline; an Azure VM…). */
const KIND_ICONS: Record<string, string> = {
  lakehouse: "co:table", notebook: "co:notebook", pipeline: "co:git-merge", workflow: "co:git-merge", "streaming-flow": "co:symbol-event",
  database: "co:database", collection: "co:database", storage: "co:archive", function: "co:symbol-method", dashboard: "co:graph", report: "co:graph",
  "semantic-model": "co:table", dataset: "co:table", vm: "co:vm", script: "co:file-code", package: "co:package"
};
/** Families whose own mark says more than the kind (Databricks stays Databricks, Python stays Python). */
const BRAND_FIRST = new Set(["databricks", "python", "git", "google"]);

/** A generic Azure resource: the provider id starts with "azure" but is not one DataPass knows yet. */
const isAzure = (id: string) => /^azure([-.]|$)/.test(id);

export function providerLook(providerId: string | undefined, kind?: string): ProviderLook {
  const known = providerId ? PROVIDERS[providerId] : undefined;
  const base = known ?? (providerId && isAzure(providerId) ? P("azure", "co:azure") : kind && KIND_ICONS[kind] ? P("neutral", KIND_ICONS[kind]!) : P("neutral", "co:question"));
  const icon = known && !BRAND_FIRST.has(base.family) && kind && KIND_ICONS[kind] && base.family !== "neutral" ? KIND_ICONS[kind]! : base.icon;
  const fam = FAMILY_COLORS[base.family]!;
  return { family: base.family, label: fam.label, color: fam.color, icon };
}

export const iconOf = (id: string): DiagramIcon => DIAGRAM_ICONS[id] ?? DIAGRAM_ICONS["co:question"]!;

// ------------------------------------------------------------------ file types (Seti, VS Code's default)

const SETI = { blue: "#519aba", yellow: "#cbcb41", orange: "#e37933", purple: "#a074c4", green: "#8dc149", red: "#cc3e44", pink: "#f55385", grey: "#6d8086" };
const FILE_COLORS: Record<string, string> = {
  py: SETI.blue, md: SETI.blue, ts: SETI.blue, ps1: SETI.blue, bicep: SETI.blue,
  json: SETI.yellow, js: SETI.yellow,
  ipynb: SETI.orange, xml: SETI.orange, html: SETI.orange,
  yaml: SETI.purple, yml: SETI.purple, tf: SETI.purple,
  csv: SETI.green, sh: SETI.green,
  pdf: SETI.red,
  sql: SETI.pink,
  txt: SETI.grey, toml: SETI.grey, ini: SETI.grey, env: SETI.grey
};

/** The extension of a path ("notebooks/run.ipynb" → "ipynb"), lower case; undefined for a folder or no dot. */
export function fileExtension(p: string | undefined): string | undefined {
  if (!p || p.endsWith("/") || p.endsWith("**")) return undefined;
  const base = p.split("/").pop()!;
  const i = base.lastIndexOf(".");
  return i > 0 || (i === 0 && base.length > 1) ? base.slice(i + 1).toLowerCase() : undefined;
}

/** The Seti colour of a file type; unknown types get the neutral grey. */
export const fileColor = (p: string | undefined): string => FILE_COLORS[fileExtension(p) ?? ""] ?? SETI.grey;
export const KNOWN_FILE_TYPES = Object.keys(FILE_COLORS);

// ------------------------------------------------------------------ state (V1-HONEST capability states)

export type DiagramState = "available" | "prepared" | "choice" | "unverified" | "blocked";
export const STATES: Record<DiagramState, { symbol: string; label: string; about: string; color: string }> = {
  available: { symbol: "✓", label: "available", about: "its files are here and an operation is ready", color: "var(--ok)" },
  prepared: { symbol: "◐", label: "prepared / planned", about: "declared or partly prepared: a step is left", color: "var(--warn)" },
  choice: { symbol: "○", label: "choice only", about: "a choice on paper: only in a variant or option, or declared with nothing DataPass can check or run yet", color: "var(--muted)" },
  unverified: { symbol: "?", label: "unverified", about: "DataPass could not check it here (not cloned, origin unverified, Restricted Mode)", color: "var(--unverified)" },
  blocked: { symbol: "✕", label: "blocked", about: "required files are missing, or an operation cannot run", color: "var(--bad)" }
};

export interface StateInput { health?: string; availability?: string; repoState?: string; previewOnly?: boolean; ghost?: boolean }

/** One clear state per diagram node, from the health the extension already computed. */
export function diagramState(i: StateInput): DiagramState {
  if (i.ghost || i.previewOnly) return "choice";
  if (i.availability === "unbound" || i.availability === "restricted" || i.repoState === "unverified" || i.repoState === "missing" || i.repoState === "wrong-remote") return "unverified";
  switch (i.health) {
    case "ok": return "available";
    case "blocked": return "blocked";
    case "planned": case "attention": return "prepared";
    case "info": return "choice";
    default: return "unverified";
  }
}
