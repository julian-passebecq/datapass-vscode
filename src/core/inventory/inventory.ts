/**
 * Static inventory of native project assets (v1 gates 5 and 7). Pure.
 *
 * Files are recognised from their path and the first bytes of their text, never by running them:
 * notebooks are not opened by a kernel, DAG Python is never imported, YAML/JSON is not evaluated.
 * An Airflow DAG id is only reported when it is written literally in the file; anything computed
 * stays "not static" rather than guessed.
 */
import type { ModuleId } from "../modules";
import { parseStrictJson, isPlainObject } from "../model/strictJson";

export type AssetKind = "notebook" | "fabric-item" | "databricks-bundle" | "databricks-notebook" | "airflow-dag" | "adf-pipeline" | "pbip";

export interface Asset {
  kind: AssetKind;
  /** Workspace-relative POSIX path of the file that identified the asset. */
  path: string;
  name: string;
  /** Fabric item type, DAG ids, bundle name… */
  detail?: string;
  /** Module that owns the asset; undefined = always shown (plain notebooks). */
  module?: ModuleId;
  /** What to open: the file, or the item folder for Fabric Git items. */
  open: { type: "file" | "folder"; path: string };
}

export const ASSET_GROUPS: ReadonlyArray<{ kind: AssetKind; label: string; icon: string }> = [
  { kind: "notebook", label: "Notebooks (.ipynb)", icon: "notebook" },
  { kind: "fabric-item", label: "Fabric items (Git format)", icon: "symbol-namespace" },
  { kind: "databricks-bundle", label: "Databricks bundles", icon: "package" },
  { kind: "databricks-notebook", label: "Databricks notebooks", icon: "notebook" },
  { kind: "airflow-dag", label: "Airflow DAGs", icon: "type-hierarchy-sub" },
  { kind: "adf-pipeline", label: "Data Factory pipelines", icon: "git-merge" },
  { kind: "pbip", label: "Power BI projects", icon: "graph" }
];

/** Bytes read per file for recognition; the rest of a file is never read. */
export const HEAD_BYTES = 64 * 1024;
export const INVENTORY_EXCLUDE = "**/{node_modules,.git,.venv,venv,.tox,dist,out,build,__pycache__,site-packages,.databricks,.terraform,.datapass}/**";

