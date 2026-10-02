import * as vscode from "vscode";
import { vetRelativePath } from "../../exchange/pathSafety";
import { UserFacingError, guarded } from "../../../work/io";
import { aiExplainSection, explainLabels, explainOrderDraft, explainPathOf, sourceSha256, type ExplainLocation, type ExplainSection } from "./aiExplain";

/**
 * NAVAIX1 host side. `datapass.nav.explain.ask` (the Context Why tab button, and the "ask-ai" hole fill) prepares a work
 * order through the existing AI exchange (`datapass.workOrders.new`, previewed and confirmed by the user); DataPass itself
 * makes no network call. `loadAiExplain` is the `ai-explain` provider the Context panel reads.
 */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const LEVELS = new Set(["project", "subproject", "artifact", "step", "operation"]);

export interface ExplainArg { readonly location: ExplainLocation; readonly title?: string; readonly paths?: readonly string[]; readonly revision?: string | null; readonly asks?: readonly string[] }

/** Webview / command args are untrusted: keep only a well-formed location and vetted relative paths. */
export function parseExplainArg(arg: unknown): ExplainArg | undefined {
  const a = arg && typeof arg === "object" ? arg as Record<string, unknown> : undefined;
  const l = a?.location && typeof a.location === "object" ? a.location as Record<string, unknown> : undefined;
  if (!l || typeof l.nodeId !== "string" || !l.nodeId.trim() || l.nodeId.length > 1024 || typeof l.level !== "string" || !LEVELS.has(l.level)) return undefined;
  const location = { level: l.level, nodeId: l.nodeId, artifactKind: typeof l.artifactKind === "string" ? l.artifactKind.slice(0, 64) : "other" };
  const paths = Array.isArray(a!.paths) ? a!.paths.slice(0, 64).map(p => (typeof p === "string" ? vetRelativePath(p) : undefined)).flatMap(v => (v?.ok ? [v.relative] : [])) : [];
  const asks = Array.isArray(a!.asks) ? a!.asks.filter((x): x is string => typeof x === "string").slice(0, 12).map(x => x.slice(0, 500)) : undefined;
  return { location, title: typeof a!.title === "string" ? a!.title.slice(0, 200) : undefined, paths, revision: typeof a!.revision === "string" ? a!.revision.slice(0, 80) : null, asks };
}

const root = (): vscode.Uri | undefined => vscode.workspace.workspaceFolders?.[0]?.uri;
const labels = () => explainLabels(vscode.workspace.getConfiguration("datapass.nav.explain").get("labels"));

async function hashes(base: vscode.Uri, paths: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const p of paths) {
    try {
      const uri = vscode.Uri.joinPath(base, ...p.split("/"));
      if ((await vscode.workspace.fs.stat(uri)).size > MAX_SOURCE_BYTES) { out.set(p, null); continue; }
      out.set(p, sourceSha256(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8")));
    } catch { out.set(p, null); }
  }
  return out;
}

/** The `ai-explain` Context provider: reads `.datapass/explain/<safe id>.json` and the current source hashes. */
export async function loadAiExplain(location: ExplainLocation, paths: readonly string[], title?: string): Promise<ExplainSection> {
  const base = root();
  let raw: string | null = null;
  if (base) {
    try {
      const uri = vscode.Uri.joinPath(base, ...explainPathOf(location.nodeId).split("/"));
      if ((await vscode.workspace.fs.stat(uri)).size <= 512_000) raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      else raw = "{}";
    } catch { raw = null; }
  }
  const current = base ? await hashes(base, paths) : new Map<string, string | null>();
  // Hashes recorded in the file are compared too, so a source the caller did not list still marks the answer stale.
  if (base && raw) {
    try {
      const recorded = (JSON.parse(raw) as { source?: { files?: Array<{ path?: unknown }> } }).source?.files ?? [];
      const extra = recorded.map(f => (typeof f.path === "string" ? vetRelativePath(f.path) : undefined)).flatMap(v => (v?.ok && !current.has(v.relative) ? [v.relative] : [])).slice(0, 64);
      for (const [k, v] of await hashes(base, extra)) current.set(k, v);
    } catch { /* refused by the reader */ }
  }
  return aiExplainSection({ location, title, raw, current, labels: labels() });
}

export function registerAiExplain(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("datapass.nav.explain.ask", guarded(async (arg?: unknown) => {
    const a = parseExplainArg(arg);
    if (!a) throw new UserFacingError("Choose a location in the DataPass navigator first.");
    const base = root();
    const current = base ? await hashes(base, a.paths ?? []) : new Map<string, string | null>();
    const d = explainOrderDraft({
      location: a.location, title: a.title, revision: a.revision, asks: a.asks, labels: labels(),
      sources: (a.paths ?? []).map(p => ({ path: p, sha256: current.get(p) ?? null }))
    });
    await vscode.commands.executeCommand("datapass.workOrders.new", { kind: d.kind, title: d.title, goal: d.goal, doneWhen: d.doneWhen });
    void vscode.window.setStatusBarMessage(d.note, 8000);
  })));
}
