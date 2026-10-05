/**
 * V4-NAV NAVTOUR1: the Navigator `#tours` slot, pure part (no `vscode`): the label pack (built-in
 * `resources/guided/labels.json` + the setting `datapass.guided.labels`), the slot model, its HTML
 * (escaped, no inline handlers), the slot script and the message validator. navTours.ts owns the
 * state and the commands.
 */
import builtinLabels from "../../resources/guided/labels.json";
import type { StepStatus } from "../core/navigation/tours/store";

export type LabelPack = Readonly<Record<string, string>>;

/** Built-in labels overridden key by key by the setting (strings ≤ 2000 chars only). */
export function labelPack(overrides: unknown): LabelPack {
  const out: Record<string, string> = { ...(builtinLabels as Record<string, string>) };
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) if (typeof v === "string" && v.length <= 2000) out[k] = v;
  }
  return out;
}
/** A UI word: the pack's `ui.<key>`, else the key itself (never blank). */
export const uiLabel = (pack: LabelPack, key: string): string => pack[`ui.${key}`] ?? key;

export interface ToursModel {
  /** V5HOLE12: the section is folded to its heading (built-in tours are built only once it is expanded). */
  readonly collapsed?: boolean;
  readonly labels: LabelPack;
  readonly journeys: readonly { id: string; label: string; active: boolean }[];
  readonly tours: readonly { id: string; title: string; badge?: "ai-proposed" | "user"; active: boolean }[];
  readonly steps: readonly { index: number; number: string; depth: number; label: string; preview: string; status: StepStatus; current: boolean }[];
  /** The current step's explanation; `null` = typed hole (ref not resolved). */
  readonly explanation: string | null;
  /** The explanation box under the current step (TOUR2 setting `datapass.guided.panels.explanationBox`); absent = shown. */
  readonly explanationBox?: boolean;
  readonly canPrev: boolean; readonly canNext: boolean;
  readonly jump: { readonly query: string; readonly hits: readonly { index: number; label: string; kind: string }[] };
}

/** Messages the `#tours` slot sends (validated; anything else is dropped). */
export type ToursMessage =
  | { type: "tour"; action: "journey"; journey: string }
  | { type: "tour"; action: "select"; tourId: string }
  | { type: "tour"; action: "step"; index: number }
  | { type: "tour"; action: "next" | "prev" | "toggle" }
  | { type: "tour"; action: "jump-query"; query: string }
  | { type: "tour"; action: "jump-go"; index: number };

