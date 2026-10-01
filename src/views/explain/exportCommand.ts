/**
 * V5 EXPLAIN1 (TL-8) command `datapass.explain.export`: asks the audience, renders the explainer page
 * (src/core/explain) from the session's facts and saves it under `.datapass/explain/export-<date>.html`.
 * Nothing is uploaded: the person opens the file in their browser (button) and shares it themselves.
 */
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import type { ProjectMap } from "../../core/project/projectMap";
import type { OptionsFile } from "../../core/project/options";
import { readRepoRevision } from "../../core/workspace/gitBase";
import { buildExplainHtml } from "../../core/explain/document";
import { DEFAULT_EXPLAIN_LABELS, sectionsFromSetting } from "../../core/explain/presets";
import { filterFacts, type ExplainAudience } from "../../core/explain/sources";
import { gitRunner } from "../../work/session";

export const EXPLAIN_EXPORT_COMMAND = "datapass.explain.export";
export const EXPLAIN_FOLDER = ".datapass/explain";

/** The session facts the export reads (the WorkSession behind the NavHost). */
interface ExplainSession {
  readonly root: vscode.Uri | undefined;
  readonly project: { readonly options?: OptionsFile; readonly manifest?: { readonly project?: { readonly title?: string } } };
  projectMap(): ProjectMap;
}

function sessionOf(host: NavHost): ExplainSession | undefined {
  const s = (host as unknown as { session?: Partial<ExplainSession> }).session;
  return s && typeof s.projectMap === "function" && s.project ? s as ExplainSession : undefined;
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function registerExplainExport(context: vscode.ExtensionContext, host: NavHost): vscode.Disposable {
  return vscode.commands.registerCommand(EXPLAIN_EXPORT_COMMAND, async () => {
    const session = sessionOf(host);
    const root = session?.root;
    if (!session || !root) { void vscode.window.showWarningMessage("DataPass: open a DataPass project folder to export an explainer."); return; }
    const pick = await vscode.window.showQuickPick([
      { label: "internal", audience: "internal" as ExplainAudience, detail: "Public and internal items; confidential and unclassified-as-confidential items are omitted" },
      { label: "public", audience: "public" as ExplainAudience, detail: "Only items explicitly classified public" }
    ], { title: "DataPass: explainer audience" });
    if (!pick) return;
    const config = vscode.workspace.getConfiguration("datapass.explain");
    const labels = { ...DEFAULT_EXPLAIN_LABELS, ...stringRecord(config.get("labels")) };
    const map = session.projectMap();
    const rev = await readRepoRevision(gitRunner, root.fsPath);
    const date = localDate();
    const { html, included, skipped } = buildExplainHtml({
      facts: filterFacts(pick.audience, map, session.project.options),
      sections: sectionsFromSetting(config.get("sections")),
      labels,
      projectTitle: session.project.manifest?.project?.title ?? map.project?.title ?? "DataPass project",
      ...(rev.revision !== "unversioned" ? { git: { revision: rev.revision, dirty: rev.dirty } } : {}),
      date,
      generator: `DataPass ${String(context.extension.packageJSON.version ?? "")}`.trim()
    });
    const folder = vscode.Uri.joinPath(root, ...EXPLAIN_FOLDER.split("/"));
    await vscode.workspace.fs.createDirectory(folder);
    const file = vscode.Uri.joinPath(folder, `export-${date}.html`);
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(html));
    const note = skipped.length ? ` Not included (no data source yet): ${skipped.join(", ")}.` : "";
    const choice = await vscode.window.showInformationMessage(
      `DataPass: explainer saved to ${EXPLAIN_FOLDER}/export-${date}.html (${included.length} sections, ${pick.audience}).${note}`, "Open in Browser", "Reveal File");
    if (choice === "Open in Browser") await vscode.env.openExternal(file);
    else if (choice === "Reveal File") await vscode.commands.executeCommand("revealFileInOS", file);
  });
}

function stringRecord(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (x && typeof x === "object" && !Array.isArray(x)) for (const [k, v] of Object.entries(x)) if (typeof v === "string") out[k] = v;
  return out;
}
