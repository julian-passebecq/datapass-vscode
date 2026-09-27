/**
 * V3-HOP2: the DataPass Hop page — a narrow, vertical visual explanation of one file, drawn beside
 * its code (left pane = visual, right pane = code). Pure (no `vscode`): the page is rendered on the
 * extension side from HopState, every text escaped; the small script turns clicks and scrolling
 * into messages and applies the highlight the host sends. It never takes the keyboard focus.
 *
 * Messages sent: ready, step {step}, scrolled {step}, back, explain, openCode, openExplanation.
 * Received: { type: "highlight", step, scroll } (scroll = bring the step into view).
 */
import { DIAGRAM_ICONS, type DiagramIcon } from "../webview/diagramIcons";
import { FAMILY_COLORS } from "../webview/diagramLook";
import { PROVENANCE_LABELS, type HopJoinView, type HopState, type HopStepView } from "./hopState";
import type { StepKind, UnderstandingLanguage } from "../core/understanding/contract";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]!);

/** Step kind → icon (bundled codicons) or a text glyph, and its colour (provider families of the diagram). */
const KIND_LOOK: Record<StepKind, { icon?: string; glyph?: string; color: string }> = {
  source: { icon: "co:database", color: FAMILY_COLORS.azure!.color },
  read: { icon: "co:table", color: FAMILY_COLORS.azure!.color },
  filter: { glyph: "▽", color: FAMILY_COLORS.tools!.color },
  transform: { icon: "co:symbol-method", color: FAMILY_COLORS.git!.color },
  join: { icon: "co:git-merge", color: FAMILY_COLORS.sql!.color },
  aggregate: { icon: "co:layers", color: FAMILY_COLORS.infra!.color },
  write: { icon: "co:archive", color: FAMILY_COLORS.fabric!.color },
  task: { icon: "co:symbol-event", color: FAMILY_COLORS.git!.color },
  branch: { icon: "co:graph", color: FAMILY_COLORS.tools!.color },
  config: { icon: "co:file-code", color: FAMILY_COLORS.neutral!.color },
  test: { glyph: "✓", color: FAMILY_COLORS.fabric!.color },
  other: { icon: "co:package", color: FAMILY_COLORS.neutral!.color }
};

const LANGUAGE_ICON: Record<UnderstandingLanguage, { icon: string; color: string }> = {
  pyspark: { icon: "si:python", color: FAMILY_COLORS.python!.color },
  python: { icon: "si:python", color: FAMILY_COLORS.python!.color },
  sql: { icon: "co:table", color: FAMILY_COLORS.sql!.color },
  airflow: { icon: "si:apacheairflow", color: FAMILY_COLORS.tools!.color },
  adf: { icon: "co:azure", color: FAMILY_COLORS.azure!.color },
  "fabric-pipeline": { icon: "co:azure", color: FAMILY_COLORS.fabric!.color },
  dockerfile: { icon: "si:docker", color: FAMILY_COLORS.infra!.color },
  bicep: { icon: "co:azure", color: FAMILY_COLORS.azure!.color },
  opentofu: { icon: "si:terraform", color: FAMILY_COLORS.infra!.color },
  other: { icon: "co:file-code", color: FAMILY_COLORS.neutral!.color }
};

function svgIcon(id: string, size = 14): string {
  const i: DiagramIcon | undefined = DIAGRAM_ICONS[id];
  if (!i) return "";
  return `<svg class="ico" viewBox="${esc(i.vb)}" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor"${i.evenodd ? ` fill-rule="evenodd"` : ""} d="${esc(i.d)}"/></svg>`;
}

