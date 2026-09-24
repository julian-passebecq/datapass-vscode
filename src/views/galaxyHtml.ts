/**
 * Galaxy webview document. Pure (no `vscode` import) so tests can parse the embedded script.
 * The template is `String.raw`: the webview JavaScript below is sent exactly as written, so a
 * backslash in it stays a backslash. (A plain template literal turned the source `'\\'` into
 * `'\'`, a syntax error that left the Galaxy blank in v0.8.0–v0.9.1.)
 */
export function galaxyHtml(cspSource: string, nonce: string): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>DataPass Galaxy</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 12px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: 12px;
  }
  h1, h2, h3, p { margin: 0; }
  button { font-family: inherit; }
  .page { display: grid; gap: 12px; min-width: 0; }
  .hero { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .hero h1 { font-size: 18px; line-height: 1.2; }
  .sub { color: var(--vscode-descriptionForeground); margin-top: 3px; line-height: 1.35; }
  .timestamp { color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; padding-top: 3px; }

  .health {
    border: 1px solid var(--vscode-widget-border);
    background: var(--vscode-editor-background);
    border-radius: 7px;
    padding: 9px;
  }
  .health-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .health-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
  .overall { border-radius: 999px; padding: 2px 7px; font-size: 10px; font-weight: 600; text-transform: uppercase; border: 1px solid var(--vscode-widget-border); }
  .overall.healthy { color: var(--vscode-testing-iconPassed); }
  .overall.attention { color: var(--vscode-editorWarning-foreground); }
  .overall.setup { color: var(--vscode-descriptionForeground); }
  .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .metric { min-width: 0; padding: 7px; border-radius: 5px; background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-widget-border); }
  .metric-value { font-size: 15px; font-weight: 650; line-height: 1.1; }
  .metric-label { color: var(--vscode-descriptionForeground); font-size: 9px; margin-top: 2px; text-transform: uppercase; letter-spacing: .03em; }

  .attention { border: 1px solid var(--vscode-widget-border); border-radius: 7px; overflow: hidden; background: var(--vscode-editor-background); }
  .attention-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 9px; border-bottom: 1px solid var(--vscode-widget-border); }
  .attention-head strong { font-size: 11px; }
  .attention-list { display: grid; }
  .attention-item { display: grid; grid-template-columns: 4px minmax(0, 1fr) auto; gap: 8px; padding: 8px 9px; align-items: center; border-bottom: 1px solid var(--vscode-widget-border); }
  .attention-item:last-child { border-bottom: 0; }
  .attention-marker { align-self: stretch; border-radius: 99px; background: var(--vscode-descriptionForeground); }
  .attention-marker.error { background: var(--vscode-errorForeground); }
  .attention-marker.warning { background: var(--vscode-editorWarning-foreground); }
  .attention-copy { min-width: 0; }
  .attention-label { font-size: 11px; font-weight: 600; }
  .attention-detail { color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.35; margin-top: 2px; }

  .filters { display: flex; flex-wrap: wrap; gap: 5px; }
  .filter {
    border: 1px solid var(--vscode-widget-border);
    background: transparent;
    color: var(--vscode-foreground);
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 10px;
    cursor: pointer;
  }
  .filter.active { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-color: transparent; }

  .section { display: grid; gap: 7px; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .section-title { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
  .section-meta { color: var(--vscode-descriptionForeground); font-size: 10px; }
  .cards { display: grid; gap: 7px; }

  .card {
    border: 1px solid var(--vscode-widget-border);
    background: var(--vscode-editor-background);
    border-radius: 7px;
    overflow: hidden;
    min-width: 0;
  }
  .card > summary {
    cursor: pointer;
    list-style: none;
    padding: 9px;
  }
  .card > summary::-webkit-details-marker { display: none; }
  .card-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  .card-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .card-title { font-weight: 650; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chevron { color: var(--vscode-descriptionForeground); transition: transform .12s ease; font-size: 9px; }
  details[open] > summary .chevron { transform: rotate(90deg); }
  .badge { font-size: 9px; text-transform: uppercase; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 2px 6px; white-space: nowrap; }
  .ready, .yes { color: var(--vscode-testing-iconPassed); }
  .partial, .unbound { color: var(--vscode-editorWarning-foreground); }
  .missing, .error { color: var(--vscode-errorForeground); }
  .summary-line { color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.35; margin-top: 4px; }
  .card-body { border-top: 1px solid var(--vscode-widget-border); padding: 9px; display: grid; gap: 8px; }
  .detail { color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.35; }

  .project-card { padding: 9px; }
  .project-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .binding-grid { display:grid; gap:4px; margin-top:8px; }
  .binding { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; }
  .binding-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .binding-value { color:var(--vscode-descriptionForeground); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:52%; text-align:right; }

  .tools {
    border-top: 1px solid var(--vscode-widget-border);
    border-bottom: 1px solid var(--vscode-widget-border);
    padding: 6px 0;
  }
  .tools > summary, .catalog > summary { cursor:pointer; font-weight:600; font-size:10px; color:var(--vscode-descriptionForeground); }
  .tool-list { display:grid; gap:3px; margin-top:6px; }
  .tool { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; font-size:10px; }
  .tool-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tool-state { color:var(--vscode-descriptionForeground); white-space:nowrap; }

  .op-list { display:grid; gap:2px; margin-top:6px; }
  .op { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; font-size:10px; width:100%;
    background:none; border:0; padding:2px 0; color:inherit; text-align:left; cursor:pointer; }
  .op:hover .op-name, .op:focus-visible .op-name { text-decoration: underline; }
  .op-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .op-status { white-space:nowrap; color:var(--vscode-descriptionForeground); }
  .op-status.s-ready { color: var(--vscode-testing-iconPassed); }
  .op-status.s-blocked, .op-status.s-unsupported { color: var(--vscode-errorForeground); }
  .op-status.s-needs-config, .op-status.s-needs-review { color: var(--vscode-editorWarning-foreground); }

  .actions { display:flex; flex-wrap:wrap; gap:5px; }
  .action {
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-radius: 4px;
    padding: 4px 7px;
    font-size: 10px;
    cursor: pointer;
  }
  .action:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .action.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .action:disabled { opacity: .42; cursor: not-allowed; }

  .catalog { border-top: 1px solid var(--vscode-widget-border); padding-top: 7px; }
  .catalog-groups { display:grid; gap:8px; margin-top:8px; }
  .catalog-category { color: var(--vscode-descriptionForeground); font-size:9px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  .catalog-item { border-left:2px solid var(--vscode-widget-border); padding:5px 0 5px 7px; margin-bottom:4px; }
  .catalog-name { font-size:10px; font-weight:600; }
  .catalog-meta { color:var(--vscode-descriptionForeground); font-size:9px; margin-top:2px; }

  .empty { color:var(--vscode-descriptionForeground); font-size:10px; border:1px dashed var(--vscode-widget-border); border-radius:6px; padding:9px; text-align:center; }
  .hidden { display:none !important; }

  @media (min-width: 430px) {
    .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
</style>
</head>
<body>
<div class="page">
  <header class="hero">
    <div>
      <h1>DataPass Galaxy</h1>
      <div class="sub">Project-aware control plane for real platform tools.</div>
    </div>
    <div id="timestamp" class="timestamp"></div>
  </header>
  <div id="health"></div>
  <div id="attention"></div>
  <div id="filters" class="filters"></div>
  <div id="project"></div>
  <div id="platforms"></div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const persisted = vscode.getState() || {};
  let currentState = null;
  let activeFilter = persisted.filter || 'all';
  const openPlatforms = new Set(Array.isArray(persisted.openPlatforms) ? persisted.openPlatforms : []);

  const timestamp = document.getElementById('timestamp');
  const healthRoot = document.getElementById('health');
  const attentionRoot = document.getElementById('attention');
  const filtersRoot = document.getElementById('filters');
  const projectRoot = document.getElementById('project');
  const platformsRoot = document.getElementById('platforms');

  function elt(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function sendAction(action) {
    vscode.postMessage({ type: 'action', action: action });
  }

  function addActions(container, actions, primaryFirst) {
    if (!actions || !actions.length) return;
    const row = elt('div', 'actions');
    actions.forEach((action, index) => {
      const button = elt('button', 'action' + (primaryFirst && index === 0 ? ' primary' : ''), action.label);
      button.disabled = !action.enabled;
      if (action.detail) button.title = action.detail;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        sendAction(action.id);
      });
      row.appendChild(button);
    });
    container.appendChild(row);
  }

  function statusClass(status) {
    return ['ready','partial','missing','unbound','error'].includes(status) ? status : '';
  }

  function shortValue(value) {
    if (!value) return '';
    if (value.includes('/') || value.includes('\\')) {
      const parts = value.split(/[\\/]/).filter(Boolean);
      return parts.slice(-2).join('/');
    }
    return value.length > 34 ? value.slice(0, 31) + '…' : value;
  }

  function renderHealth(state) {
    healthRoot.replaceChildren();
    const health = state.health;
    if (!health) return;

    const box = elt('section', 'health');
    const top = elt('div', 'health-top');
    top.appendChild(elt('div', 'health-title', 'Environment health'));
    top.appendChild(elt('div', 'overall ' + health.overall, health.overall));
    box.appendChild(top);

    const metrics = elt('div', 'metrics');
    const platformTotal = Object.values(health.platformCounts).reduce((sum, value) => sum + value, 0);
    [
      [health.platformCounts.ready + '/' + platformTotal, 'Platforms ready'],
      [health.tools.available + '/' + health.tools.total, 'Tools detected'],
      [health.bindings.bound + '/' + health.bindings.total, 'Bindings'],
      [health.attention.length, 'Attention']
    ].forEach(metric => {
      const cell = elt('div', 'metric');
      cell.appendChild(elt('div', 'metric-value', metric[0]));
      cell.appendChild(elt('div', 'metric-label', metric[1]));
      metrics.appendChild(cell);
    });
    box.appendChild(metrics);
    healthRoot.appendChild(box);
  }

  function renderAttention(state) {
    attentionRoot.replaceChildren();
    const items = state.health && state.health.attention ? state.health.attention : [];
    if (!items.length) return;

    const box = elt('section', 'attention');
    const head = elt('div', 'attention-head');
    head.appendChild(elt('strong', '', 'Needs attention'));
    head.appendChild(elt('span', 'badge partial', items.length));
    box.appendChild(head);

    const list = elt('div', 'attention-list');
    items.slice(0, 5).forEach(item => {
      const row = elt('div', 'attention-item');
      row.appendChild(elt('div', 'attention-marker ' + item.severity));
      const copy = elt('div', 'attention-copy');
      copy.appendChild(elt('div', 'attention-label', item.label));
      copy.appendChild(elt('div', 'attention-detail', item.detail));
      row.appendChild(copy);
      if (item.action) {
        const button = elt('button', 'action', item.action.label);
        button.disabled = !item.action.enabled;
        button.addEventListener('click', () => sendAction(item.action.id));
        row.appendChild(button);
      } else {
        row.appendChild(elt('span', '', ''));
      }
      list.appendChild(row);
    });
    box.appendChild(list);
    attentionRoot.appendChild(box);
  }

  function renderFilters(state) {
    filtersRoot.replaceChildren();
    const counts = state.health ? state.health.platformCounts : {};
    const definitions = [
      ['all', 'All', state.platforms.length],
      ['ready', 'Ready', counts.ready || 0],
      ['partial', 'Partial', counts.partial || 0],
      ['attention', 'Attention', (counts.missing || 0) + (counts.unbound || 0) + (counts.error || 0)]
    ];
    definitions.forEach(def => {
      const button = elt('button', 'filter' + (activeFilter === def[0] ? ' active' : ''), def[1] + ' · ' + def[2]);
      button.addEventListener('click', () => {
        activeFilter = def[0];
        persistView();
        renderFilters(state);
        applyFilter();
      });
      filtersRoot.appendChild(button);
    });
  }

  function renderProject(project) {
    projectRoot.replaceChildren();
    const section = elt('section', 'section');
    const head = elt('div', 'section-head');
    head.appendChild(elt('div', 'section-title', 'Project'));
    head.appendChild(elt('div', 'section-meta', project.active ? 'Bound' : 'Setup required'));
    section.appendChild(head);

    const card = elt('div', 'card project-card');
    const top = elt('div', 'project-head');
    top.appendChild(elt('div', 'card-title', project.title));
    top.appendChild(elt('span', 'badge ' + (project.active ? 'ready' : 'unbound'), project.active ? 'active' : 'unbound'));
    card.appendChild(top);
    card.appendChild(elt('div', 'summary-line', project.summary));

    if (project.bindings && project.bindings.length) {
      const grid = elt('div', 'binding-grid');
      project.bindings.forEach(binding => {
        const row = elt('div', 'binding');
        row.appendChild(elt('span', 'binding-label', binding.label));
        const value = binding.value ? shortValue(binding.value) : binding.status;
        const rhs = elt('span', 'binding-value ' + (binding.status === 'bound' ? 'yes' : binding.status === 'missing' ? 'error' : ''), value);
        if (binding.value) rhs.title = binding.value;
        row.appendChild(rhs);
        grid.appendChild(row);
      });
      card.appendChild(grid);
    }

    const bodyActions = project.actions || [];
    addActions(card, bodyActions, true);
    section.appendChild(card);
    projectRoot.appendChild(section);
  }

  function renderTools(platform) {
    const details = elt('details', 'tools');
    const available = platform.tools.filter(tool => tool.available).length;
    details.appendChild(elt('summary', '', 'Tools · ' + available + '/' + platform.tools.length));
    const list = elt('div', 'tool-list');
    platform.tools.forEach(tool => {
      const row = elt('div', 'tool');
      row.appendChild(elt('span', 'tool-name', tool.label));
      const state = (tool.available ? 'detected' : 'missing') + (tool.version ? ' · ' + tool.version : '');
      const right = elt('span', 'tool-state ' + (tool.available ? 'yes' : ''), state);
      if (tool.detail) right.title = tool.detail;
      row.appendChild(right);
      list.appendChild(row);
    });
    details.appendChild(list);
    return details;
  }

  function renderOperations(platform) {
    const details = elt('details', 'tools');
    const ready = platform.operations.filter(op => op.status === 'ready').length;
    details.appendChild(elt('summary', '', 'Operations · ' + ready + '/' + platform.operations.length + ' ready'));
    const list = elt('div', 'op-list');
    platform.operations.forEach(op => {
      const row = elt('button', 'op');
      row.type = 'button';
      row.title = op.label + ': ' + op.status + '\n' + op.nextStep + '\nClick for the full preflight.';
      row.appendChild(elt('span', 'op-name', op.label + (op.nativeTool ? ' (native tool)' : '')));
      row.appendChild(elt('span', 'op-status s-' + op.status, op.status));
      row.addEventListener('click', event => {
        event.preventDefault();
        vscode.postMessage({ type: 'preflight', capability: op.id });
      });
      list.appendChild(row);
    });
    details.appendChild(list);
    return details;
  }

  function renderCatalog(catalog) {
    const wrapper = elt('details', 'catalog');
    wrapper.appendChild(elt('summary', '', catalog.title + ' · ' + catalog.items.length));
    const groupsRoot = elt('div', 'catalog-groups');
    const groups = new Map();

    catalog.items.forEach(item => {
      const items = groups.get(item.category) || [];
      items.push(item);
      groups.set(item.category, items);
    });

    Array.from(groups.keys()).sort().forEach(category => {
      const group = elt('div', 'catalog-group');
      group.appendChild(elt('div', 'catalog-category', category));
      groups.get(category).forEach(item => {
        const row = elt('div', 'catalog-item');
        row.appendChild(elt('div', 'catalog-name', item.name));
        row.appendChild(elt('div', 'catalog-meta', item.kind + ' · ' + item.source + (item.verifiedRef ? ' · ' + item.verifiedRef.slice(0, 8) : '')));
        if (item.description) row.appendChild(elt('div', 'detail', item.description));
        addActions(row, item.actions, false);
        group.appendChild(row);
      });
      groupsRoot.appendChild(group);
    });
    wrapper.appendChild(groupsRoot);
    return wrapper;
  }

  function renderPlatform(platform) {
    const card = elt('details', 'card platform-card');
    card.dataset.status = platform.status;
    card.dataset.platformId = platform.id;
    card.open = openPlatforms.has(platform.id) || platform.status === 'error' || platform.status === 'missing';

    const summary = elt('summary', '');
    const summaryGrid = elt('div', 'card-summary');
    const left = elt('div', '');
    const titleRow = elt('div', 'card-title-row');
    titleRow.appendChild(elt('span', 'chevron', '▶'));
    titleRow.appendChild(elt('span', 'card-title', platform.title));
    left.appendChild(titleRow);
    left.appendChild(elt('div', 'summary-line', platform.summary));
    summaryGrid.appendChild(left);
    summaryGrid.appendChild(elt('span', 'badge ' + statusClass(platform.status), platform.status));
    summary.appendChild(summaryGrid);
    card.appendChild(summary);

    const body = elt('div', 'card-body');
    if (platform.tools && platform.tools.length) body.appendChild(renderTools(platform));
    if (platform.operations && platform.operations.length) body.appendChild(renderOperations(platform));
    (platform.details || []).forEach(detail => body.appendChild(elt('div', 'detail', detail)));
    addActions(body, platform.actions, true);
    if (platform.catalog && platform.catalog.items && platform.catalog.items.length) {
      body.appendChild(renderCatalog(platform.catalog));
    }
    card.appendChild(body);

    card.addEventListener('toggle', () => {
      if (card.open) openPlatforms.add(platform.id);
      else openPlatforms.delete(platform.id);
      persistView();
    });
    return card;
  }

  function renderPlatformSection(title, ids, state) {
    const platforms = ids.map(id => state.platforms.find(platform => platform.id === id)).filter(Boolean);
    if (!platforms.length) return null;

    const section = elt('section', 'section platform-section');
    const head = elt('div', 'section-head');
    head.appendChild(elt('div', 'section-title', title));
    const detected = platforms.filter(platform => platform.status === 'ready' || platform.status === 'partial').length;
    head.appendChild(elt('div', 'section-meta', detected + '/' + platforms.length + ' active'));
    section.appendChild(head);

    const cards = elt('div', 'cards');
    platforms.forEach(platform => cards.appendChild(renderPlatform(platform)));
    section.appendChild(cards);
    return section;
  }

  function renderPlatforms(state) {
    platformsRoot.replaceChildren();
    const data = renderPlatformSection('Data platforms', ['fabric', 'databricks', 'powerbi'], state);
    const ops = renderPlatformSection('Engineering & runtime', ['observability', 'infrastructure'], state);
    if (data) platformsRoot.appendChild(data);
    if (ops) platformsRoot.appendChild(ops);

    const known = new Set(['fabric','databricks','powerbi','observability','infrastructure']);
    const extras = state.platforms.filter(platform => !known.has(platform.id));
    if (extras.length) {
      const section = elt('section', 'section platform-section');
      const head = elt('div', 'section-head');
      head.appendChild(elt('div', 'section-title', 'Other'));
      head.appendChild(elt('div', 'section-meta', extras.length));
      section.appendChild(head);
      const cards = elt('div', 'cards');
      extras.forEach(platform => cards.appendChild(renderPlatform(platform)));
      section.appendChild(cards);
      platformsRoot.appendChild(section);
    }
    applyFilter();
  }

  function matchesFilter(status) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'ready') return status === 'ready';
    if (activeFilter === 'partial') return status === 'partial';
    if (activeFilter === 'attention') return status === 'missing' || status === 'unbound' || status === 'error';
    return true;
  }

  function applyFilter() {
    document.querySelectorAll('.platform-card').forEach(card => {
      card.classList.toggle('hidden', !matchesFilter(card.dataset.status));
    });
    document.querySelectorAll('.platform-section').forEach(section => {
      const visible = Array.from(section.querySelectorAll('.platform-card')).some(card => !card.classList.contains('hidden'));
      section.classList.toggle('hidden', !visible);
    });
  }

  function persistView() {
    vscode.setState({
      filter: activeFilter,
      openPlatforms: Array.from(openPlatforms)
    });
  }

  function render(state) {
    currentState = state;
    const date = new Date(state.generatedAt);
    timestamp.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    renderHealth(state);
    renderAttention(state);
    renderFilters(state);
    renderProject(state.project);
    renderPlatforms(state);
  }

  window.addEventListener('message', event => {
    if (event.data && event.data.type === 'state') render(event.data.state);
  });
</script>
</body>
</html>`;
}
