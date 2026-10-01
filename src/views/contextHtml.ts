/**
 * V4-NAV NAVCTX1: HTML of the DataPass Context view (bottom panel). Pure (no `vscode`): one inline
 * script allowed by nonce, no remote content. Section text is set with textContent only, never as
 * HTML. ←/→ inside the view cycle the tabs (wrapping); the host is told which tab is active.
 * Host → `{type:"context", sections, active, labels}`; webview → `{type:"ready"}` | `{type:"tab", id}`.
 */
export function contextHtml(cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 8px; }
  #tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-panel-background); }
  #tabs button { background: none; border: none; border-bottom: 2px solid transparent; color: var(--vscode-foreground); opacity: .75; padding: 4px 8px; cursor: pointer; font: inherit; }
  #tabs button[aria-selected="true"] { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
  #tabs button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .badge { display: inline-block; font-size: .85em; padding: 0 6px; border-radius: 8px; margin: 6px 0; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge.ai-proposed { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-foreground); border: 1px solid var(--vscode-inputValidation-warningBorder); }
  #body { white-space: pre-wrap; }
  #holes { color: var(--vscode-descriptionForeground); padding-left: 18px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: .9em; margin-top: 8px; }
</style>
</head>
<body>
<div id="tabs" role="tablist" tabindex="0"></div>
<section id="panel" role="tabpanel">
  <span id="origin" class="badge"></span>
  <div id="body"></div>
  <ul id="holes"></ul>
</section>
<div class="hint" id="hint"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let sections = [], active = 0, labels = {};
  const el = id => document.getElementById(id);
  function render() {
    const tabs = el("tabs"); tabs.textContent = "";
    sections.forEach((s, i) => {
      const b = document.createElement("button");
      b.textContent = s.title; b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === active));
      b.addEventListener("click", () => select(i));
      tabs.appendChild(b);
    });
    const s = sections[active];
    el("origin").textContent = s ? (labels.origins && labels.origins[s.origin]) || s.origin : "";
    el("origin").className = "badge " + (s ? s.origin : "");
    el("origin").hidden = !s || s.origin === "none";
    el("body").textContent = s ? s.body : "";
    const holes = el("holes"); holes.textContent = "";
    (s ? s.holes : []).forEach(h => { const li = document.createElement("li"); li.textContent = h.reason; holes.appendChild(li); });
    el("hint").textContent = labels.hint || "";
  }
  function select(i) {
    if (!sections.length) return;
    active = (i + sections.length) % sections.length;
    render();
    vscode.postMessage({ type: "tab", id: sections[active].id });
  }
  document.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight") { select(active + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { select(active - 1); e.preventDefault(); }
  });
  window.addEventListener("message", e => {
    const m = e.data;
    if (!m || m.type !== "context" || !Array.isArray(m.sections)) return;
    sections = m.sections; labels = m.labels || {};
    const i = sections.findIndex(s => s.id === m.active);
    active = i >= 0 ? i : 0;
    render();
  });
  vscode.postMessage({ type: "ready" });
})();
</script>
</body>
</html>`;
}
