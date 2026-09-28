/**
 * V3-SHELL (vision §2.1): the thin right rail — a vertical column of buttons shown in the DataPass
 * secondary side bar instead of the full panel (AI, Claude & Codex, Details) while rail mode is on.
 * Each button expands the panel on the matching view or runs one route. Pure (no `vscode`): one
 * inline script allowed by nonce, theme variables only; buttons send an id from RAIL_BUTTONS and
 * the extension host maps it to a command.
 */

export interface RailButton {
  id: string;
  glyph: string;
  label: string;
  title: string;
}

export const RAIL_BUTTONS: readonly RailButton[] = [
  { id: "expand", glyph: "⇤", label: "Expand", title: "Expand the full DataPass panel (AI, Claude & Codex, Details)" },
  { id: "details", glyph: "ⓘ", label: "Details", title: "The selected component or sub-project" },
  { id: "ai", glyph: "✦", label: "AI", title: "The AI view: guided exchange, work orders, manual routes" },
  { id: "git", glyph: "⑂", label: "Git", title: "The Git lens of the left tree: Needs you, repositories, pull requests" },
  { id: "airflow", glyph: "⋔", label: "DAG", title: "The Airflow DAG view: the tasks and dependencies of the Airflow file in the editor" },
  { id: "copyForAi", glyph: "⇪", label: "Export", title: "Copy a DataPass file with its context for your AI" },
  { id: "importFromAi", glyph: "⇩", label: "Import", title: "Paste your AI's answer (reviewed before anything is written)" },
  { id: "workViews", glyph: "▤", label: "Views", title: "Work views: saved layouts, sub-projects and other projects" },
  { id: "ownWindow", glyph: "⧉", label: "Window", title: "Open the Workbench in its own window (a second screen)" }
];

export const RAIL_BUTTON_IDS: readonly string[] = RAIL_BUTTONS.map(b => b.id);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function railHtml(cspSource: string, nonce: string): string {
  const buttons = RAIL_BUTTONS.map(b => `<button type="button" data-id="${esc(b.id)}" title="${esc(b.title)}" aria-label="${esc(`${b.label}: ${b.title}`)}"><span class="g" aria-hidden="true">${esc(b.glyph)}</span><span class="l">${esc(b.label)}</span></button>`).join("\n");
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>DataPass rail</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 4px 0; }
  nav { display: flex; flex-direction: column; align-items: stretch; gap: 2px; max-width: 64px; }
  button { font: inherit; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 2px; color: var(--vscode-foreground);
    background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .g { font-size: 1.35em; line-height: 1.1; }
  .l { font-size: 0.78em; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<nav aria-label="DataPass rail">
${buttons}
</nav>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  for (const b of document.querySelectorAll('button[data-id]')) b.addEventListener('click', () => vscode.postMessage({ type: 'rail', id: b.getAttribute('data-id') }));
  const size = () => vscode.postMessage({ type: 'width', width: window.innerWidth });
  window.addEventListener('resize', size);
  size();
</script>
</body>
</html>`;
}
