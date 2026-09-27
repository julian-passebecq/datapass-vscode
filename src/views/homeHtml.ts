/**
 * The DataPass Home and Project links pages (V3-HOME). Pure (no `vscode`): the page is rendered on
 * the extension side from HomeState, every text escaped; the small script only turns clicks into
 * messages ({ type: "action", id } / { type: "layout", id } / { type: "link", group, index }).
 */
import type { HomeAction, HomeLinks, HomeState, HomeTile } from "./homeState";

export type HomePage = "home" | "links";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]!);

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 24px 32px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: 13px; }
  h1 { font-size: 20px; margin: 0; font-weight: 600; }
  h2 { font-size: 11px; margin: 22px 0 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); }
  h3 { font-size: 14px; margin: 0 0 4px; font-weight: 600; }
  p { margin: 0; }
  .sub { color: var(--vscode-descriptionForeground); margin-top: 4px; line-height: 1.4; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  .tile { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; padding: 12px; background: var(--vscode-sideBar-background); display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .tile.coming { opacity: .75; border-style: dashed; }
  .tile.attention { border-color: var(--vscode-editorWarning-foreground); }
  .tile .summary { color: var(--vscode-descriptionForeground); line-height: 1.4; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font-family: inherit; font-size: 12px; cursor: pointer; border-radius: 4px; padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { cursor: default; opacity: .5; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-left: 6px; vertical-align: middle; }
  .preview { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; padding: 12px; display: grid; gap: 8px; }
  .lane { display: grid; grid-template-columns: minmax(90px, 160px) 1fr; gap: 8px; align-items: start; }
  .lane-title { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 4px; padding: 2px 6px; font-size: 11px; background: var(--vscode-editor-background); }
  .chip.more { color: var(--vscode-descriptionForeground); border-style: dashed; }
  .layouts { display: grid; gap: 6px; }
  .layout { display: flex; justify-content: space-between; align-items: center; gap: 10px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding: 6px 0; }
  .layout:last-child { border-bottom: 0; }
  .muted { color: var(--vscode-descriptionForeground); }
  .error { color: var(--vscode-errorForeground); }
  .warn { color: var(--vscode-editorWarning-foreground); }
  .group { margin-bottom: 16px; }
  .link { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .link:last-child { border-bottom: 0; }
  .kind { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); margin-right: 6px; }
  .env { font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); margin-left: 6px; }
  ul.problems { margin: 6px 0 0; padding-left: 18px; }
  @media (max-width: 520px) { body { padding: 12px; } .lane { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  document.addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest("button") : null;
    if (!b || b.disabled) return;
    if (b.dataset.action) vscode.postMessage({ type: "action", id: b.dataset.action });
    else if (b.dataset.layout) vscode.postMessage({ type: "layout", id: b.dataset.layout });
    else if (b.dataset.group !== undefined) vscode.postMessage({ type: "link", group: Number(b.dataset.group), index: Number(b.dataset.index) });
  });
`;

function actionButton(a: HomeAction, primary: boolean): string {
  return `<button type="button" data-action="${esc(a.id)}"${primary ? ` class="primary"` : ""}${a.disabled ? ` disabled title="${esc(a.disabled)}"` : ""}>${esc(a.label)}</button>`;
}

function tileHtml(t: HomeTile): string {
  return `<section class="tile${t.coming ? " coming" : ""}${t.attention ? " attention" : ""}" data-tile="${esc(t.id)}">
  <h3>${esc(t.title)}${t.coming ? `<span class="badge">coming</span>` : ""}</h3>
  <p class="summary">${esc(t.summary)}</p>
  ${t.actions.length ? `<div class="actions">${t.actions.map((a, i) => actionButton(a, i === 0)).join("")}</div>` : ""}
</section>`;
}

function linksBody(l: HomeLinks): string {
  if (l.state === "none") return `<p class="muted">${esc(l.howTo)}</p>`;
  if (l.state === "error") return `<p class="error">links.json has errors — nothing is listed until it is fixed.</p><ul class="problems"><li>${esc(l.error)}</li></ul><div class="actions" style="margin-top:8px">${actionButton({ id: "links.file", label: "Open links.json" }, true)}</div>`;
  const warnings = l.warnings.length ? `<ul class="problems warn">${l.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
  return warnings + l.groups.map(g => `<div class="group"><h2>${esc(g.title)}</h2>${g.description ? `<p class="sub">${esc(g.description)}</p>` : ""}
${g.links.map(k => `<div class="link" data-link="${k.group}:${k.index}">
  <div><span class="kind">${esc(k.kindLabel)}</span><strong>${esc(k.label)}</strong>${k.environment ? `<span class="env">${esc(k.environment)}</span>` : ""}
  <div class="sub">${esc(k.host)}${k.local ? " · on this computer" : ""}${k.description ? ` — ${esc(k.description)}` : ""}</div></div>
  <button type="button" data-group="${k.group}" data-index="${k.index}" title="Opens in your browser after a confirmation">Open ↗</button>
</div>`).join("")}</div>`).join("");
}

function homeBody(s: HomeState): string {
  const title = s.project ? s.project.title : "DataPass";
  const preview = s.preview ? `<h2>Architecture at a glance</h2>
<div class="preview" data-preview>
  ${s.preview.lanes.map(l => `<div class="lane"><div class="lane-title" title="${esc(l.title)}">${esc(l.title)}</div><div class="chips">${l.components.map(c => `<span class="chip">${esc(c)}</span>`).join("")}${l.more ? `<span class="chip more">+${l.more}</span>` : ""}</div></div>`).join("")}
  <div class="top"><span class="muted">${s.preview.components} component(s), ${s.preview.relations} link(s) between them</span>${actionButton({ id: "architecture.workbench", label: "Open the full diagram" }, false)}</div>
</div>` : "";
  const layouts = `<h2>My layouts</h2>
<div class="preview">
  <p class="sub">A layout keeps the open files, the Workbench, the visible DataPass views, the diagram settings and this Home tab — on this computer only. Modules you close load nothing.</p>
  ${s.layoutsError ? `<p class="error">${esc(s.layoutsError)}</p>` : ""}
  ${s.layouts.length ? `<div class="layouts">${s.layouts.map(v => `<div class="layout"><div><strong>${esc(v.name)}</strong>${v.project ? `<span class="env">${esc(v.project)}</span>` : ""}<div class="sub">${esc(v.detail)}</div></div><button type="button" data-layout="${esc(v.id)}">Apply</button></div>`).join("")}</div>` : `<p class="muted">No saved layout yet: open the modules you want, arrange them, then save.</p>`}
  <div class="actions">${actionButton({ id: "layout.save", label: "Save this layout…" }, true)}${s.layouts.length ? actionButton({ id: "layout.manage", label: "Rename, delete, startup…" }, false) : ""}</div>
</div>`;
  const noProject = s.project ? "" : `<div class="actions" style="margin-top:10px">${actionButton({ id: "project.open", label: "Open a client project…" }, true)}${actionButton({ id: "project.guide", label: "How to prepare a project" }, false)}</div>`;
  return `<div class="top"><div><h1>${esc(title)}</h1><p class="sub">${esc(s.project?.description ?? "Pick a module: each one opens on its own.")}</p></div></div>${noProject}
${s.areas.map(a => `<h2>${esc(a.title)}</h2><div class="tiles" data-area="${esc(a.id)}">${a.tiles.map(tileHtml).join("")}</div>`).join("\n")}
${preview}
${layouts}`;
}

function linksPage(s: HomeState): string {
  const title = s.links.title ?? "Project links";
  return `<div class="top"><div><h1>${esc(title)}</h1><p class="sub">${esc(s.project?.title ?? "")}${s.project ? " · " : ""}from .datapass/links.json. DataPass opens a link in your browser after a confirmation; it never calls these pages itself.</p></div>
<div class="actions">${actionButton({ id: "links.home", label: "Home" }, false)}${s.links.state !== "none" ? actionButton({ id: "links.file", label: "Open links.json" }, false) : ""}</div></div>
${linksBody(s.links)}`;
}

export function homeHtml(state: HomeState, page: HomePage, cspSource: string, nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>${page === "links" ? "Project links" : "DataPass Home"}</title>
<style>${STYLE}</style>
</head>
<body data-page="${page}">
${page === "links" ? linksPage(state) : homeBody(state)}
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