export function parseToursMessage(raw: unknown): ToursMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== "tour") return null;
  const s = (v: unknown, max = 200) => typeof v === "string" && v.length <= max;
  const n = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000;
  switch (m.action) {
    case "journey": return s(m.journey, 128) ? { type: "tour", action: "journey", journey: m.journey as string } : null;
    case "select": return s(m.tourId, 128) ? { type: "tour", action: "select", tourId: m.tourId as string } : null;
    case "step": return n(m.index) ? { type: "tour", action: "step", index: m.index as number } : null;
    case "next": case "prev": case "toggle": return { type: "tour", action: m.action };
    case "jump-query": return s(m.query) ? { type: "tour", action: "jump-query", query: m.query as string } : null;
    case "jump-go": return n(m.index) ? { type: "tour", action: "jump-go", index: m.index as number } : null;
    default: return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
const badge = (text: string) => ` <span class="tour-badge">${esc(text)}</span>`;

/** The `#tours` slot content (pure). Clicks are read from `data-tour-*` attributes by `toursScript`. */
export function toursHtml(m: ToursModel): string {
  const L = (k: string) => uiLabel(m.labels, k);
  const journeysRow = m.journeys.length > 1 || (m.journeys[0] && m.journeys[0].id)
    ? `<div class="tour-journeys">${m.journeys.map((j) => `<button class="tour-journey${j.active ? " active" : ""}" data-tour-journey="${esc(j.id)}" aria-pressed="${j.active}">${esc(j.label)}</button>`).join("")}</div>`
    : "";
  const tours = m.tours.length > 1
    ? `<div class="tour-list">${m.tours.map((t) => `<button class="tour-pick${t.active ? " active" : ""}" data-tour-select="${esc(t.id)}" aria-pressed="${t.active}">${esc(t.title)}${t.badge ? badge(L(t.badge === "ai-proposed" ? "aiProposed" : "user")) : ""}</button>`).join("")}</div>`
    : "";
  const steps = m.steps.length
    ? `<ol class="tour-steps">${m.steps.map((s) => {
      const hole = s.status === "ok" ? "" : badge(L(s.status === "unknown-location" ? "unknownLocation" : "unknownView"));
      const box = s.current && m.explanationBox !== false ? `<div class="tour-text">${m.explanation === null ? `<span class="tour-hole">${esc(L("noExplanation"))}</span>` : esc(m.explanation)}<p class="tour-hole">Source: ${esc(s.preview)}. Visiting a step does not verify it.</p></div>` : "";
      return `<li class="tour-step depth-${Math.min(s.depth, 4)}${s.current ? " current" : ""}${s.status === "ok" ? "" : " stale"}"><button data-tour-step="${s.index}" title="${esc(s.preview)}"${s.status === "unknown-location" ? " disabled" : ""}${s.current ? " aria-current=\"step\"" : ""}><span class="tour-n">${esc(s.number)}</span> ${esc(s.label)}${hole}</button>${box}</li>`;
    }).join("")}</ol>
      <div class="tour-nav"><button data-tour-action="prev"${m.canPrev ? "" : " disabled"}>${esc(L("previous"))}</button><button data-tour-action="next"${m.canNext ? "" : " disabled"}>${esc(L("next"))}</button></div>`
    : `<p class="tour-none">${esc(L("none"))}</p>`;
  const hits = m.jump.query
    ? (m.jump.hits.length ? `<ul class="tour-hits">${m.jump.hits.map((h) => `<li><button data-tour-jump="${h.index}">${esc(h.label)} <span class="tour-kind">${esc(h.kind)}</span></button></li>`).join("")}</ul>` : `<p class="tour-none">${esc(L("jumpEmpty"))}</p>`)
    : "";
  const open = !m.collapsed;
  const heading = `<h3><button class="tour-toggle" data-tour-action="toggle" aria-expanded="${open}">${open ? "\u25be" : "\u25b8"} ${esc(L("heading"))}</button></h3>`;
  if (!open) return `<section class="tours collapsed" aria-label="${esc(L("heading"))}">${heading}</section>`;
  return `<section class="tours" aria-label="${esc(L("heading"))}">${heading}`
    + `<input class="tour-jump" type="search" placeholder="${esc(L("jump"))}" aria-label="${esc(L("jump"))}" value="${esc(m.jump.query)}">${hits}`
    + `${journeysRow}${tours}${steps}</section>`;
}

/** The slot's styles (VS Code theme variables only). */
export function toursCss(): string {
  return `  .tours h3 { margin-top: 10px; }
  .tour-jump { width: 100%; box-sizing: border-box; margin-bottom: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; }
  .tour-journeys, .tour-list, .tour-nav { display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }
  .tour-journeys button, .tour-list button, .tour-nav button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; }
  .tour-journeys button.active, .tour-list button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .tour-nav button:disabled { opacity: .4; cursor: default; }
  .tour-steps { list-style: none; padding: 0; margin: 0; }
  .tour-step button { width: 100%; text-align: left; background: none; border: none; color: var(--vscode-foreground); padding: 2px 4px; cursor: pointer; }
  .tour-step.current > button { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .tour-step.stale > button { opacity: .6; }
  .tour-step.depth-1 { padding-left: 10px; } .tour-step.depth-2 { padding-left: 20px; } .tour-step.depth-3 { padding-left: 30px; } .tour-step.depth-4 { padding-left: 40px; }
  .tour-n { opacity: .7; }
  .tour-toggle { background: none; border: none; color: inherit; font: inherit; padding: 0; cursor: pointer; }
  .tour-text { margin: 2px 4px 6px; padding: 4px 6px; border-left: 2px solid var(--vscode-textLink-foreground); white-space: pre-wrap; }
  .tour-hole, .tour-none { opacity: .7; font-style: italic; }
  .tour-badge, .tour-kind { font-size: 10px; opacity: .75; border: 1px solid var(--vscode-badge-background); border-radius: 3px; padding: 0 3px; }
  .tour-hits { list-style: none; padding: 0; margin: 0 0 4px; }
  .tour-hits button { width: 100%; text-align: left; background: none; border: none; color: var(--vscode-foreground); cursor: pointer; }
  .tour-hits button:hover, .tour-step button:hover { background: var(--vscode-list-hoverBackground); }`;
}

/**
 * The slot's script (the Navigator includes it once under its nonce). `api` is the name of the
 * webview's `acquireVsCodeApi()` result. Fills `#tours` on `{type:"tours", html}`; clicks and the
 * jump field post `{type:"tour", …}`.
 */
export function toursScript(api: string): string {
  return `(() => {
  const slot = document.getElementById("tours"); if (!slot) return;
  let timer;
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "tours") return;
    const a = document.activeElement, focused = a && a.classList && a.classList.contains("tour-jump"), pos = focused ? a.selectionStart : null;
    slot.innerHTML = e.data.html;
    if (focused) { const i = slot.querySelector(".tour-jump"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
  });
  slot.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.tourJourney !== undefined) ${api}.postMessage({ type: "tour", action: "journey", journey: d.tourJourney });
    else if (d.tourSelect !== undefined) ${api}.postMessage({ type: "tour", action: "select", tourId: d.tourSelect });
    else if (d.tourStep !== undefined) ${api}.postMessage({ type: "tour", action: "step", index: Number(d.tourStep) });
    else if (d.tourJump !== undefined) ${api}.postMessage({ type: "tour", action: "jump-go", index: Number(d.tourJump) });
    else if (d.tourAction) ${api}.postMessage({ type: "tour", action: d.tourAction });
  });
  slot.addEventListener("input", (e) => {
    if (!e.target.classList.contains("tour-jump")) return;
    clearTimeout(timer);
    const query = e.target.value.slice(0, 200);
    timer = setTimeout(() => ${api}.postMessage({ type: "tour", action: "jump-query", query }), 120);
  });
  slot.addEventListener("keydown", (e) => {
    if (e.target.classList.contains("tour-jump") && e.key === "Enter") { const first = slot.querySelector("[data-tour-jump]"); if (first) first.click(); }
  });
})();`;
}