const STYLE = `
  :root { color-scheme: light dark; --hop-accent: var(--vscode-focusBorder); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 40vh; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.4; }
  header { position: sticky; top: 0; z-index: 2; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding: 8px 12px; display: grid; gap: 4px; }
  .bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .file { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 120px; }
  .where { color: var(--vscode-descriptionForeground); font-size: 11px; overflow-wrap: anywhere; }
  .lang { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .lang .ico { color: var(--lang, currentColor); }
  .chip { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); color: var(--vscode-descriptionForeground); }
  .chip.state-ok { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); border-color: currentColor; }
  .chip.state-stale { color: var(--vscode-editorWarning-foreground); border-color: currentColor; }
  .chip.state-orphan { color: var(--vscode-descriptionForeground); border-style: dashed; }
  .chip.state-invalid { color: var(--vscode-errorForeground); border-color: currentColor; }
  main { padding: 10px 12px; display: grid; gap: 0; }
  h1 { font-size: 15px; margin: 0 0 4px; font-weight: 600; }
  .summary { color: var(--vscode-descriptionForeground); margin: 0 0 10px; }
  .banner { border: 1px solid; border-left-width: 3px; border-radius: 4px; padding: 8px 10px; margin: 0 0 10px; display: grid; gap: 6px; }
  .banner.info { border-color: var(--vscode-widget-border, var(--vscode-panel-border)); border-left-color: var(--hop-accent); }
  .banner.warning { border-color: var(--vscode-editorWarning-foreground); }
  .banner.error { border-color: var(--vscode-errorForeground); }
  .banner strong { display: block; }
  ul.problems { margin: 0; padding-left: 18px; }
  ul.problems li { overflow-wrap: anywhere; }
  code, .mono { font-family: var(--vscode-editor-font-family); font-size: 12px; overflow-wrap: anywhere; }
  button { font-family: inherit; font-size: 12px; cursor: pointer; border-radius: 4px; padding: 3px 9px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { cursor: default; opacity: .5; }
  button:focus-visible, .step:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  button.link { background: none; border: 0; padding: 0; color: var(--vscode-textLink-foreground); text-align: left; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .flow { display: grid; }
  .connector { height: 14px; margin-left: 22px; border-left: 2px solid var(--vscode-widget-border, var(--vscode-panel-border)); position: relative; }
  .connector.data { border-left-color: var(--vscode-descriptionForeground); }
  .connector.control, .connector.dependency { border-left-style: dashed; border-left-color: var(--vscode-descriptionForeground); }
  .connector.none { border-left-style: dotted; }
  .connector.data::after, .connector.control::after, .connector.dependency::after { content: ""; position: absolute; left: -5px; bottom: -1px; border: 4px solid transparent; border-top: 5px solid var(--vscode-descriptionForeground); }
  .step { position: relative; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-left: 4px solid var(--kind); border-radius: 6px; padding: 8px 10px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); cursor: pointer; display: grid; gap: 4px; min-width: 0; }
  .step:hover { border-color: var(--vscode-focusBorder); border-left-color: var(--kind); }
  .step.active { box-shadow: 0 0 0 2px var(--hop-accent); background: var(--vscode-editor-selectionHighlightBackground, var(--vscode-list-inactiveSelectionBackground)); }
  .step.beyond { opacity: .7; border-style: dashed; }
  .step .head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .kind { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 5px; background: var(--kind); color: #fff; font-size: 12px; font-weight: 700; }
  .step .title { font-weight: 600; min-width: 0; overflow-wrap: anywhere; flex: 1 1 auto; }
  .lines { flex: none; font-size: 11px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
  .meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .milestone { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--kind); }
  .prov { font-size: 10px; padding: 0 5px; border-radius: 999px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .prov.inferred { border-style: dashed; }
  .prov.estimated { border-style: dotted; }
  .prov.illustrative { font-style: italic; border-style: dotted; }
  .io { display: grid; grid-template-columns: auto 1fr; gap: 2px 6px; font-size: 12px; }
  .io .k { color: var(--vscode-descriptionForeground); }
  .names { display: flex; flex-wrap: wrap; gap: 3px; }
  .name { font-family: var(--vscode-editor-font-family); font-size: 11px; padding: 0 5px; border-radius: 3px; background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); overflow-wrap: anywhere; }
  .note { font-size: 12px; }
  details.cols summary { cursor: pointer; font-size: 11px; color: var(--vscode-descriptionForeground); }
  details.cols ul { margin: 4px 0 0; padding-left: 16px; font-size: 12px; }
  .from { font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; flex-wrap: wrap; gap: 4px; }
  .join { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; align-items: center; border: 1px dashed var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 5px; padding: 6px; margin-top: 2px; }
  .tbl { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 4px; padding: 3px 5px; font-family: var(--vscode-editor-font-family); font-size: 11px; overflow-wrap: anywhere; background: var(--vscode-editor-background); }
  .tbl.right { text-align: right; }
  .jt { display: grid; justify-items: center; gap: 1px; font-size: 9px; font-weight: 700; letter-spacing: .05em; color: var(--kind); }
  .jt svg { overflow: visible; }
  .keys { grid-column: 1 / -1; margin: 0; padding: 0; list-style: none; font-family: var(--vscode-editor-font-family); font-size: 11px; display: grid; gap: 1px; }
  .keys li { overflow-wrap: anywhere; }
  .join .jnote { grid-column: 1 / -1; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .empty { color: var(--vscode-descriptionForeground); }
  body.vscode-high-contrast .step, body.vscode-high-contrast-light .step { border-left-color: var(--vscode-contrastBorder, currentColor); }
  body.vscode-high-contrast .kind, body.vscode-high-contrast-light .kind { background: none; color: var(--vscode-foreground); border: 1px solid var(--vscode-contrastBorder, currentColor); }
  body.vscode-high-contrast .step.active, body.vscode-high-contrast-light .step.active { outline: 2px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder)); }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  const steps = () => Array.from(document.querySelectorAll(".step[data-step]"));
  let active = document.body.dataset.active || "";
  let programmaticUntil = 0;
  let lastReported = active;
  let timer;
  function setActive(id) {
    active = id || "";
    for (const s of steps()) s.classList.toggle("active", s.dataset.step === active);
  }
  function reveal(id) {
    const el = steps().find(s => s.dataset.step === id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = (document.querySelector("header")?.getBoundingClientRect().bottom || 0);
    if (r.top >= top && r.bottom <= window.innerHeight) return;
    programmaticUntil = Date.now() + 600;
    lastReported = id;
    window.scrollBy({ top: r.top - top - 8, behavior: "auto" });
  }
  document.addEventListener("click", e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const b = t.closest("button");
    if (b) {
      if (b.disabled) return;
      if (b.dataset.goto) { setActive(b.dataset.goto); reveal(b.dataset.goto); vscode.postMessage({ type: "step", step: b.dataset.goto }); return; }
      if (b.dataset.msg) vscode.postMessage({ type: b.dataset.msg });
      return;
    }
    if (t.closest("summary, details")) return;
    const s = t.closest(".step[data-step]");
    if (s) { setActive(s.dataset.step); lastReported = s.dataset.step; vscode.postMessage({ type: "step", step: s.dataset.step }); }
  });
  document.addEventListener("keydown", e => {
    const s = e.target instanceof Element ? e.target.closest(".step[data-step]") : null;
    if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setActive(s.dataset.step); vscode.postMessage({ type: "step", step: s.dataset.step }); }
  });
  window.addEventListener("scroll", () => {
    if (Date.now() < programmaticUntil) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (Date.now() < programmaticUntil) return;
      const top = (document.querySelector("header")?.getBoundingClientRect().bottom || 0) + 4;
      const el = steps().find(s => s.getBoundingClientRect().bottom > top);
      const id = el && el.dataset.step;
      if (!id || id === lastReported) return;
      lastReported = id;
      setActive(id);
      vscode.postMessage({ type: "scrolled", step: id });
    }, 180);
  }, { passive: true });
  window.addEventListener("message", e => {
    const m = e.data;
    if (!m || m.type !== "highlight") return;
    setActive(typeof m.step === "string" ? m.step : "");
    if (m.scroll && m.step) reveal(m.step);
  });
  setActive(active);
  vscode.postMessage({ type: "ready" });
`;

