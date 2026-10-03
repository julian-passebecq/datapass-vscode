/**
 * V5 TOUR2: the Guided header and edit row around the Navigator Tours section, pure part (no `vscode`):
 * mode switch (All / Learning / Interview, only enabled modes), Present toggle (read-only: no edit
 * controls, no jump field), "Save current path as tour" / "Add this screen to tour", and the script
 * for Next/Previous by 1–9 keys and wheel/scroll inside the webview. Words come from the label pack
 * (`mode.<mode>`, `ui.<key>`).
 */
import type { GuidedMode } from "../../core/guided/guided";
import { uiLabel, type LabelPack } from "../navToursHtml";

export interface GuidedHeader {
  readonly labels: LabelPack;
  readonly modes: readonly GuidedMode[];
  readonly mode: GuidedMode;
  readonly presenting: boolean;
  /** "Add this screen" needs a user tour to add to (or creates one). */
  readonly canEdit: boolean;
}

export type GuidedMessage =
  | { type: "guided"; action: "mode"; mode: GuidedMode }
  | { type: "guided"; action: "present" | "save-path" | "add-screen" }
  | { type: "guided"; action: "key"; key: string }
  | { type: "guided"; action: "wheel"; deltaY: number };

export function parseGuidedMessage(raw: unknown): GuidedMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== "guided") return null;
  switch (m.action) {
    case "mode": return m.mode === "all" || m.mode === "learning" || m.mode === "interview" ? { type: "guided", action: "mode", mode: m.mode } : null;
    case "present": case "save-path": case "add-screen": return { type: "guided", action: m.action };
    case "key": return typeof m.key === "string" && /^[1-9]$|^Arrow(Left|Right|Up|Down)$|^PageUp$|^PageDown$/.test(m.key) ? { type: "guided", action: "key", key: m.key } : null;
    case "wheel": return typeof m.deltaY === "number" && Number.isFinite(m.deltaY) ? { type: "guided", action: "wheel", deltaY: Math.max(-10_000, Math.min(10_000, m.deltaY)) } : null;
    default: return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
const modeLabel = (L: LabelPack, m: GuidedMode) => L[`mode.${m}`] ?? m;

/** Header (modes + Present) before the Tours section, edit row after it; presenting strips the jump field. */
export function guidedHtml(inner: string, h: GuidedHeader): string {
  const L = (k: string) => uiLabel(h.labels, k);
  const modes = h.modes.length > 1
    ? `<div class="guided-modes" role="radiogroup">${h.modes.map((m) => `<button class="guided-mode${m === h.mode ? " active" : ""}" role="radio" aria-checked="${m === h.mode}" data-guided-mode="${esc(m)}">${esc(modeLabel(h.labels, m))}</button>`).join("")}</div>`
    : "";
  const present = `<button class="guided-present${h.presenting ? " active" : ""}" aria-pressed="${h.presenting}" data-guided-action="present">${esc(L(h.presenting ? "stopPresenting" : "present"))}</button>`;
  const edit = h.presenting ? "" : `<div class="guided-edit"><button data-guided-action="save-path">${esc(L("savePath"))}</button><button data-guided-action="add-screen"${h.canEdit ? "" : " disabled"}>${esc(L("addScreen"))}</button></div>`;
  const body = h.presenting ? inner.replace(/<input class="tour-jump"[^>]*>/, "") : inner;
  return `<div class="guided${h.presenting ? " presenting" : ""}" tabindex="0"><div class="guided-head">${modes}${present}</div>${body}${edit}</div>`;
}

/**
 * Guided script (included once by the Navigator under its nonce, after `toursScript`): header clicks,
 * 1–9 / arrows / PageUp-PageDown keys and the wheel over the step list post `{type:"guided", …}`.
 */
export function guidedScript(api: string): string {
  return `(() => {
  const slot = document.getElementById("tours"); if (!slot) return;
  let wheelAt = 0;
  slot.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.guidedMode) ${api}.postMessage({ type: "guided", action: "mode", mode: b.dataset.guidedMode });
    else if (b.dataset.guidedAction) ${api}.postMessage({ type: "guided", action: b.dataset.guidedAction });
  });
  slot.addEventListener("keydown", (e) => {
    if (e.target.classList && e.target.classList.contains("tour-jump")) return;
    if (/^[1-9]$|^Arrow(Left|Right|Up|Down)$|^Page(Up|Down)$/.test(e.key)) { e.preventDefault(); ${api}.postMessage({ type: "guided", action: "key", key: e.key }); }
  });
  // V5HOLE19: a started tour reveals the Navigator with the focus on its page, not in this slot: 1–9 still pick the
  // step there while a tour lists steps (never from a text field; arrows stay slot-only for the Navigator's own use).
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (slot.contains(t) || !/^[1-9]$/.test(e.key) || !slot.querySelector(".tour-step")) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return;
    e.preventDefault(); ${api}.postMessage({ type: "guided", action: "key", key: e.key });
  });
  slot.addEventListener("wheel", (e) => {
    if (!e.target.closest(".tour-steps")) return;
    const now = Date.now(); if (now - wheelAt < 350) return;
    wheelAt = now; ${api}.postMessage({ type: "guided", action: "wheel", deltaY: e.deltaY });
  }, { passive: true });
})();`;
}
