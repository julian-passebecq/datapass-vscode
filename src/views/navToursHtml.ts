/**
 * V4-NAV NAVTOUR1: the Navigator `#tours` slot, pure part (no `vscode`): the UI words (defaults of
 * the setting `datapass.tours.labels`), the slot model, its HTML (escaped, no inline handlers), the
 * slot script and the message validator. navTours.ts owns the state and the commands.
 */
import type { Tour } from "../core/navigation/tours/tours";

export const TOURS_LABELS = {
  heading: "Tours", none: "No tour yet: tours come from lineage and execution facts, or .datapass/tours.json.",
  previous: "Previous", next: "Next", stale: "missing", aiProposed: "AI-proposed", user: "yours",
  jump: "Jump to a box…", jumpEmpty: "No box matches.", pickTour: "Pick a tour", step: "Step"
} as const;
export type ToursLabels = { -readonly [K in keyof typeof TOURS_LABELS]: string };

export interface ToursModel {
  readonly labels: ToursLabels;
  readonly journeys: readonly { id: string; label: string; active: boolean }[];
  readonly tours: readonly { id: string; title: string; origin: Tour["origin"]; active: boolean }[];
  readonly steps: readonly { index: number; label: string; text: string; stale: boolean; current: boolean }[];
  readonly canPrev: boolean; readonly canNext: boolean;
  readonly jump: { readonly query: string; readonly hits: readonly { index: number; label: string; kind: string }[] };
  readonly problems: readonly string[];
}

/** Messages the `#tours` slot sends (validated; anything else is dropped). */
export type ToursMessage =
  | { type: "tour"; action: "journey"; journey: string }
  | { type: "tour"; action: "select"; tourId: string }
  | { type: "tour"; action: "step"; index: number }
  | { type: "tour"; action: "next" | "prev" }
  | { type: "tour"; action: "jump-query"; query: string }
  | { type: "tour"; action: "jump-go"; index: number };

export function parseToursMessage(raw: unknown): ToursMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== "tour") return null;
  const s = (v: unknown, max = 200) => typeof v === "string" && v.length <= max;
  const n = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000;
  switch (m.action) {
    case "journey": return s(m.journey, 64) ? { type: "tour", action: "journey", journey: m.journey as string } : null;
    case "select": return s(m.tourId, 140) ? { type: "tour", action: "select", tourId: m.tourId as string } : null;
    case "step": return n(m.index) ? { type: "tour", action: "step", index: m.index as number } : null;
    case "next": case "prev": return { type: "tour", action: m.action };
    case "jump-query": return s(m.query) ? { type: "tour", action: "jump-query", query: m.query as string } : null;
    case "jump-go": return n(m.index) ? { type: "tour", action: "jump-go", index: m.index as number } : null;
    default: return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));

/** The `#tours` slot content (pure). Clicks are read from `data-tour-*` attributes by `toursScript`. */
export function toursHtml(m: ToursModel): string {
  const L = m.labels;
  const journeysRow = m.journeys.map((j) => `<button class="tour-journey${j.active ? " active" : ""}" data-tour-journey="${esc(j.id)}" aria-pressed="${j.active}">${esc(j.label)}</button>`).join("");
  const tours = m.tours.length > 1
    ? `<div class="tour-list">${m.tours.map((t) => `<button class="tour-pick${t.active ? " active" : ""}" data-tour-select="${esc(t.id)}">${esc(t.title)}${t.origin === "ai-proposed" ? ` <span class="tour-badge">${esc(L.aiProposed)}</span>` : t.origin === "user" ? ` <span class="tour-badge">${esc(L.user)}</span>` : ""}</button>`).join("")}</div>`
    : "";
  const steps = m.steps.length
    ? `<ol class="tour-steps">${m.steps.map((s) => `<li class="${s.current ? "current" : ""}${s.stale ? " stale" : ""}"><button data-tour-step="${s.index}" title="${esc(s.text)}"${s.stale ? " disabled" : ""}><span class="tour-n">${s.index + 1}</span> ${esc(s.label)}${s.stale ? ` <span class="tour-badge">${esc(L.stale)}</span>` : ""}</button>${s.current && s.text ? `<div class="tour-text">${esc(s.text)}</div>` : ""}</li>`).join("")}</ol>
      <div class="tour-nav"><button data-tour-action="prev"${m.canPrev ? "" : " disabled"}>${esc(L.previous)}</button><button data-tour-action="next"${m.canNext ? "" : " disabled"}>${esc(L.next)}</button></div>`
    : `<p class="tour-none">${esc(L.none)}</p>`;
  const hits = m.jump.query
    ? (m.jump.hits.length ? `<ul class="tour-hits">${m.jump.hits.map((h) => `<li><button data-tour-jump="${h.index}">${esc(h.label)} <span class="tour-kind">${esc(h.kind)}</span></button></li>`).join("")}</ul>` : `<p class="tour-none">${esc(L.jumpEmpty)}</p>`)
    : "";
  return `<section class="tours" aria-label="${esc(L.heading)}"><h3>${esc(L.heading)}</h3>
    <input class="tour-jump" type="search" placeholder="${esc(L.jump)}" aria-label="${esc(L.jump)}" value="${esc(m.jump.query)}">${hits}
    ${m.journeys.length ? `<div class="tour-journeys">${journeysRow}</div>` : ""}${tours}${steps}</section>`;
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
    if (e.data && e.data.type === "tours") {
      const focused = document.activeElement && document.activeElement.classList.contains("tour-jump");
      const pos = focused ? document.activeElement.selectionStart : null;
      slot.innerHTML = e.data.html;
      if (focused) { const i = slot.querySelector(".tour-jump"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
    }
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
    if (e.target.classList.contains("tour-jump") && e.key === "Enter") {
      const first = slot.querySelector("[data-tour-jump]"); if (first) first.click();
    }
  });
})();`;
}
