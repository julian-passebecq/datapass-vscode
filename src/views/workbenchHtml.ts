/**
 * HTML shell of the Workbench webviews. Pure (no `vscode`): the script is the bundled
 * dist/workbench.js, allowed by nonce; styles follow the VS Code theme variables so the workbench
 * reads like the rest of the editor in light, dark and high-contrast themes.
 */
export type WorkbenchMode = "full" | "map" | "detail";

export function workbenchHtml(opts: { cspSource: string; nonce: string; scriptUri: string; mode: WorkbenchMode; title: string }): string {
  const { cspSource, nonce, scriptUri, mode, title } = opts;
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>${title.replace(/[<>&"]/g, "")}</title>
<style>
  :root { color-scheme: light dark; --gap: 12px; --radius: 6px; --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35)));
    --ok: var(--vscode-testing-iconPassed, #3fb950); --warn: var(--vscode-editorWarning-foreground, #d29922); --bad: var(--vscode-errorForeground, #f85149);
    --info: var(--vscode-textLink-foreground, #58a6ff); --muted: var(--vscode-descriptionForeground, #8b949e); --card: var(--vscode-editorWidget-background, rgba(128,128,128,.08)); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); line-height: 1.45; }
  body[data-mode="detail"] { background: var(--vscode-sideBar-background); }
  body[data-mode="map"] { background: var(--vscode-panel-background, var(--vscode-editor-background)); }
  h1, h2, h3, h4, p { margin: 0; }
  h1 { font-size: 19px; font-weight: 600; letter-spacing: .2px; }
  h2 { font-size: 16px; font-weight: 600; margin: 2px 0 6px; }
  h3 { font-size: 13px; font-weight: 600; }
  h4 { font-size: 12px; font-weight: 600; margin: 8px 0 4px; }
  code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
  button { font: inherit; color: inherit; }
  .pad { padding: 16px; }
  .muted { color: var(--muted); }
  .small { font-size: 11.5px; }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  .eyebrow { font-size: 10.5px; letter-spacing: 1.3px; text-transform: uppercase; color: var(--info); font-weight: 600; margin: 0 0 6px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .row.tight { gap: 2px 8px; margin-top: 4px; }
  .bar { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
  .divider { border-top: 1px solid var(--border); margin: 14px 0; }
  .btn { border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; padding: 4px 10px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  .btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn.link { background: transparent; border: none; padding: 1px 2px; color: var(--vscode-textLink-foreground); }
  .btn.link:hover { text-decoration: underline; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn:focus-visible, .navrow:focus-visible, .node:focus-visible, .filerow:focus-visible, .tab:focus-visible, .check:focus-visible, .comprow:focus-visible, .spcard:focus-visible, .twisty:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .ico { opacity: .85; }
  .pill { font-size: 10.5px; border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; white-space: nowrap; line-height: 17px; }
  .pill.ok { color: var(--ok); } .pill.warn { color: var(--warn); } .pill.bad { color: var(--bad); } .pill.info { color: var(--info); } .pill.muted { color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; background: var(--muted); }
  .dot.h-ok { background: var(--ok); } .dot.h-attention { background: var(--warn); } .dot.h-blocked { background: var(--bad); } .dot.h-planned { background: transparent; border: 1px dashed var(--muted); } .dot.h-info { background: var(--info); }
  .glyph { font-family: var(--vscode-editor-font-family); font-size: 11px; min-width: 18px; text-align: center; color: var(--info); }
  .glyph.big { font-size: 15px; }

  header.top { display: grid; grid-template-columns: minmax(220px, 1fr) auto; gap: 8px 16px; padding: 14px 18px 12px; border-bottom: 1px solid var(--border); }
  header.top .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-start; justify-content: flex-end; }
  header.top .actions { grid-column: 1 / -1; }
  .shell { display: grid; grid-template-columns: 250px minmax(360px, 1fr) 340px; min-height: calc(100vh - 110px); }
  .nav { border-right: 1px solid var(--border); padding: 14px 10px; overflow: auto; }
  .center { padding: 14px 18px; overflow: auto; min-width: 0; }
  .side { border-left: 1px solid var(--border); padding: 14px 14px; overflow: auto; background: var(--vscode-sideBar-background); }
  @media (max-width: 1100px) { .shell { grid-template-columns: 220px minmax(320px, 1fr); } .side { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } }
  @media (max-width: 720px) { .shell { display: block; } .nav { border-right: 0; border-bottom: 1px solid var(--border); } }

  .navgroup { margin-bottom: 2px; }
  .navhead { display: flex; align-items: center; }
  .twisty { background: none; border: none; cursor: pointer; width: 18px; color: var(--muted); padding: 0; }
  .navrow { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 4px 6px; cursor: pointer; min-width: 0; }
  .navrow:hover { background: var(--vscode-list-hoverBackground); }
  .navrow.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .navrow .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navrow .meta { color: var(--muted); font-size: 11px; }
  .navrow.sub { padding-left: 8px; }
  .navchildren { margin-left: 18px; border-left: 1px solid var(--border); padding-left: 4px; }
  .repo { border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; margin: 6px 0; background: var(--card); }
  .repohead { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
  .repohead .label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .problem { font-size: 11.5px; border-left: 3px solid var(--warn); padding: 3px 8px; margin: 4px 0; display: grid; gap: 1px; }
  .problem.error { border-color: var(--bad); }
  .breadcrumb { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
  .objective { max-width: 420px; }

  .diagram { border: 1px solid var(--border); border-radius: 8px; background: var(--card); margin: 10px 0 14px; display: grid; }
  .diagram .scroller { overflow: auto; }
  .empty-diagram { padding: 18px; gap: 6px; }
  .sizer { position: relative; overflow: hidden; }
  .canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .legend .grow { flex: 1; }
  .edges { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
  .edge { fill: none; stroke: var(--muted); stroke-width: 1.4; opacity: .8; }
  .edge.control { stroke-dasharray: 6 4; stroke: var(--info); }
  .edge.dependency { stroke-dasharray: 2 4; }
  .edge.deployment { stroke-dasharray: 8 3 2 3; }
  .edge.hot { stroke: var(--vscode-focusBorder); stroke-width: 2.2; opacity: 1; }
  .arrow { fill: var(--muted); } .arrow.control { fill: var(--info); }
  .node { position: absolute; display: grid; grid-template-rows: auto 1fr auto; gap: 1px; text-align: left; padding: 6px 9px 6px 10px; border-radius: 7px; cursor: pointer;
    background: var(--vscode-editor-background); border: 1px solid var(--border); border-left: 4px solid var(--muted); box-shadow: 0 1px 2px rgba(0,0,0,.12); overflow: hidden; }
  .node:hover { border-color: var(--vscode-focusBorder); }
  .node.h-ok { border-left-color: var(--ok); } .node.h-attention { border-left-color: var(--warn); } .node.h-blocked { border-left-color: var(--bad); } .node.h-planned { border-style: dashed; } .node.h-info { border-left-color: var(--info); }
  .node.active { outline: 2px solid var(--vscode-focusBorder); outline-offset: 0; }
  .nodetop { display: flex; gap: 5px; align-items: center; font-size: 10.5px; color: var(--muted); overflow: hidden; white-space: nowrap; }
  .nodelabel { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nodestatus { display: flex; gap: 5px; align-items: center; font-size: 10.5px; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .canvas.compact .nodelabel { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.2; font-size: 12px; }
  .canvas.compact .nodetop .provider { overflow: hidden; text-overflow: ellipsis; }
  .legend { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 6px 10px; border-top: 1px solid var(--border); font-size: 11px; }
  .lg::before { content: ""; display: inline-block; width: 22px; border-top: 2px solid var(--muted); margin-right: 5px; vertical-align: middle; }
  .lg.control::before { border-top: 2px dashed var(--info); } .lg.dependency::before { border-top: 2px dotted var(--muted); }

  .files { margin: 8px 0 16px; }
  .filelist { border-top: 1px solid var(--border); margin-top: 6px; }
  .filerow { display: grid; grid-template-columns: minmax(140px, 1.2fr) minmax(120px, 1fr) auto; gap: 10px; align-items: center; width: 100%; text-align: left;
    background: transparent; border: none; border-bottom: 1px solid var(--border); padding: 7px 6px; cursor: pointer; }
  .filerow:hover { background: var(--vscode-list-hoverBackground); }
  .filerow.absent code { color: var(--muted); }
  .fname { overflow: hidden; text-overflow: ellipsis; }
  .note { font-size: 12px; padding: 7px 10px; border-left: 3px solid var(--info); background: var(--card); margin-top: 8px; }
  .note.bad { border-color: var(--bad); }

  .detail { display: grid; gap: 8px; }
  .card { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; background: var(--card); display: grid; gap: 4px; }
  .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
  .kv b { text-align: right; font-weight: 600; overflow-wrap: anywhere; }
  .next { border-radius: var(--radius); padding: 7px 10px; font-size: 12.5px; border: 1px solid var(--border); border-left: 4px solid var(--info); background: var(--card); }
  .next.h-blocked { border-left-color: var(--bad); } .next.h-attention { border-left-color: var(--warn); } .next.h-ok { border-left-color: var(--ok); } .next.h-planned { border-left-color: var(--muted); }
  .ops { display: grid; gap: 6px; }
  .phasehead { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; margin: 6px 0 2px; }
  .op { border: 1px solid var(--border); border-left: 3px solid var(--muted); border-radius: 5px; padding: 6px 8px; margin: 3px 0; }
  .op.t-ok { border-left-color: var(--ok); } .op.t-bad { border-left-color: var(--bad); } .op.t-warn { border-left-color: var(--warn); } .op.t-info { border-left-color: var(--info); }
  .ophead { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .oplabel { font-weight: 600; flex: 1; min-width: 120px; }
  .checklist { display: grid; gap: 2px; }
  .check, .comprow { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 4px 6px; cursor: pointer; }
  .check:hover, .comprow:hover { background: var(--vscode-list-hoverBackground); }
  .check.done .label { text-decoration: line-through; color: var(--muted); }
  .check .label, .comprow .label { flex: 1; }
  .comprow .muted { max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions-col { display: grid; gap: 6px; }
  .actions-col .btn:not(.link) { justify-content: flex-start; }
  .tool { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .needs { display: grid; gap: 4px; }
  .evidence { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 6px; }
  .overview { display: grid; gap: 12px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  .spcard { display: grid; gap: 4px; text-align: left; border: 1px solid var(--border); border-left: 4px solid var(--info); border-radius: 7px; padding: 10px 12px; background: var(--card); cursor: pointer; }
  .spcard:hover { border-color: var(--vscode-focusBorder); }
  .spcard.h-ok { border-left-color: var(--ok); } .spcard.h-attention, .spcard.h-blocked { border-left-color: var(--warn); } .spcard.h-planned { border-left-color: var(--muted); border-style: dashed; }
  .empty { padding: 28px; display: grid; gap: 10px; max-width: 720px; }
  .problems { margin: 0; padding-left: 18px; color: var(--bad); }
  .envcard { display: grid; gap: 6px; border: 1px solid var(--border); border-radius: 7px; padding: 10px 12px; background: var(--card); }
  .envcard h3 { margin: 0; font-size: 13px; }
  .envrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
  .envcard .checks { list-style: none; margin: 0; padding: 0; }

  /* map (bottom panel) */
  .map { padding: 6px 10px; display: grid; gap: 6px; }
  .map .diagram { margin: 0; }
  .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .tab { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--border); background: transparent; border-radius: 999px; padding: 2px 10px; cursor: pointer; font-size: 12px; }
  .tab.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-color: transparent; }
  .strip { font-size: 12px; padding: 2px 4px; }
  /* detail (secondary side bar) */
  body[data-mode="detail"] #app { padding: 10px 12px 18px; }
  body[data-mode="detail"] .filerow { grid-template-columns: 1fr auto; }
  body[data-mode="detail"] .frole { display: none; }
</style>
</head>
<body data-mode="${mode}">
<div id="app" role="application" aria-label="${title.replace(/[<>&"]/g, "")}"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
