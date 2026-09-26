/**
 * HTML of the AI view (secondary side bar). Pure (no `vscode`): one inline script allowed by nonce,
 * theme variables only. Everything from the extension is rendered with textContent; the pasted
 * answer is sent to the extension, which validates it, and is never stored by the webview.
 *
 * 0.20 (pass AI-2): Julian's three modes as tabs — DataPass-guided (the JSON exchange, the default
 * tab), Agent (work orders for Claude / Codex: the form, the apps, what the agents did last) and
 * Manual (where things stand, and the route to each official tool). Pilot stays a later option.
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
  .recent .staleline { display: block; color: var(--warn); font-size: 11px; margin-top: -2px; white-space: normal; }
  .foot { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 8px; }
  [hidden] { display: none !important; }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); margin: -2px 0 10px; position: sticky; top: -10px; background: var(--vscode-sideBar-background); z-index: 1; }
  .tab { background: transparent; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 5px 9px; color: var(--muted); }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder, var(--info)); }
  .tab .badge { display: inline-block; min-width: 16px; margin-left: 4px; padding: 0 4px; border-radius: 8px; font-size: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  input[type=text] { width: 100%; font: inherit; color: var(--vscode-input-foreground, inherit); background: var(--vscode-input-background, transparent); border: 1px solid var(--vscode-input-border, var(--border)); border-radius: 3px; padding: 3px 5px; }
  textarea.prose { white-space: pre-wrap; font-family: var(--vscode-font-family); font-size: 13px; min-height: 90px; }
  textarea.short { min-height: 44px; white-space: pre-wrap; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .repo { display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; align-items: center; padding: 3px 0; border-bottom: 1px dashed var(--border); font-size: 12px; }
  .repo select { width: auto; }
  .repo .muted { grid-column: 1 / -1; font-size: 11px; }
  label.check { display: flex; gap: 6px; align-items: center; color: var(--vscode-foreground); }
  details { margin-top: 6px; } summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  .orders { list-style: none; padding: 0; margin: 4px 0 0; }
  .orders li { border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; margin: 6px 0; background: var(--card); font-size: 12px; }
  .orders .head { display: flex; gap: 6px; align-items: baseline; }
  .orders .head b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill { font-size: 10.5px; padding: 0 5px; border-radius: 8px; border: 1px solid var(--border); white-space: nowrap; }
  .pill.ok { color: var(--ok); border-color: var(--ok); } .pill.warn { color: var(--warn); border-color: var(--warn); } .pill.bad { color: var(--bad); border-color: var(--bad); }
  .warnline { color: var(--warn); } .badline { color: var(--bad); }
  .routes { list-style: none; padding: 0; margin: 6px 0 0; }
  .routes li { display: flex; justify-content: space-between; gap: 6px; align-items: center; padding: 4px 0; border-bottom: 1px dashed var(--border); font-size: 12px; }
  .pilot { margin-top: 12px; opacity: .7; }
  .pcard { border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 4px; padding: 6px 8px; margin: 6px 0; background: var(--card); font-size: 12px; }
  .pcard.refused { border-left-color: var(--bad); } .pcard.answered { border-left-color: var(--border); opacity: .8; }
  .pcard .why { font-style: italic; margin-top: 3px; }
</style>
</head>
<body>
<nav class="tabs" role="tablist" aria-label="How you work with AI">
  <button id="t-guided" class="tab active" role="tab" aria-selected="true" title="DataPass takes you step by step: copy a DataPass file for ChatGPT or Claude, paste the answer, review, write">DataPass-guided</button>
  <button id="t-agent" class="tab" role="tab" aria-selected="false" title="Work orders for Claude Code or Codex, in your repositories">Agent<span id="agentbadge" class="badge" hidden></span></button>
  <button id="t-manual" class="tab" role="tab" aria-selected="false" title="You work with the official tools; DataPass shows where things stand">Manual</button>
  <button id="t-pilot" class="tab" role="tab" aria-selected="false" title="Pilot, stage 1: an agent reads your dev cloud read-only and asks DataPass for actions you click">Pilot<span id="pilotbadge" class="badge" hidden></span></button>
</nav>
<div id="notready" class="note" hidden>Open a project folder to exchange its DataPass files (project.json, graph.json, options.json, sheet.json) with ChatGPT or Claude.</div>
<main id="main" hidden>
<section id="tab-guided" role="tabpanel" aria-labelledby="t-guided">
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
</section>

<section id="tab-agent" role="tabpanel" aria-labelledby="t-agent" hidden>
  <div id="agentoff" class="note warn" hidden><span id="agentofftext"></span><div class="row"><button id="agentfix" class="secondary" hidden></button></div></div>
  <div id="ptype" class="small muted"></div>
  <div class="row">
    <button id="openclaude" class="secondary" title="Open the Claude desktop app">Claude app</button>
    <button id="opencodex" class="secondary" title="Open the ChatGPT desktop app (Codex)">Codex app</button>
    <button id="exportjson" class="link" title="Names and states of the project, a sub-project or the company, as JSON">Export JSON…</button>
  </div>

  <h2>New work order</h2>
  <div id="prefillnote" class="note" hidden></div>
  <label for="goal">What do you want?</label>
  <textarea id="goal" class="prose" maxlength="8000" spellcheck="true" placeholder="For example: pages over 230 s time out; split long PDFs into batches and retry a failed batch once."></textarea>
  <label for="wotitle">Title <span class="muted">(optional: else the first line)</span></label>
  <input id="wotitle" type="text" maxlength="80" />
  <label for="kind">Kind</label>
  <select id="kind"></select>
  <div class="grid2">
    <div><label for="sub">Sub-project</label><select id="sub"></select></div>
    <div><label for="comp">Component</label><select id="comp"></select></div>
  </div>
  <div id="cardrow"><label for="card">Board card</label><select id="card"></select></div>
  <div id="decrow"><label for="dec">Decision</label><select id="dec"></select></div>
  <div class="grid2">
    <div><label for="choice">Agent</label><select id="choice"></select></div>
    <div><label for="effort">Effort</label><select id="effort"></select></div>
  </div>
  <div id="codexnote" class="small muted" hidden></div>
  <label>Repositories <span class="muted">(change: its own branch and PR · read: context only)</span></label>
  <div id="repos"></div>
  <label for="merge">Merge</label>
  <select id="merge"><option value="person">I merge</option><option value="agent-when-green">The agent merges when CI is green</option></select>
  <label class="check"><input type="checkbox" id="attachexport" /> <span>Attach an export JSON of the <span id="expscope">project</span></span></label>
  <div id="filesrow">
    <label>DataPass files the agent returns</label>
    <div class="row" id="dpfiles"></div>
    <select id="dpvia" aria-label="How the files come back"><option value="pull-request">in its pull request (coordination repository)</option><option value="import">as files for you to import (no pull request)</option></select>
  </div>
  <details id="more"><summary>More options</summary>
    <label for="donewhen">Done when <span class="muted">(one per line)</span></label>
    <textarea id="donewhen" class="short" maxlength="4000"></textarea>
    <label for="checks">Checks the agent runs itself <span class="muted">(one per line; DataPass never runs them)</span></label>
    <textarea id="checks" class="short" maxlength="4000"></textarea>
    <label for="perm">Permissions</label>
    <select id="perm"><option value="usual">Your usual Claude / Codex settings</option><option value="ask">Ask before each action (Claude --permission-mode default)</option></select>
    <label for="model">Model <span class="muted">(empty: the tool's default)</span></label>
    <input id="model" type="text" maxlength="60" />
  </details>
  <div class="row">
    <button id="wopreview" class="secondary" title="order.md as the agent will read it; nothing is written">Preview</button>
    <button id="wowrite" class="secondary" title="Writes the order on this computer (.datapass/local/work-orders); nothing is launched">Write the order</button>
    <button id="wolaunch" class="primary" title="Writes the order, then asks you to confirm the launch">Write and launch ▸</button>
  </div>
  <div id="wostatus" class="note" hidden></div>

  <h2>What the agents did last on this project</h2>
  <div id="woempty" class="small muted">No work order yet.</div>
  <ul id="worecent" class="orders"></ul>
  <div class="row"><button id="woall" class="link">All work orders ↗</button><button id="wopublish" class="link" title="Writes .datapass/work-log.json (and your private log repository when set); you commit them">Publish summary</button></div>
  <div class="small muted pilot">Pilot mode (the agent reads your dev cloud read-only, you click each action): the Pilot tab.</div>
</section>

<section id="tab-pilot" role="tabpanel" aria-labelledby="t-pilot" hidden>
  <div id="pilotoff" class="note warn" hidden><span id="pilotofftext"></span><div class="row"><button id="pilotfix" class="secondary" hidden></button></div></div>
  <p class="small">Stage 1, read-only, <b>dev</b> only. The agent works in the order's own folder, where DataPass writes its guard rails; it may run read-only <code>az</code> and <code>func</code> commands with your sign-in (a Reader role is the real safety net) and asks before anything else. It changes no repository.</p>
  <h2>Requests from the agent</h2>
  <div id="pcempty" class="small muted">No request yet. The agent writes requests/&lt;n&gt;.json in its order's folder; each one shows here.</div>
  <div id="pcards"></div>
  <h2>New pilot order</h2>
  <label for="pgoal">What should the agent look at?</label>
  <textarea id="pgoal" class="prose" maxlength="8000" spellcheck="true" placeholder="For example: check the dev Function App of the PDF flow: which functions exist, and did the last runs fail?"></textarea>
  <div class="grid2">
    <div><label for="pcomp">Component</label><select id="pcomp"></select></div>
    <div><label for="peffort">Effort</label><select id="peffort"></select></div>
  </div>
  <label for="pchoice">Agent</label>
  <select id="pchoice"></select>
  <div class="small muted">Permissions: asks before each action (always, for a pilot order).</div>
  <div class="row">
    <button id="pwrite" class="secondary" title="Writes the order and its guard rails on this computer; nothing is launched">Write the order</button>
    <button id="plaunch" class="primary" title="Writes the order, then asks you to confirm the launch">Write and launch ▸</button>
  </div>
  <div id="pstatus" class="note" hidden></div>
  <h2>Pilot orders</h2>
  <div id="poempty" class="small muted">No pilot order yet.</div>
  <ul id="porders" class="orders"></ul>
</section>

<section id="tab-manual" role="tabpanel" aria-labelledby="t-manual" hidden>
  <p class="small">You work with the official tools (the Fabric, Databricks and Azure extensions, their CLIs, the portals). DataPass shows where things stand and opens the right place; it runs nothing for you.</p>
  <ul class="routes" id="routes"></ul>
</section>
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

  let tab = saved.tab === 'agent' || saved.tab === 'manual' || saved.tab === 'pilot' ? saved.tab : 'guided';
  // 0.22 modes: tabs the mode hides; a tab a command opened explicitly stays until the person leaves it.
  let hiddenTabs = [];
  let forced = null;
  function applyTabs() {
    for (const x of ['agent', 'manual', 'pilot']) $('t-' + x).hidden = hiddenTabs.includes(x) && forced !== x;
    document.querySelector('nav.tabs').hidden = ['agent', 'manual', 'pilot'].every(x => $('t-' + x).hidden);
    if ($('t-' + tab).hidden) showTab('guided');
  }
  let prefillToken = null;
  const touched = new Set();
  function persist() { vscode.setState({ kind: kind, tasks: tasks, tab: tab }); }
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
      if (r.stale) { const s = el('li', 'staleline', '⚠ Stale: ' + r.stale + '. Copy a fresh pack.'); s.title = r.stale; list.appendChild(s); }
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

  // ------------------------------------------------------------------ tabs
  function showTab(t) {
    if (forced && forced !== t) { forced = null; setTimeout(applyTabs, 0); }
    tab = t; persist();
    for (const x of ['guided', 'agent', 'manual', 'pilot']) {
      $('tab-' + x).hidden = x !== t;
      $('t-' + x).classList.toggle('active', x === t);
      $('t-' + x).setAttribute('aria-selected', String(x === t));
    }
  }
  $('t-guided').addEventListener('click', () => showTab('guided'));
  $('t-agent').addEventListener('click', () => showTab('agent'));
  $('t-manual').addEventListener('click', () => showTab('manual'));
  $('t-pilot').addEventListener('click', () => showTab('pilot'));

  // ------------------------------------------------------------------ Pilot tab (0.26, AI-4a)
  function pStatus(text, tone) { const b = $('pstatus'); b.hidden = !text; b.className = 'note ' + (tone || ''); b.textContent = text || ''; }
  function renderPilot() {
    const p = state && state.pilot; if (!p) return;
    $('pilotoff').hidden = p.allowed;
    $('pilotofftext').textContent = p.why || '';
    const fixes = { 'pilot-setting': 'Switch pilot mode on…', 'machine-setting': 'Open the setting', trust: 'Manage Workspace Trust', 'project-module': 'Open project.json' };
    $('pilotfix').hidden = !p.fix || !fixes[p.fix];
    $('pilotfix').textContent = fixes[p.fix] || '';
    for (const b of ['pwrite', 'plaunch']) $(b).disabled = !p.allowed;
    if (!$('pchoice').options.length) {
      for (const c of p.choices) { const o = opt($('pchoice'), c.id, c.label + (c.disabled ? ' (' + c.disabled + ')' : '')); o.disabled = !!c.disabled; }
      $('pchoice').value = p.defaults.choice;
      fillSelect('peffort', p.efforts.map(e => ({ id: e, label: e })), p.defaults.effort);
    }
    fillSelect('pcomp', p.components, undefined, 'None');
    const badge = $('pilotbadge'); badge.hidden = !p.pending; badge.textContent = String(p.pending);
    const box = $('pcards'); box.textContent = '';
    $('pcempty').hidden = p.cards.length > 0;
    for (const c of p.cards) {
      const d = el('div', 'pcard ' + c.state);
      const head = el('div', 'head');
      head.appendChild(el('span', 'pill ' + (c.state === 'pending' ? 'warn' : c.state === 'refused' ? 'bad' : c.outcome === 'done' ? 'ok' : ''), c.state === 'answered' ? c.outcome : c.state));
      head.appendChild(el('b', '', 'PILOT · ' + c.short + ' asks (' + (c.n || '?') + ')'));
      d.appendChild(head);
      if (c.capability) d.appendChild(el('div', '', c.capability + ' · component ' + c.component + ' · ' + c.environment));
      if (c.effects) d.appendChild(el('div', 'muted', c.effects + ' · ' + c.runsIn));
      if (c.why) d.appendChild(el('div', 'why', '"' + c.why + '" (the agent says)'));
      if (c.message) d.appendChild(el('div', c.state === 'refused' ? 'badline' : 'muted', c.message));
      if (c.state !== 'answered' && c.n >= 1 && c.n <= 50) {
        const row = el('div', 'row');
        if (c.state === 'pending') {
          const run = el('button', 'primary', 'Run it'); run.addEventListener('click', () => { run.disabled = true; post({ type: 'pilot.run', orderId: c.orderId, n: c.n }); });
          row.appendChild(run);
        }
        const no = el('button', 'secondary', c.state === 'pending' ? 'Not now' : 'Tell the agent');
        no.addEventListener('click', () => { no.disabled = true; post({ type: 'pilot.decline', orderId: c.orderId, n: c.n }); });
        row.appendChild(no);
        d.appendChild(row);
      }
      if (c.state !== 'answered') d.appendChild(el('div', 'small muted', 'The agent reads the answer in responses/' + c.n + '.json.'));
      box.appendChild(d);
    }
    const list = $('porders'); list.textContent = '';
    $('poempty').hidden = p.orders.length > 0;
    for (const o of p.orders) {
      const li = el('li');
      const head = el('div', 'head');
      head.appendChild(el('span', 'pill', o.status));
      const t = el('b', '', o.short + ' ' + o.title); t.title = o.id; head.appendChild(t);
      li.appendChild(head);
      if (o.agent) li.appendChild(el('div', 'muted', o.agent));
      if (o.next) li.appendChild(el('div', 'muted', o.next));
      const row = el('div', 'row');
      if (o.canLaunch && o.status === 'written') { const b = el('button', 'secondary', 'Launch…'); b.addEventListener('click', () => post({ type: 'wo.cmd', command: 'datapass.workOrders.launch', args: [o.id] })); row.appendChild(b); }
      const f = el('button', 'link', 'Folder'); f.addEventListener('click', () => post({ type: 'wo.cmd', command: 'datapass.workOrders.openFolder', args: [o.id] })); row.appendChild(f);
      li.appendChild(row);
      list.appendChild(li);
    }
  }
  function pilotDraft() {
    return { goal: $('pgoal').value, components: $('pcomp').value ? [$('pcomp').value] : [], choice: $('pchoice').value, effort: $('peffort').value };
  }
  $('pwrite').addEventListener('click', () => { pStatus('Writing…'); post({ type: 'pilot.write', draft: pilotDraft(), launch: false }); });
  $('plaunch').addEventListener('click', () => { pStatus('Writing…'); post({ type: 'pilot.write', draft: pilotDraft(), launch: true }); });
  $('pilotfix').addEventListener('click', () => {
    const f = state && state.pilot && state.pilot.fix;
    const cmd = f === 'pilot-setting' ? 'datapass.pilot.enable' : f === 'machine-setting' ? 'datapass.workOrders.enable' : f === 'trust' ? 'workbench.trust.manage' : f === 'project-module' ? 'datapass.openProjectManifest' : '';
    if (cmd) post({ type: 'wo.cmd', command: cmd, args: [] });
  });

  // ------------------------------------------------------------------ Agent tab
  function opt(select, value, label) { const o = el('option', '', label); o.value = value; select.appendChild(o); return o; }
  function fillSelect(id, items, value, none) {
    const s = $(id); const keep = value !== undefined ? value : s.value;
    s.textContent = '';
    if (none !== undefined) opt(s, '', none);
    for (const it of items) opt(s, it.id, it.label);
    if (keep !== undefined && [...s.options].some(o => o.value === keep)) s.value = keep;
  }
  function agentState() { return state && state.agent; }
  // The same defaults as the extension (defaultAccess): coordination changes (reads for a report), the components' repositories change.
  function importOnly() { return $('kind').value === 'datapass-files' && $('dpvia').value === 'import' && dpKinds().length > 0; }
  function dpKinds() { return [...$('dpfiles').querySelectorAll('input:checked')].map(i => i.value); }
  function repoDefault(r) {
    const a = agentState(); const k = $('kind').value;
    if (r.coordination) return k === 'investigate' || importOnly() ? 'read' : 'change';
    const comps = $('comp').value ? $('comp').value.split(',') : [];
    const used = new Set(a.components.filter(c => comps.includes(c.id)).map(c => c.repoKey));
    if (used.has(r.key)) return k === 'investigate' || k === 'datapass-files' ? 'read' : 'change';
    return 'skip';
  }
  function renderRepos() {
    const a = agentState(); const box = $('repos');
    const current = {};
    for (const s of box.querySelectorAll('select')) current[s.dataset.key] = s.value;
    box.textContent = '';
    for (const r of a.repos) {
      const row = el('div', 'repo');
      row.appendChild(el('span', '', r.label + (r.coordination ? ' (coordination)' : '')));
      const s = el('select'); s.dataset.key = r.key; s.setAttribute('aria-label', 'Access for ' + r.label);
      opt(s, 'change', 'change'); opt(s, 'read', 'read'); opt(s, 'skip', '—');
      if (!r.usable) { s.value = 'skip'; s.disabled = true; }
      else s.value = touched.has(r.key) && current[r.key] ? current[r.key] : repoDefault(r);
      s.addEventListener('change', () => touched.add(r.key));
      row.appendChild(s);
      row.appendChild(el('span', 'muted', r.note));
      box.appendChild(row);
    }
  }
  function renderKindRows() {
    const k = $('kind').value;
    $('filesrow').hidden = k === 'investigate';
    if (!$('dpfiles').children.length) {
      for (const f of ['project', 'graph', 'options', 'sheet', 'board']) {
        const l = el('label', 'check small'); const i = el('input'); i.type = 'checkbox'; i.value = f;
        i.addEventListener('change', () => renderRepos());
        l.appendChild(i); l.appendChild(document.createTextNode(f + '.json')); $('dpfiles').appendChild(l);
      }
    }
    $('cardrow').hidden = !(k === 'fix-card' || $('card').value);
    $('decrow').hidden = !(k === 'apply-decision' || $('dec').value);
  }
  function renderAgent() {
    const a = agentState(); if (!a) return;
    $('agentoff').hidden = a.verdict.allowed;
    $('agentofftext').textContent = a.verdict.why;
    const fix = $('agentfix');
    const fixes = { 'machine-setting': 'Open the setting', trust: 'Manage Workspace Trust', 'project-module': 'Open project.json' };
    fix.hidden = !a.verdict.fix || !fixes[a.verdict.fix];
    fix.textContent = fixes[a.verdict.fix] || '';
    $('ptype').textContent = a.projectType.type + ' project (' + a.projectType.source + '): ' + a.projectType.explain + '.';
    for (const b of ['wowrite', 'wolaunch']) $(b).disabled = !a.verdict.allowed;
    if (!$('kind').options.length) {
      fillSelect('kind', a.kinds);
      fillSelect('effort', a.efforts.map(e => ({ id: e, label: e })), a.defaults.effort);
      fillSelect('choice', a.choices, a.defaults.choice);
      $('merge').value = a.defaults.merge;
      if (a.defaults.model) $('model').value = a.defaults.model;
    }
    codexNote();
    const first = !$('sub').options.length;
    fillSelect('sub', a.subprojects.map(x => ({ id: x.id, label: x.title })), first ? (a.selection.subproject || '') : undefined, 'Whole project');
    if (first && a.selection.component) $('comp').dataset.initial = a.selection.component;
    const compItems = a.components.filter(c => !$('sub').value || c.subproject === $('sub').value).map(c => ({ id: c.id, label: c.label }));
    const multi = $('comp').value && $('comp').value.includes(',') ? [{ id: $('comp').value, label: $('comp').value.split(',').join(' + ') }] : [];
    fillSelect('comp', multi.concat(compItems), $('comp').dataset.initial, 'None');
    delete $('comp').dataset.initial;
    fillSelect('card', a.cards.map(c => ({ id: c.id, label: c.id + ' · ' + c.title })), undefined, 'None');
    fillSelect('dec', a.decisions.map(d => ({ id: d.id, label: d.title })), undefined, 'None');
    $('expscope').textContent = a.defaults.exportScope === 'subproject' ? 'sub-project' : a.defaults.exportScope;
    renderKindRows();
    renderRepos();
    const badge = $('agentbadge');
    badge.hidden = !a.counts.needs;
    badge.textContent = String(a.counts.needs);
    const list = $('worecent'); list.textContent = '';
    $('woempty').hidden = a.recent.length > 0;
    const tone = { written: '', launched: 'warn', reported: 'ok', done: 'ok', abandoned: '', error: 'bad' };
    for (const o of a.recent) {
      const li = el('li');
      const head = el('div', 'head');
      head.appendChild(el('span', 'pill ' + (tone[o.status] || ''), o.status));
      const title = el('b', '', o.short + ' ' + o.title); title.title = o.id + ' — ' + o.title; head.appendChild(title);
      li.appendChild(head);
      if (o.agent) li.appendChild(el('div', 'muted', o.agent + (o.createdAt ? ' · ' + when(o.createdAt) : '')));
      if (o.stamp) li.appendChild(el('div', o.otherVariant ? 'warnline' : 'muted', o.stamp + (o.otherVariant ? ' — not the selected variant: launching asks first' : '')));
      for (const line of o.outputs) li.appendChild(el('div', '', line));
      if (o.result) li.appendChild(el('div', o.result.startsWith('refused') ? 'badline' : '', 'Result: ' + o.result));
      for (const n of o.needs) li.appendChild(el('div', 'warnline', '⚑ ' + n));
      li.appendChild(el('div', 'muted', o.next));
      const row = el('div', 'row');
      const act = (label, command) => { const b = el('button', 'link', label); b.addEventListener('click', () => post({ type: 'wo.cmd', command: command, args: [o.id] })); row.appendChild(b); };
      act('Open', 'datapass.workOrders.show');
      if (o.status === 'written') act('Launch ▸', 'datapass.workOrders.launch');
      if (o.canResume) act('Resume', 'datapass.workOrders.resume');
      if (o.suggestDone) act('Mark done', 'datapass.workOrders.markDone');
      if (o.status === 'reported' || o.status === 'done') act('Follow-up', 'datapass.workOrders.followUp');
      li.appendChild(row);
      list.appendChild(li);
    }
  }
  function lines(id) { return $(id).value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); }
  function draft() {
    const repos = {};
    for (const s of $('repos').querySelectorAll('select')) if (!s.disabled) repos[s.dataset.key] = s.value;
    return {
      kind: $('kind').value, title: $('wotitle').value, goal: $('goal').value,
      subproject: $('sub').value || undefined, components: $('comp').value ? $('comp').value.split(',') : [],
      boardCard: $('card').value || undefined, decision: $('dec').value || undefined, repos: repos,
      choice: $('choice').value, effort: $('effort').value, merge: $('merge').value, permissions: $('perm').value,
      model: $('model').value.trim() || undefined, attachExport: $('attachexport').checked,
      expectedFiles: $('kind').value === 'investigate' ? undefined : (dpKinds().length ? dpKinds().map(k => ({ kind: k, via: $('dpvia').value })) : undefined),
      doneWhen: lines('donewhen'), checks: lines('checks')
    };
  }
  function woStatus(text, cls) { const b = $('wostatus'); b.hidden = !text; b.className = 'note ' + (cls || ''); b.textContent = text || ''; }
  $('kind').addEventListener('change', () => { renderKindRows(); renderRepos(); });
  $('dpvia').addEventListener('change', () => renderRepos());
  $('sub').addEventListener('change', () => { renderAgent(); });
  $('comp').addEventListener('change', () => { renderRepos(); });
  $('card').addEventListener('change', renderKindRows);
  $('dec').addEventListener('change', renderKindRows);
  $('wopreview').addEventListener('click', () => post({ type: 'wo.preview', draft: draft(), token: prefillToken }));
  $('wowrite').addEventListener('click', () => { woStatus('Writing the order…'); post({ type: 'wo.write', draft: draft(), launch: false, token: prefillToken }); });
  $('wolaunch').addEventListener('click', () => { woStatus('Writing the order…'); post({ type: 'wo.write', draft: draft(), launch: true, token: prefillToken }); });
  $('woall').addEventListener('click', () => post({ type: 'wo.cmd', command: 'datapass.workOrders.show', args: [] }));
  $('wopublish').addEventListener('click', () => post({ type: 'wo.cmd', command: 'datapass.workOrders.publishSummary', args: [] }));
  $('openclaude').addEventListener('click', () => post({ type: 'wo.cmd', command: 'datapass.workOrders.openApp', args: ['claude'] }));
  // 0.24 (AI-3): which Codex route applies on this computer.
  function codexNote() {
    const a = state && state.agent;
    const c = $('choice').value;
    const n = $('codexnote');
    if (!a || !a.codex || (c !== 'codex-terminal' && c !== 'codex-desktop')) { n.hidden = true; return; }
    n.hidden = false;
    n.textContent = c === 'codex-terminal'
      ? (a.codex.cli ? 'Codex CLI found: it starts in a terminal with the workspace-write sandbox and asks before network actions (git push, gh).' : 'No Codex CLI here (datapass.ai.codex.path or PATH): the launch copies the command for your own terminal. The Codex app works without it.')
      : (a.codex.cli ? 'DataPass copies the prompt and opens the folder in the ChatGPT app (codex app).' : 'DataPass copies the prompt and opens the ChatGPT app; choose the folder there.');
  }
  $('choice').addEventListener('change', codexNote);
  $('opencodex').addEventListener('click', () => post({ type: 'wo.cmd', command: 'datapass.workOrders.openApp', args: ['codex'] }));
  $('exportjson').addEventListener('click', () => post({ type: 'wo.cmd', command: 'datapass.workOrders.exportProject', args: [] }));
  $('agentfix').addEventListener('click', () => {
    const f = agentState() && agentState().verdict.fix;
    post({ type: 'wo.cmd', command: f === 'trust' ? 'workbench.trust.manage' : f === 'project-module' ? 'datapass.openProjectManifest' : 'datapass.workOrders.enable', args: [] });
  });
  function applyPrefill(m) {
    const d = m.draft || {};
    forced = 'agent';
    showTab('agent');
    applyTabs();
    touched.clear();
    prefillToken = typeof m.token === 'string' ? m.token : null;
    renderAgent();
    if (d.kind) $('kind').value = d.kind;
    $('wotitle').value = d.title || '';
    $('goal').value = d.goal || '';
    $('sub').value = d.subproject || '';
    renderAgent();
    const comps = Array.isArray(d.components) ? d.components : [];
    if (comps.length > 1) opt($('comp'), comps.join(','), comps.join(' + '));
    $('comp').value = comps.join(',');
    $('card').value = d.boardCard || '';
    $('dec').value = d.decision || '';
    if (d.choice) { $('choice').value = d.choice; codexNote(); }
    if (d.effort) $('effort').value = d.effort;
    if (d.merge) $('merge').value = d.merge;
    $('donewhen').value = (d.doneWhen || []).join('\n');
    $('checks').value = (d.checks || []).join('\n');
    const ef = Array.isArray(d.expectedFiles) ? d.expectedFiles : [];
    renderKindRows();
    for (const i of $('dpfiles').querySelectorAll('input')) i.checked = ef.some(f => f.kind === i.value);
    if (ef[0]) $('dpvia').value = ef[0].via;
    renderKindRows();
    if (d.repos) {
      for (const k of Object.keys(d.repos)) touched.add(k);
      renderRepos();
      for (const s of $('repos').querySelectorAll('select')) if (!s.disabled && d.repos[s.dataset.key]) s.value = d.repos[s.dataset.key];
    } else renderRepos();
    const note = $('prefillnote'); note.hidden = !m.note; note.textContent = m.note || '';
    woStatus('');
    $('goal').focus();
  }

  // ------------------------------------------------------------------ Manual tab
  function renderManual() {
    const m = state && state.manual; if (!m) return;
    const list = $('routes'); list.textContent = '';
    const route = (label, info, command) => {
      const li = el('li'); const b = el('button', 'link', label); b.addEventListener('click', () => post({ type: 'wo.cmd', command: command, args: [] }));
      li.appendChild(b); li.appendChild(el('span', 'muted', info)); list.appendChild(li);
    };
    route('Project view', m.filesMissing ? m.filesMissing + ' expected file(s) missing' : 'files, repositories, readiness', 'datapass.project.focus');
    route('Git view', m.gitNeeds ? m.gitNeeds + ' item(s) need you' : 'branches, worktrees, PRs', 'datapass.git.focus');
    route('Readiness report', 'tools, sign-ins, env files', 'datapass.readinessReport');
    route('Workbench', 'architecture, options, sheet, board, work orders', 'datapass.openWorkbench');
    route('Open the official tool', 'of the selected component', 'datapass.openNativeTool');
    route('Check for updates', m.behind ? m.behind + ' commit(s) to get' : 'git fetch, nothing merged', 'datapass.checkForUpdates');
    route('How a project is prepared', 'the guide', 'datapass.openPreparationGuide');
    if (m.problems) route('Problems in project files', m.problems + ' error(s)', 'workbench.actions.view.problems');
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
      hiddenTabs = Array.isArray(state.hiddenTabs) ? state.hiddenTabs : [];
      applyTabs();
      $('notready').hidden = state.ready;
      $('main').hidden = !state.ready;
      if (state.ready) { renderFiles(); renderRecent(); renderAgent(); renderManual(); renderPilot(); }
      if ($('answer').value.trim()) check();
    } else if (m.type === 'prefill') {
      if (state && state.ready) applyPrefill(m);
    } else if (m.type === 'tab') {
      if (m.tab === 'agent' || m.tab === 'manual' || m.tab === 'pilot' || m.tab === 'guided') { if (m.tab !== 'guided') forced = m.tab; showTab(m.tab); applyTabs(); }
    } else if (m.type === 'wo.done') {
      if (m.error) woStatus(m.error, 'bad');
      else if (m.id) {
        woStatus('Work order ' + m.id + ' written' + (m.launched ? ' and handed over.' : '. Launch it from the list below when you are ready.'), 'ok');
        $('goal').value = ''; $('wotitle').value = ''; prefillToken = null; $('prefillnote').hidden = true;
      } else woStatus('');
    } else if (m.type === 'pilot.done') {
      if (m.error) pStatus(m.error, 'bad');
      else if (m.id) { pStatus('Pilot order ' + m.id + ' written' + (m.launched ? ' and handed over.' : '. Launch it from the list below when you are ready.'), 'ok'); $('pgoal').value = ''; }
      else pStatus('');
    } else if (m.type === 'focus') {
      showTab('guided');
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
  showTab(tab);
  post({ type: 'ready' });
</script>
</body>
</html>`;
}
