/**
 * Styles of the `graph` layout kind, in the Workbench diagram's look (`.canvas`, `.node`, `.lane`, `.edge`) on theme
 * tokens only. Pure string, included by `views/viewHtml.ts` so every nav webview can draw a graph.
 */
export function navGraphCss(): string {
  return `
  .nv-graph .scroller { overflow: auto; max-width: 100%; }
  .nv-graph-canvas { position: relative; }
  .nv-graph .lane { position: absolute; border: 1px dashed var(--nv-border); border-left: 3px solid var(--nv-lane, var(--nv-border)); border-radius: 8px; background: rgba(128,128,128,.035); }
  .nv-graph .lanehead { position: absolute; left: 6px; top: 2px; font-size: 11px; font-weight: 600; color: var(--nv-muted); padding: 0 4px; }
  .nv-graph .edges { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
  .nv-graph .edge { fill: none; stroke-width: 1.4; opacity: .8; }
  .nv-graph .edge.backward { opacity: .5; }
  .nv-graph .arrow { fill: var(--nv-muted); }
  .nv-graph .node { position: absolute; display: grid; grid-template-rows: auto 1fr auto; gap: 1px; padding: 6px 9px 6px 10px; border-radius: 4px; cursor: pointer; overflow: hidden;
    background: var(--vscode-editor-background); color: var(--vscode-foreground); border: 1px solid var(--nv-node-border, var(--nv-border)); border-left: 3px solid var(--nv-accent, var(--nv-muted)); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .nv-graph .node:hover, .nv-graph .node:focus { border-color: var(--nv-focus); }
  .nv-graph .node.shape-cylinder, .nv-graph .node.shape-storage { border-radius: 24px 24px 5px 5px / 9px 9px 5px 5px; }
  .nv-graph .node.shape-rounded, .nv-graph .node.shape-pill { border-radius: 13px; }
  .nv-graph .node.border-dashed { border-style: dashed; } .nv-graph .node.border-dotted { border-style: dotted; }
  .nv-graph .node.uncertain { opacity: .85; border-style: dashed; }
  .nv-graph .node.nv-current { outline: 2px solid var(--nv-here); outline-offset: 1px; }
  .nv-graph .nodetop { font-size: 10px; color: var(--nv-muted); text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nv-graph .nodelabel { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nv-graph .nv-origin { justify-self: start; }
  .nv-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; padding: 0; margin: 8px 0 0; color: var(--nv-muted); font-size: 11px; }
  .nv-legend li { display: inline-flex; gap: 5px; align-items: center; }
  .nv-swatch { width: 12px; height: 12px; border-radius: 3px; background: var(--nv-swatch); }
  .nv-legend-edge .nv-swatch { height: 3px; border-radius: 1px; }
  `;
}
