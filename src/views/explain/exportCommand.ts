/**
 * V5 EXPLAIN1 (TL-8) command `datapass.explain.export`: asks the audience, renders the explainer page
 * (src/core/explain) from the session's facts and saves it under `.datapass/explain/export-<date>.html`.
 * V5HOLE6: works on any opened folder. Without a DataPass project the project-only sections are declared holes
 * and the person picks the file (default: the workspace folder root); nothing is written under `.datapass`.
 * Nothing is uploaded: the person opens the file in their browser (button) and shares it themselves.
 */
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import { readRepoRevision } from "../../core/workspace/gitBase";
import { buildExplainHtml } from "../../core/explain/document";
import { DEFAULT_EXPLAIN_LABELS, sectionsFromSetting } from "../../core/explain/presets";
import { bareFacts, filterFacts, type ExplainAudience } from "../../core/explain/sources";
import { EXPLAIN_FOLDER, explainTarget } from "../../core/explain/target";
import { gitRunner } from "../../work/session";
import { label } from "../../webview/views/model";
import { pickExportTour } from "./tourPick";

export const EXPLAIN_EXPORT_COMMAND = "datapass.explain.export";
export { EXPLAIN_FOLDER };

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function registerExplainExport(context: vscode.ExtensionContext, host: NavHost): vscode.Disposable {
  return vscode.commands.registerCommand(EXPLAIN_EXPORT_COMMAND, async (arg?: unknown) => {
    const session = host.session;
    const root = session.root;
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
    const pick = await vscode.window.showQuickPick([
      { label: "internal", audience: "internal" as ExplainAudience, detail: "Public and internal items; confidential and unclassified-as-confidential items are omitted" },
      { label: "public", audience: "public" as ExplainAudience, detail: "Only items explicitly classified public" }
    ], { title: "DataPass: explainer audience" });
    if (!pick) return;
    // V5 TOURSHARE1: "Include tour…" (No tour = default; `{ includeTour: true }` skips it).
    const tourPlayer = await pickExportTour(host, arg);
    if (tourPlayer === null) return;
    const config = vscode.workspace.getConfiguration("datapass.explain");
    const labels = { ...DEFAULT_EXPLAIN_LABELS, ...stringRecord(config.get("labels")) };
    const map = session.projectMap();
    const gitFolder = root ?? workspace;
    const rev = gitFolder ? await readRepoRevision(gitRunner, gitFolder.fsPath) : { revision: "unversioned", dirty: false };
    const date = localDate();
    const { html, included, skipped } = buildExplainHtml({
      facts: root ? filterFacts(pick.audience, map, session.project?.options) : bareFacts(pick.audience, map),
      sections: sectionsFromSetting(config.get("sections")),
      labels,
      projectTitle: session.project?.manifest?.project?.title ?? map.project?.title ?? (root ? undefined : vscode.workspace.workspaceFolders?.[0]?.name) ?? "DataPass project",
      ...(rev.revision !== "unversioned" ? { git: { revision: rev.revision, dirty: rev.dirty } } : {}),
      date,
      generator: `DataPass ${String(context.extension.packageJSON.version ?? "")}`.trim(),
      ...(tourPlayer ? { tourPlayer } : {})
    });
    const target = explainTarget(!!root, !!workspace, date);
    const base = target.base === "project" ? root : target.base === "workspace" ? workspace : undefined;
    let file = base ? vscode.Uri.joinPath(base, ...target.segments) : undefined;
    if (target.ask) {
      file = await vscode.window.showSaveDialog({ title: "DataPass: save the explainer page", filters: { HTML: ["html"] },
        ...(file ? { defaultUri: file } : {}) });
      if (!file) return;
    } else if (file) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, ".."));
    }
    if (!file) return;
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(html));
    const shown = target.ask ? vscode.workspace.asRelativePath(file) : target.segments.join("/");
    const note = !root ? ` ${label(labels, "export.bareNote")}`
      : skipped.length ? ` Not included (no data source yet): ${skipped.join(", ")}.` : "";
    const choice = await vscode.window.showInformationMessage(
      `DataPass: explainer saved to ${shown} (${included.length} sections, ${pick.audience}${tourPlayer ? `, tour "${tourPlayer.title}"` : ""}).${note}`, "Open in Browser", "Reveal File");
    if (choice === "Open in Browser") await vscode.env.openExternal(file);
    else if (choice === "Reveal File") await vscode.commands.executeCommand("revealFileInOS", file);
  });
}

function stringRecord(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (x && typeof x === "object" && !Array.isArray(x)) for (const [k, v] of Object.entries(x)) if (typeof v === "string") out[k] = v;
  return out;
}