/** A small Venn-like drawing of the join type (two tables, the kept rows filled). */
export function joinSvg(type: HopJoinView["type"], n: number): string {
  const L = `<circle cx="15" cy="13" r="10"/>`, R = `<circle cx="29" cy="13" r="10"/>`;
  const clip = `<clipPath id="hopL${n}">${L}</clipPath>`;
  const fillL = `<g fill="currentColor" fill-opacity=".45">${L}</g>`;
  const fillR = `<g fill="currentColor" fill-opacity=".45">${R}</g>`;
  const inter = (color = "currentColor", opacity = ".75") => `<g clip-path="url(#hopL${n})"><circle cx="29" cy="13" r="10" fill="${color}" fill-opacity="${opacity}"/></g>`;
  const body = type === "inner" || type === "semi" ? inter()
    : type === "left" ? fillL + inter()
    : type === "right" ? fillR + inter()
    : type === "full" ? fillL + fillR + inter()
    : type === "anti" ? fillL + inter("var(--vscode-editor-background)", "1")
    : `<text x="22" y="17" text-anchor="middle" font-size="12" fill="currentColor">×</text>`;
  return `<svg width="44" height="26" viewBox="0 0 44 26" aria-hidden="true"><defs>${clip}</defs>${body}<g fill="none" stroke="currentColor" stroke-width="1.2">${L}${R}</g></svg>`;
}

