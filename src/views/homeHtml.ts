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
  body { margin: 0; padding: 20px 24px 32px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: 13px; overflow-wrap: anywhere; }
  h1 { font-size: 20px; margin: 0; font-weight: 600; }
  h2 { font-size: 11px; margin: 22px 0 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); }
  h3 { font-size: 14px; margin: 0 0 4px; font-weight: 600; }
  p { margin: 0; }
  .sub { color: var(--vscode-descriptionForeground); margin-top: 4px; line-height: 1.4; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 10px; }
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
  .preview { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 8px; }
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
  ul.files { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  button.file { width: 100%; text-align: left; background: none; border: 0; padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-textLink-foreground); }
  button.file:hover { background: var(--vscode-list-hoverBackground); }
  button.file .muted { font-size: 11px; }
  .tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tools .size { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 0 2px; }
  @media (max-width: 520px) { body { padding: 12px; } .lane { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  document.addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest("button") : null;
    if (!b || b.disabled) return;
    if (b.dataset.companion) vscode.postMessage({ type: 'companion', id: b.dataset.companion });
    else if (b.dataset.environment !== undefined) vscode.postMessage({ type: "environment", id: b.dataset.environment });
    else if (b.dataset.action) vscode.postMessage({ type: "action", id: b.dataset.action });
    else if (b.dataset.hop !== undefined) vscode.postMessage({ type: "hop", index: Number(b.dataset.hop) });
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
  ${t.items?.length ? `<ul class="files">${t.items.map(f => `<li><button type="button" class="file" data-hop="${f.index}" title="${esc(f.detail)}"><strong>${esc(f.label)}</strong><span class="muted"> ${esc(f.detail)}</span></button></li>`).join("")}${t.more ? `<li class="muted">+${t.more} more</li>` : ""}</ul>` : ""}
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

/**
 * V1.1.x-POLISH-4: the toolbar at the top right — Home (restore the project layout), Appearance, the code
 * size (A− / A+, the size between them resets it) and DataPass back in the Activity Bar.
 */
export function homeTools(s: HomeState): string {
  const size = typeof s.codeFontSize === "number" ? s.codeFontSize : 14;
  const btn = (id: string, label: string, title: string) => `<button type="button" data-action="${esc(id)}" title="${esc(title)}">${esc(label)}</button>`;
  return `<div class="tools" data-tools>
  ${btn("home.restore", "⌂ Restore layout", "The Home page, the DataPass tree and the right rail as this project saved them")}
  ${btn("appearance.open", "Appearance…", "Colour theme, DataPass overlay, overlay and tree colours, diagram style, code size")}
  ${btn("font.smaller", "A−", "Smaller code text (Alt+-)")}<span class="size" title="VS Code's editor.fontSize">Code ${esc(size)} px</span>${btn("font.bigger", "A+", "Larger code text (Alt+=)")}
  ${btn("font.reset", "Reset", "Back to your usual code size")}
  ${btn("activityBar.show", "DataPass icon", "Show DataPass in the Activity Bar (right-click the Activity Bar and tick DataPass to keep it)")}
</div>`;
}

function intelligenceBody(s: HomeState): string {
  const i = s.intelligence;
  if (!s.project || !i) return '';
  const list = (entries: readonly string[], empty: string) => entries.length ? `<ul>${entries.map(e => `<li>${e}</li>`).join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`;
  const repos = list(i.repositories.map(r => `<strong>${esc(r.label)}</strong> · ${esc(r.state)} · ${esc(r.branch ?? 'branch unknown')} · ${esc(r.head?.slice(0, 12) ?? 'revision unknown')} · ${r.changes === undefined ? 'working tree unknown' : r.changes ? `${r.changes} changed entries` : 'clean'}`), 'No repository declared.');
  const env = i.environments.find(e => e.selected);
  const environments = i.environments.map(e => `<button type="button" data-environment="${esc(e.id)}" aria-pressed="${e.selected}"${e.selected ? ' class="primary"' : ''}>${esc(e.title ?? e.id)}${e.production ? ' · production' : ''}</button>`).join(' ');
  const envDetails = env ? `<h3>${esc(env.title ?? env.id)} <span class="env">DECLARED</span></h3><p>${esc(env.description)} ${env.ready}/${env.total} operations locally ready. This does not attest deployment.</p>
    ${list(env.identifiers.map(id => `${esc(id.label)}${id.provider ? ` · ${esc(id.provider)}` : ''}: <code>${esc(id.value)}</code>`), 'No non-secret target IDs declared for this environment.')}
    ${list(env.operations.map(op => `${esc(op.component)} → ${esc(op.label)} · ${esc(op.readiness)}${op.target ? ` · ${esc(JSON.stringify(op.target))}` : ''}<br>${esc(op.nextStep)}<br>Participating local files: ${op.files.map(f => esc(f)).join(', ') || 'none declared'}${op.prerequisites.length ? `<br>Missing/review: ${op.prerequisites.map(p => esc(p)).join('; ')}` : ''}`), 'No applicable operation declared.')}
    ${list(env.bindings.map(b => `${esc(b.id)} → ${esc(b.resource)}${b.folder ? ` · declared folder ${esc(b.folder)}` : ''}`), 'No resource/folder binding declared.')}
    ${list(env.branches.map(b => `${esc(b.repo)}: declared branch ${esc(b.branch)} (project-wide declaration)`), 'No branch binding declared.')}
    <div class="actions">${env.links.map(l => `<button type="button" data-group="${l.group}" data-index="${l.index}">${esc(l.label)}</button>`).join('')}</div>` : '<p class="muted">Select a declared environment. Selection changes context only.</p>';
  const c = i.coverage;
  const coverage = c.analyzed ? `<p>${Object.entries(c.counts).map(([state, count]) => `<strong>${count}</strong> ${esc(state)}`).join(' · ')}</p><p>Edge evidence: ${Object.entries(c.origins).map(([origin, count]) => `${count} ${esc(origin)}`).join(' · ') || 'no edges'}</p>
    ${list(c.gaps.map(g => `<code>${esc(g.repo)}/${esc(g.path)}</code> · ${esc(g.status)} · ${esc(g.reasons.join(', '))}`), 'No reported gaps in the analyzed files. This is not a completeness guarantee.')}
    ${list(c.limits.map(l => esc(l)), 'No discovery limit reached.')}` : '<p class="muted">Not analyzed. No file is claimed understood before analysis.</p>';
  const themes = list(i.themes.map(t => `<strong>${esc(t.title)}</strong> · declared project scope · ${esc(t.objective)}<br>${t.components.map(c => esc(c.label)).join(', ')} · ${t.files.length} declared files · ${t.lineageEdges} related edges · ${t.verification.length} recorded verification results. Feature/branch association is not declared.`), 'No project scope declared. Branch names do not establish features or shipping status.');
  const sankey = list(i.sankey.map(flow => `<strong>${esc(flow.label)}</strong> → ${flow.components.map(c => esc(c.label)).join(', ') || 'no declared component'} <span class="env">${flow.components.length} components</span>`), 'No repository/component relationship declared.');
  return `<section data-project-intelligence><nav aria-label="Project navigation"><span>Home / ${esc(s.project.title)}</span><div class="actions">${actionButton({ id: 'navigation.back', label: 'Back' }, false)}${actionButton({ id: 'navigation.forward', label: 'Forward' }, false)}${actionButton({ id: 'navigation.up', label: 'Up' }, false)}${actionButton({ id: 'navigation.down', label: 'Down' }, false)}${actionButton({ id: 'navigation.inspector', label: 'Inspector' }, false)}</div></nav><h2>Project</h2><div class="preview"><p>Variant/scenario: ${esc(i.selectedVariant ?? 'current')} · ${i.readiness.opsReady}/${i.readiness.opsTotal} operations locally ready · ${i.readiness.filesFound}/${i.readiness.filesExpected} expected files found</p>${repos}</div>
    <h2>Environments</h2><div class="preview" data-environments><div class="actions">${environments || '<span>No logical environment declared.</span>'}</div>${envDetails}</div>
    <h2>Lineage coverage</h2><div class="preview" data-lineage-coverage>${coverage}<div class="actions">${actionButton({ id: 'intelligence.analyze', label: 'Analyze project locally' }, true)}${actionButton({ id: 'intelligence.lineage', label: 'Open project lineage' }, false)}${actionButton({ id: 'intelligence.tours', label: 'Guided paths…' }, false)}</div></div>
    <h2>Features / themes</h2><div class="preview">${themes}</div>
    ${i.sourceExplanations.length ? `<h2>Notebook / Spark source context</h2><div class="preview">${list(i.sourceExplanations.map(e => `<strong>${esc(e.label)}</strong> <span class="env">DECLARED / CONCEPTUAL</span><p>${esc(e.explanation)}</p><p>Local source: ${e.files.map(f => esc(f)).join(', ') || 'not declared'} · Available local routes: ${e.operations.map(op => esc(op)).join(', ') || 'none declared'}</p>`), '')}</div>` : ''}
    <h2>Project evolution / light Git</h2><div class="preview">${repos}<h3>Repository → component Sankey</h3><p class="muted">Weight unit: declared components. Counts do not measure effort or productivity.</p>${sankey}${actionButton({ id: 'intelligence.sankey', label: 'Open the Sankey' }, false)}</div>
    ${(s.companions?.length ?? 0) > 0 ? `<h2>Open in companion</h2><div class="actions">${s.companions!.map(key => `<button type="button" data-companion="${esc(key)}">${esc({ deployment: 'Open deployment plan in Cloud Studio', resource: 'Open resource in Cloud Studio', uri: 'Inspect source in X-Ray', evidence: 'Inspect evidence in X-Ray', revision: 'Open revision in Tern' }[key])}</button>`).join('')}</div>` : ''}</section>`;
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
  <p class="sub" data-home-layout>The Home button (status bar, tree and rail title bars) restores ${s.homeLayout ? `the layout <strong>${esc(s.homeLayout)}</strong>, then this page, the DataPass tree and the rail.` : `this page, the DataPass tree and the rail. Save a layout named "Home" to make it restore your files and views too.`}</p>
  <div class="actions">${actionButton({ id: "layout.save", label: "Save this layout…" }, true)}${actionButton({ id: "layout.saveHome", label: "Save as my Home layout" }, false)}${s.layouts.length ? actionButton({ id: "layout.manage", label: "Rename, delete, startup…" }, false) : ""}</div>
</div>`;
  const noProject = s.project ? "" : `<div class="actions" style="margin-top:10px">${actionButton({ id: "project.open", label: "Open a client project…" }, true)}${actionButton({ id: "project.guide", label: "How to prepare a project" }, false)}</div>`;
  return `<div class="top"><div><h1>${esc(title)}</h1><p class="sub">${esc(s.project?.description ?? "Pick a module: each one opens on its own.")}</p></div>${homeTools(s)}</div>${noProject}
${intelligenceBody(s)}
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