const FABRIC_ITEM = /(?:^|\/)([^/]+)\.(Notebook|DataPipeline|Lakehouse|SparkJobDefinition|Eventstream|Eventhouse|KQLDatabase|KQLQueryset|Environment|Warehouse|SemanticModel|Report|MLModel|MLExperiment|CopyJob|ApacheAirflowJob)\/\.platform$/;
const baseName = (p: string) => p.split("/").pop() ?? p;
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Literal DAG ids only: dag_id="x", DAG("x"), DAG(dag_id="x"). */
export function staticDagIds(text: string): string[] {
  const ids = new Set<string>();
  for (const re of [/\bdag_id\s*=\s*["']([A-Za-z0-9_.-]{1,250})["']/g, /\bDAG\(\s*["']([A-Za-z0-9_.-]{1,250})["']/g]) {
    for (const m of text.matchAll(re)) ids.add(m[1]!);
  }
  return [...ids].slice(0, 20);
}

/**
 * Recognise one file. `head` is the decoded start of the file (at most HEAD_BYTES), or undefined
 * when the classifier does not need content for this path.
 */
export function classifyAsset(path: string, head?: string): Asset | undefined {
  const name = baseName(path);
  const lower = name.toLowerCase();
  if (lower.endsWith(".ipynb")) return { kind: "notebook", path, name, open: { type: "file", path } };
  if (lower.endsWith(".pbip")) return { kind: "pbip", path, name: name.slice(0, -5), module: "powerbi", open: { type: "file", path } };

  const fabric = FABRIC_ITEM.exec(path);
  if (fabric) {
    let display = fabric[1]!, type = fabric[2]!;
    if (head) {
      try {
        const doc = parseStrictJson(head, { maxBytes: HEAD_BYTES, maxDepth: 6 });
        const meta = isPlainObject(doc) && isPlainObject(doc.metadata) ? doc.metadata : undefined;
        if (typeof meta?.displayName === "string" && meta.displayName.trim()) display = clip(meta.displayName.trim(), 120);
        if (typeof meta?.type === "string" && /^[A-Za-z]{1,40}$/.test(meta.type)) type = meta.type;
      } catch { /* folder name is enough */ }
    }
    const folder = path.slice(0, -"/.platform".length);
    const module: ModuleId = type === "SemanticModel" || type === "Report" ? "powerbi" : type === "ApacheAirflowJob" ? "airflow" : "fabric";
    return { kind: "fabric-item", path, name: display, detail: type, module, open: { type: "folder", path: folder } };
  }

  if (lower === "databricks.yml" || lower === "databricks.yaml" || lower === "bundle.yml" || lower === "bundle.yaml") {
    const bundle = head ? /^bundle:\s*\r?\n(?:[ \t]+#.*\r?\n)*[ \t]+name:\s*["']?([A-Za-z0-9_.-]{1,100})/m.exec(head)?.[1] : undefined;
    return { kind: "databricks-bundle", path, name: bundle ?? name, detail: bundle ? name : undefined, module: "databricks", open: { type: "file", path } };
  }

  if (lower.endsWith("/pipeline/") || /(?:^|\/)pipeline\/[^/]+\.json$/i.test(path)) {
    if (!head) return undefined;
    try {
      const doc = parseStrictJson(head, { maxBytes: HEAD_BYTES, maxDepth: 40 });
      if (isPlainObject(doc) && isPlainObject(doc.properties) && Array.isArray(doc.properties.activities)) {
        const n = typeof doc.name === "string" && doc.name.trim() ? clip(doc.name.trim()) : name.replace(/\.json$/i, "");
        return { kind: "adf-pipeline", path, name: n, detail: `${doc.properties.activities.length} activities`, module: "fabric", open: { type: "file", path } };
      }
    } catch { /* not an ADF pipeline, or larger than the head */ }
    return undefined;
  }

  if (lower.endsWith(".py") && head !== undefined) {
    const first = head.replace(/^﻿/, "").split(/\r?\n/, 1)[0]?.trim();
    if (first === "# Databricks notebook source") return { kind: "databricks-notebook", path, name, module: "databricks", open: { type: "file", path } };
    if (/^\s*(?:from\s+airflow(?:\.[\w.]+)?\s+import|import\s+airflow)\b/m.test(head) && /\bDAG\s*\(|@dag\b/.test(head)) {
      const ids = staticDagIds(head);
      return { kind: "airflow-dag", path, name: ids[0] ?? name, detail: ids.length > 1 ? `${ids.length} DAG ids` : ids.length ? name : "DAG id not static", module: "airflow", open: { type: "file", path } };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- repository status

export type RepoState = "ok" | "missing" | "not-a-repo" | "remote-only";
export interface RepoStatus {
  key: string;
  label: string;
  state: RepoState;
  branch?: string;
  head?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** Changed or untracked entries (porcelain lines). */
  changes?: number;
  remote?: string;
}

/** `git status --porcelain=v2 --branch` → branch, HEAD, upstream, ahead/behind, change count. Local only. */
export function parseStatusV2(stdout: string): Pick<RepoStatus, "branch" | "head" | "upstream" | "ahead" | "behind" | "changes"> {
  const out: Pick<RepoStatus, "branch" | "head" | "upstream" | "ahead" | "behind" | "changes"> = { changes: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("# branch.oid ")) { const oid = line.slice(13).trim(); if (/^[0-9a-f]{7,64}$/.test(oid)) out.head = oid; }
    else if (line.startsWith("# branch.head ")) out.branch = line.slice(14).trim();
    else if (line.startsWith("# branch.upstream ")) out.upstream = line.slice(18).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /^\+(\d+) -(\d+)$/.exec(line.slice(12).trim());
      if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]); }
    } else if (!line.startsWith("#")) out.changes!++;
  }
  return out;
}

export function describeRepo(r: RepoStatus): string {
  switch (r.state) {
    case "missing": return "not found locally (never cloned automatically)";
    case "not-a-repo": return "not a Git repository";
    case "remote-only": return `remote-only${r.remote ? ` · ${r.remote}` : ""}`;
    case "ok": {
      const parts = [r.branch === "(detached)" ? "detached" : r.branch ?? "?", r.head ? r.head.slice(0, 7) : "no commit"];
      parts.push(r.changes ? `${r.changes} change${r.changes === 1 ? "" : "s"}` : "clean");
      if (!r.upstream) parts.push("no upstream");
      else parts.push(r.ahead || r.behind ? `↑${r.ahead ?? 0} ↓${r.behind ?? 0}` : "in sync (as of last fetch)");
      return parts.join(" · ");
    }
  }
}