const prov = (p: HopStepView["provenance"]) => `<span class="prov ${p}" title="${esc(PROVENANCE_LABELS[p].about)}">${esc(PROVENANCE_LABELS[p].label)}</span>`;
const names = (list: string[]) => `<span class="names">${list.map(n => `<span class="name">${esc(n)}</span>`).join("")}</span>`;

let joinCounter = 0;
function joinHtml(j: HopJoinView): string {
  const n = joinCounter++;
  return `<div class="join" data-join="${esc(j.id)}">
  <div class="tbl left" title="Left table">${esc(j.left)}</div>
  <div class="jt" title="${esc(j.typeLabel)} JOIN">${joinSvg(j.type, n)}<span>${esc(j.typeLabel)}</span></div>
  <div class="tbl right" title="Right table">${esc(j.right)}</div>
  ${j.keys.length ? `<ul class="keys">${j.keys.map(([l, r]) => `<li>${esc(l)} = ${esc(r)}</li>`).join("")}</ul>` : ""}
  ${j.note || j.provenance !== "declared" ? `<div class="jnote">${j.note ? esc(j.note) + " " : ""}${j.provenance !== "declared" ? prov(j.provenance) : ""}</div>` : ""}
</div>`;
}

function stepHtml(s: HopStepView): string {
  const look = KIND_LOOK[s.kind];
  const badge = look.icon ? svgIcon(look.icon, 14) : esc(look.glyph ?? "•");
  const lines = s.lines[0] === s.lines[1] ? `L${s.lines[0]}` : `L${s.lines[0]}–${s.lines[1]}`;
  const io = [
    s.inputs.length ? `<span class="k">in</span>${names(s.inputs)}` : "",
    s.outputs.length ? `<span class="k">out</span>${names(s.outputs)}` : ""
  ].filter(Boolean).join("");
  return `<div class="step${s.beyond ? " beyond" : ""}" data-step="${esc(s.id)}" data-kind="${esc(s.kind)}" style="--kind:${look.color}" tabindex="0" role="button" aria-label="${esc(`${s.kindLabel}: ${s.title}, lines ${s.lines[0]} to ${s.lines[1]}`)}">
  ${s.milestone ? `<span class="milestone">${esc(s.milestone)}</span>` : ""}
  <div class="head"><span class="kind" title="${esc(s.kindLabel)}">${badge}</span><span class="title">${esc(s.title)}</span><span class="lines" title="Lines ${s.lines[0]}–${s.lines[1]} of the code">${lines}</span></div>
  <div class="meta"><span>${esc(s.kindLabel)}</span>${prov(s.provenance)}${s.beyond ? `<span class="chip state-stale">beyond the file</span>` : ""}</div>
  ${s.from.length ? `<div class="from">from ${s.from.map(f => `<button type="button" class="link" data-goto="${esc(f.id)}" title="${esc(f.kind)} link">${esc(f.title)}</button>`).join(", ")}</div>` : ""}
  ${io ? `<div class="io">${io}</div>` : ""}
  ${s.joins.map(joinHtml).join("")}
  ${s.columns.length ? `<details class="cols"><summary>${s.columns.length} column${s.columns.length === 1 ? "" : "s"}</summary><ul>${s.columns.map(c => `<li><code>${esc(c.name)}</code>${c.from ? ` ← <code>${esc(c.from)}</code>` : ""}${c.note ? ` — ${esc(c.note)}` : ""}</li>`).join("")}</ul></details>` : ""}
  ${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}
</div>`;
}

