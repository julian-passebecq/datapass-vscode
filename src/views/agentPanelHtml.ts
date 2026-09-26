/**
 * HTML of the Claude & Codex panel (pass AI-3, handoff/v3/09 §8.7). Pure (no `vscode`): one inline
 * script allowed by nonce, theme variables only, everything rendered with textContent. The webview
 * never holds a URL: buttons send a link index or a row key, and the extension host opens the link
 * after checking it again.
 */
export function agentPanelHtml(cspSource: string, nonce: string): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>Claude &amp; Codex</title>
<style>
  :root { color-scheme: light dark; --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35)));
    --ok: var(--vscode-testing-iconPassed, #3fb950); --warn: var(--vscode-editorWarning-foreground, #d29922); --bad: var(--vscode-errorForeground, #f85149); }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 6px 10px 10px; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
  .dot.on { color: var(--ok); } .dot.off { color: var(--vscode-descriptionForeground); }
  .muted { color: var(--vscode-descriptionForeground); } .small { font-size: 0.92em; } .warn { color: var(--warn); } .bad { color: var(--bad); }
  .links { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
  button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--border); border-radius: 3px; padding: 2px 8px; cursor: pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.link { background: none; border: none; color: var(--vscode-textLink-foreground); padding: 0 2px; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  h3 { font-size: 0.85em; text-transform: uppercase; letter-spacing: .04em; margin: 10px 0 4px; color: var(--vscode-descriptionForeground); font-weight: 600; }
  .row { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; }
  .row .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { white-space: nowrap; min-width: 82px; }
  .note { border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; margin: 6px 0; }
</style>
</head>
<body>
<div class="head"><span id="status" class="small">Claude Control …</span><span><button class="link" id="refresh" title="Read Claude Control again">⟳</button></span></div>
<div class="links" id="links"></div>
<div id="body"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') e.textContent = String(v);
      else if (k === 'onclick') e.addEventListener('click', v);
      else e.setAttribute(k, String(v));
    }
    for (const kid of kids) if (kid) e.appendChild(kid);
    return e;
  }
  const send = m => vscode.postMessage(m);
  $('refresh').addEventListener('click', () => send({ type: 'refresh' }));

  function render(s) {
    const c = s.control;
    const status = $('status');
    status.textContent = '';
    const on = c.state === 'on';
    status.appendChild(el('span', { class: 'dot ' + (on ? 'on' : 'off'), text: on ? '●' : '○' }));
    status.appendChild(el('span', { text: ' Control ' + (on ? 'on' : c.state === 'unknown' ? '…' : c.state === 'disabled' ? 'switched off' : 'off') + (c.checkedAt ? ' · ' + c.checkedAt : '') }));

    const links = $('links');
    links.textContent = '';
    for (const l of s.links) links.appendChild(el('button', { text: l.label, title: l.title, onclick: () => send({ type: 'openLink', index: l.index }) }));
    links.appendChild(el('button', { class: 'link', text: '⚙ links', title: 'datapass.ai.quickLinks', onclick: () => send({ type: 'settings' }) }));

    const body = $('body');
    body.textContent = '';
    for (const r of s.refused) body.appendChild(el('div', { class: 'small warn', text: r }));
    if (c.message) {
      const note = el('div', { class: 'note small' }, el('div', { text: c.message }));
      if (c.state === 'off') {
        if (c.detail) note.appendChild(el('div', { class: 'muted', text: c.detail }));
        note.appendChild(el('div', {}, el('button', { text: 'Copy the start command', onclick: () => send({ type: 'copyStart' }) })));
      }
      body.appendChild(note);
    }
    if (s.plan) body.appendChild(el('div', { class: 'small', text: 'Plan  ' + [s.plan.fiveHour !== undefined ? '5-hour ' + s.plan.fiveHour + ' %' : '', s.plan.week !== undefined ? 'week ' + s.plan.week + ' %' : ''].filter(Boolean).join('  ·  ') }));
    if (on && !s.projects.length) body.appendChild(el('div', { class: 'muted small', text: s.hasProject ? 'Claude Control has no project named ' + (s.tried.join(', ') || 'like this project\'s folders') + '.' : 'Open a DataPass project to see its conversations.' }));
    for (const p of s.projects) {
      body.appendChild(el('h3', { text: 'This project · ' + p.name }));
      if (!p.conversations.length && !p.prs.length) body.appendChild(el('div', { class: 'muted small', text: 'No conversation running or waiting for you.' }));
      for (const cv of p.conversations) body.appendChild(el('div', { class: 'row small' },
        el('span', { class: 'status ' + (cv.status === 'needs-you' ? 'warn' : ''), text: cv.statusText }),
        el('span', { class: 'grow', text: cv.title + (cv.tokens ? ' · ' + cv.tokens : ''), title: cv.title }),
        cv.openable ? el('button', { class: 'link', text: 'Open in Claude', onclick: () => send({ type: 'open', key: cv.key }) }) : null));
      for (const pr of p.prs) body.appendChild(el('div', { class: 'row small' },
        el('span', { class: 'status muted', text: '◌ PR open' }), el('span', { class: 'grow', text: pr.text, title: pr.text }),
        pr.openable ? el('button', { class: 'link', text: 'PR', onclick: () => send({ type: 'open', key: pr.key }) }) : null));
      for (const a of p.alerts) body.appendChild(el('div', { class: 'row small' },
        el('span', { class: 'status bad', text: '! urgent' }), el('span', { class: 'grow', text: a.text, title: a.text }),
        a.openable ? el('button', { class: 'link', text: 'Open', onclick: () => send({ type: 'open', key: a.key }) }) : null));
      if (p.todo.length) {
        body.appendChild(el('h3', { text: 'À faire par toi (' + p.todo.length + ')' }));
        for (const t of p.todo) body.appendChild(el('div', { class: 'small', text: '· ' + [t.date ? t.date.slice(5) : '', t.what, t.duration || ''].filter(Boolean).join('  ·  ') }));
      }
    }
    body.appendChild(el('p', { class: 'muted small', text: s.codex.cli
      ? 'Codex CLI found: a Codex app hand-off also opens the folder in the ChatGPT app (codex app).'
      : 'Codex: hand-offs copy the prompt and open the ChatGPT app. Set datapass.ai.codex.path to use the Codex CLI.' }));
  }

  window.addEventListener('message', e => { const m = e.data; if (m && m.type === 'state' && m.state) render(m.state); });
  send({ type: 'ready' });
</script>
</body>
</html>`;
}
