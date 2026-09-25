/**
 * HTML of the AI exchange view (secondary side bar). Pure (no `vscode`): one inline script allowed
 * by nonce, theme variables only. Everything from the extension is rendered with textContent; the
 * pasted answer is sent to the extension, which validates it, and is never stored by the webview.
 */
export function aiExchangeHtml(cspSource: string, nonce: string): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>DataPass AI exchange</title>
<style>
  :root { color-scheme: light dark; --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35)));
    --ok: var(--vscode-testing-iconPassed, #3fb950); --warn: var(--vscode-editorWarning-foreground, #d29922); --bad: var(--vscode-errorForeground, #f85149);
    --info: var(--vscode-textLink-foreground, #58a6ff); --muted: var(--vscode-descriptionForeground, #8b949e); --card: var(--vscode-editorWidget-background, rgba(128,128,128,.08)); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 10px 12px 16px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); line-height: 1.45; }
  h2 { font-size: 11px; font-weight: 600; letter-spacing: .8px; text-transform: uppercase; color: var(--muted); margin: 14px 0 6px; display: flex; gap: 6px; align-items: center; }
  h2:first-child { margin-top: 2px; }
  .step { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: var(--vscode-badge-background, rgba(128,128,128,.3)); color: var(--vscode-badge-foreground, inherit); font-size: 10px; letter-spacing: 0; }
  label { display: block; font-size: 12px; color: var(--muted); margin: 6px 0 2px; }
  select, textarea { width: 100%; font: inherit; color: var(--vscode-input-foreground, inherit); background: var(--vscode-input-background, transparent); border: 1px solid var(--vscode-input-border, var(--border)); border-radius: 3px; }
  select { padding: 3px 4px; color: var(--vscode-dropdown-foreground, inherit); background: var(--vscode-dropdown-background, transparent); border-color: var(--vscode-dropdown-border, var(--border)); }
  textarea { min-height: 120px; resize: vertical; padding: 6px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre; }
  select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
  button { font: inherit; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 4px 10px; cursor: pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.link { background: transparent; border: none; padding: 1px 2px; color: var(--vscode-textLink-foreground); }
  button.link:hover { text-decoration: underline; }
  button.wide { width: 100%; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .muted { color: var(--muted); }
  .small { font-size: 11.5px; }
  .info { font-size: 12px; margin-top: 3px; }
  .note { font-size: 12px; padding: 6px 9px; border-left: 3px solid var(--info); background: var(--card); margin-top: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .note.ok { border-color: var(--ok); } .note.bad { border-color: var(--bad); } .note.warn { border-color: var(--warn); }
  .note b { font-weight: 600; }
  ul { margin: 4px 0 0; padding-left: 16px; }
  li { margin: 1px 0; }
  .recent li { list-style: none; margin-left: -16px; display: flex; gap: 6px; justify-content: space-between; font-size: 12px; }
  .recent .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foot { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 8px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div id="notready" class="note" hidden>Open a project folder to exchange its DataPass files (project.json, graph.json, options.json, sheet.json) with ChatGPT or Claude.</div>
<main id="main" hidden>
  <h2><span class="step">1</span> Send a file to the AI</h2>
  <label for="file">File</label>
  <select id="file"></select>
  <div id="fileinfo" class="info muted"></div>
  <div id="taskrow">
    <label for="task">Ask the AI to</label>
    <select id="task"></select>
  </div>
  <div class="row"><button id="copy" class="primary wide" title="The file plus instructions. Nothing is sent anywhere: you paste it into ChatGPT or Claude yourself.">Copy the file and instructions</button></div>
  <div id="copied" class="note ok" hidden></div>

  <h2><span class="step">2</span> Paste the AI's answer</h2>
  <textarea id="answer" spellcheck="false" maxlength="2097152" aria-label="The AI's answer" placeholder="Paste the AI's complete answer here (or only its json block). It is checked as you paste; nothing is written yet."></textarea>
  <div class="row">
    <button id="paste" class="secondary" title="Read the clipboard into the box">Paste clipboard</button>
    <button id="fromfile" class="secondary">From a file…</button>
    <button id="clear" class="link">Clear</button>
  </div>
  <div id="review" class="note" hidden></div>

  <h2><span class="step">3</span> Review and write</h2>
  <button id="write" class="primary wide" disabled>Show the diff and write…</button>
  <div class="small muted" style="margin-top:4px">DataPass shows the diff, asks you to confirm and keeps a backup of the previous version. It never commits or pushes: review the change in Source Control.</div>
  <div id="written" class="note ok" hidden></div>

  <div id="recentbox" hidden>
    <h2>Recent</h2>
    <ul id="recent" class="recent"></ul>
  </div>

  <div class="foot row">
    <button id="open" class="link">Open the file</button>
    <button id="restore" class="link">Restore a backup…</button>
    <button id="guide" class="link">File formats</button>
  </div>
  <div class="small muted" style="margin-top:6px">VS Code's Chat is still here: its icon at the top of this side bar.</div>
</main>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  // Only the chosen file and task are remembered; the pasted answer is never stored.
  const saved = vscode.getState() || {};
  const $ = id => document.getElementById(id);
  let state = null;
  let kind = typeof saved.kind === 'string' ? saved.kind : 'options';
  const tasks = saved.tasks && typeof saved.tasks === 'object' ? saved.tasks : {};
  let seq = 0;
  let review = null;
  let timer = null;

  function persist() { vscode.setState({ kind: kind, tasks: tasks }); }
  function post(message) { vscode.postMessage(message); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; }
  function size(bytes) { return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB'; }
  function when(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString();
  }
  function current() { return state && state.files.find(f => f.kind === kind); }

  function renderFiles() {
    const select = $('file');
    select.textContent = '';
    for (const f of state.files) {
      const o = el('option', '', f.path.split('/').pop() + ' — ' + f.label.replace(/ \(.*\)$/, '') + (f.exists ? '' : ' (new)'));
      o.value = f.kind;
      select.appendChild(o);
    }
    if (!state.files.some(f => f.kind === kind)) kind = state.files[0] ? state.files[0].kind : 'options';
    select.value = kind;
    renderFile();
  }

  function renderFile() {
    const f = current();
    if (!f) return;
    const info = $('fileinfo');
    info.textContent = f.path + ' · ' + (f.exists ? size(f.bytes || 0) : 'does not exist yet: the AI creates it from the format');
    info.className = 'info ' + (f.problem ? 'warn' : 'muted');
    if (f.problem) info.textContent += '\nThe current file has errors (the AI can correct them): ' + f.problem;
    info.style.whiteSpace = 'pre-wrap';
    const select = $('task');
    select.textContent = '';
    for (const t of f.tasks) { const o = el('option', '', t.label); o.value = t.id; select.appendChild(o); }
    if (tasks[f.kind] && f.tasks.some(t => t.id === tasks[f.kind])) select.value = tasks[f.kind];
    $('taskrow').hidden = f.tasks.length < 2;
    $('open').textContent = f.exists ? 'Open ' + f.path.split('/').pop() : 'Why is ' + f.path.split('/').pop() + ' missing?';
    renderReview();
  }

  function renderRecent() {
    const list = $('recent');
    list.textContent = '';
    for (const r of state.recent) {
      const li = el('li');
      const label = el('span', 'label', r.label);
      label.title = r.label;
      li.appendChild(label);
      li.appendChild(el('span', 'muted', r.status + ' · ' + when(r.at)));
      list.appendChild(li);
    }
    $('recentbox').hidden = !state.recent.length;
  }

  function renderReview() {
    const box = $('review');
    const write = $('write');
    box.textContent = '';
    if (!review || !$('answer').value.trim()) { box.hidden = true; write.disabled = true; write.textContent = 'Show the diff and write…'; return; }
    box.hidden = false;
    if (!review.ok) {
      box.className = 'note bad';
      box.appendChild(el('b', '', 'Cannot be written. '));
      box.appendChild(document.createTextNode(review.error));
      write.disabled = true;
      write.textContent = 'Show the diff and write…';
      return;
    }
    box.className = 'note ' + (review.warnings.length ? 'warn' : 'ok');
    box.appendChild(el('b', '', '✓ Valid ' + review.label + '. '));
    box.appendChild(document.createTextNode(review.unchanged ? review.path + ' already has exactly this content.' : review.isNew ? 'Creates ' + review.path + '.' : review.path + ': about +' + review.added + ' / −' + review.removed + ' lines.'));
    if (review.kind !== kind) box.appendChild(el('div', 'small', 'This answer is ' + review.path.split('/').pop() + ', not the file selected above: it will be written as ' + review.path + '.'));
    if (review.warnings.length) {
      box.appendChild(el('div', 'small', review.warnings.length + (review.warnings.length > 1 ? ' warnings' : ' warning') + ' (the file is still valid):'));
      const ul = el('ul', 'small');
      for (const w of review.warnings.slice(0, 8)) ul.appendChild(el('li', '', w));
      box.appendChild(ul);
    }
    write.disabled = review.unchanged;
    write.textContent = (review.isNew ? 'Show and create ' : 'Show the diff and write ') + review.path.split('/').pop() + '…';
  }

  function check() {
    clearTimeout(timer);
    $('written').hidden = true;
    const text = $('answer').value;
    if (!text.trim()) { review = null; renderReview(); return; }
    timer = setTimeout(() => { seq += 1; post({ type: 'check', seq: seq, text: text }); }, 250);
  }

  $('file').addEventListener('change', e => { kind = e.target.value; persist(); $('copied').hidden = true; renderFile(); });
  $('task').addEventListener('change', e => { tasks[kind] = e.target.value; persist(); });
  $('copy').addEventListener('click', () => { const f = current(); if (f) post({ type: 'copy', kind: f.kind, task: $('task').value || (f.tasks[0] && f.tasks[0].id) }); });
  $('answer').addEventListener('input', check);
  $('paste').addEventListener('click', () => post({ type: 'paste' }));
  $('fromfile').addEventListener('click', () => post({ type: 'fromFile' }));
  $('clear').addEventListener('click', () => { $('answer').value = ''; review = null; renderReview(); $('answer').focus(); });
  $('write').addEventListener('click', () => { const text = $('answer').value; if (text.trim()) { $('write').disabled = true; post({ type: 'write', text: text }); } });
  $('open').addEventListener('click', () => post({ type: 'open', kind: kind }));
  $('restore').addEventListener('click', () => post({ type: 'command', command: 'datapass.restoreBackup' }));
  $('guide').addEventListener('click', () => post({ type: 'command', command: 'datapass.openPreparationGuide' }));

  window.addEventListener('message', event => {
    const m = event.data || {};
    if (m.type === 'state') {
      state = m.state;
      $('notready').hidden = state.ready;
      $('main').hidden = !state.ready;
      if (state.ready) { renderFiles(); renderRecent(); }
      if ($('answer').value.trim()) check();
    } else if (m.type === 'focus') {
      if (typeof m.kind === 'string' && state && state.files.some(f => f.kind === m.kind)) { kind = m.kind; persist(); $('file').value = kind; renderFile(); }
      $('answer').focus();
    } else if (m.type === 'checked') {
      if (m.seq === seq) { review = m.review; renderReview(); $('write').scrollIntoView({ block: 'nearest' }); }
    } else if (m.type === 'pasted') {
      $('answer').value = typeof m.text === 'string' ? m.text : '';
      check();
    } else if (m.type === 'copied') {
      const box = $('copied');
      box.hidden = false;
      box.className = 'note ' + (m.error ? 'bad' : 'ok');
      box.textContent = m.error ? m.error : 'Copied ' + m.path + ' with instructions. Paste it into ChatGPT or Claude, then paste its complete answer below.';
    } else if (m.type === 'written') {
      if (m.error) { review = { ok: false, error: m.error }; renderReview(); return; }
      if (!m.path) { renderReview(); return; }
      $('answer').value = '';
      review = null;
      renderReview();
      const box = $('written');
      box.hidden = false;
      box.textContent = m.path + ' written' + (m.backup ? ' (backup kept)' : '') + '. Review and commit it in Source Control.';
    }
  });
  post({ type: 'ready' });
</script>
</body>
</html>`;
}