function bodyHtml(s: HopState): string {
  const lang = s.language ? LANGUAGE_ICON[s.language] : undefined;
  const header = `<header>
  <div class="bar">
    ${s.canGoBack ? `<button type="button" data-msg="back" title="Back to the architecture diagram">← Diagram</button>` : ""}
    <span class="file" title="${esc(s.where)}">${esc(s.fileName)}</span>
    ${lang ? `<span class="lang" style="--lang:${lang.color}">${svgIcon(lang.icon, 12)}${esc(s.languageLabel)}</span>` : ""}
    ${s.state ? `<span class="chip state-${s.state}" data-state="${s.state}">${esc(s.state)}</span>` : ""}
  </div>
  <div class="where">${esc(s.where)}</div>
</header>`;
  const banner = s.banner ? `<div class="banner ${s.banner.level}" data-banner="${s.banner.level}"><div><strong>${esc(s.banner.title)}</strong>${esc(s.banner.text)}</div>
  ${s.problems.length ? `<ul class="problems">${s.problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
  ${s.kind === "missing" ? `<div class="actions"><button type="button" class="primary" data-msg="explain"${s.explainDisabled ? ` disabled title="${esc(s.explainDisabled)}"` : ` title="Prepares a work order for Claude or Codex; nothing is written until you confirm it"`}>Explain this file</button></div>${s.explainDisabled ? `<div class="where">${esc(s.explainDisabled)}</div>` : ""}` : ""}
  ${s.state === "invalid" || s.state === "stale" ? `<div class="actions"><button type="button" data-msg="openExplanation">Open the explanation file</button></div>` : ""}
</div>` : "";
  const intro = s.title ? `<h1>${esc(s.title)}</h1>${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ""}` : "";
  const flow = s.steps.length ? `<div class="flow" data-flow>${s.steps.map((st, i) => (i ? `<div class="connector ${st.fromPrevious ?? "none"}" title="${esc(st.fromPrevious ? `${st.fromPrevious} link` : "no declared link")}"></div>` : "") + stepHtml(st)).join("")}</div>` : s.kind === "explained" && s.state !== "invalid" ? `<p class="empty">No steps.</p>` : "";
  const warnings = s.kind === "explained" && s.state !== "invalid" && s.state !== "orphan" && s.problems.length && !s.banner ? `<div class="banner warning"><strong>Warnings</strong><ul class="problems">${s.problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : "";
  return `${header}<main>${banner}${warnings}${intro}${flow}</main>`;
}

export function hopHtml(state: HopState, cspSource: string, nonce: string, active?: string): string {
  joinCounter = 0;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>DataPass Hop</title>
<style>${STYLE}</style>
</head>
<body data-kind="${state.kind}" data-active="${esc(active ?? "")}">
${bodyHtml(state)}
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
