/**
 * V4-NAV shared HTML shell for every nav webview (view host, navigator…): strict CSP (nonce script, theme styles),
 * the `#nav-root` mount point for dist/navView.js, and the renderer's styles on VS Code theme tokens only.
 * Pure (no `vscode`), like workbenchHtml.ts.
 */
export function viewHtml(opts: { cspSource: string; nonce: string; scriptUri: string; title: string }): string {
  const { cspSource, nonce, scriptUri, title } = opts;
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>${title.replace(/[<>&"]/g, "")}</title>
<style>${navViewCss()}</style>
</head>
<body>
<div id="nav-root" class="nv-root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** Renderer styles: theme variables only, so light, dark and high-contrast themes all read. */
export function navViewCss(): string {
  return `
  :root { color-scheme: light dark; --nv-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35)));
    --nv-muted: var(--vscode-descriptionForeground, #8b949e); --nv-card: var(--vscode-editorWidget-background, rgba(128,128,128,.08));
    --nv-focus: var(--vscode-focusBorder, #0078d4); --nv-warn: var(--vscode-editorWarning-foreground, #d29922); }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); }
  button { font: inherit; color: inherit; }
  :focus-visible { outline: 1px solid var(--nv-focus); outline-offset: 1px; }
  .nv-header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--nv-border); }
  .nv-location { display: flex; gap: 6px; align-items: baseline; }
  .nv-level, .nv-kind { color: var(--nv-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .8px; }
  .nv-node { font-weight: 600; }
  .nv-views { display: flex; gap: 2px; }
  .nv-tab { background: none; border: 1px solid transparent; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
  .nv-tab.nv-active { border-color: var(--nv-border); background: var(--vscode-tab-activeBackground, var(--nv-card)); }
  .nv-main { padding: 12px; }
  .nv-empty, .nv-loading, .nv-muted { color: var(--nv-muted); }
  .nv-table { border-collapse: collapse; width: 100%; }
  .nv-table th, .nv-table td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--nv-border); vertical-align: top; }
  .nv-table th { color: var(--nv-muted); font-weight: 600; }
  .nv-selectable { cursor: pointer; }
  .nv-selectable:hover, .nv-selectable:focus { background: var(--vscode-list-hoverBackground, var(--nv-card)); }
  .nv-card { background: var(--nv-card); border: 1px solid var(--nv-border); border-radius: 6px; padding: 10px 12px; margin: 0 0 10px; }
  .nv-card h3 { margin: 0 0 6px; font-size: 13px; }
  .nv-card dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 0; }
  .nv-card dt { color: var(--nv-muted); } .nv-card dd { margin: 0; }
  .nv-value { display: inline-flex; gap: 6px; align-items: baseline; }
  .nv-origin { font-size: 10px; padding: 0 5px; border-radius: 8px; border: 1px solid var(--nv-border); color: var(--nv-muted); }
  .nv-origin-observed { border-color: var(--vscode-testing-iconPassed, #3fb950); }
  .nv-origin-ai-proposed { border-color: var(--vscode-charts-purple, #b180d7); }
  .nv-origin-theoretical { border-style: dashed; }
  .nv-holes { margin-top: 10px; display: grid; gap: 4px; }
  .nv-hole { display: flex; gap: 8px; align-items: baseline; padding: 4px 8px; border-left: 3px solid var(--nv-warn); background: var(--nv-card); }
  .nv-hole-kind { color: var(--nv-warn); font-weight: 600; font-size: 11px; }
  .nv-surface-open { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
  .nv-surface-open:hover { background: var(--vscode-button-hoverBackground); }
  `;
}
