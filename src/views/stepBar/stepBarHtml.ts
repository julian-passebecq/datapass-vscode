/**
 * V5 STEPBAR1: the Steps bar, pure part (no `vscode`). It decorates TOUR2's step list (NAVTOUR1
 * `toursHtml`, never re-implemented) with each step's small checks, adds the "Project checks" step
 * at the end, and draws the default journey's steps when no tour runs yet (a click starts it there).
 * Clicks post `{type:"step-check"|"step-start"|"step-go", …}` (validated by `parseStepBarMessage`).
 */
import type { StepCheck, StepCheckStatus } from "../../core/steps/stepChecks";
import { checkCounts } from "../../core/steps/stepChecks";

export type StepBarLabels = Readonly<Record<string, string>>;
const L = (labels: StepBarLabels, k: string) => labels[k] ?? k;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));

const STATUS_ICON: Record<StepCheckStatus, string> = { pass: "✓", fail: "✗", "not-checked": "○", hole: "?" };

/** The chips (`2 ✗ · 1 ?`) and the check rows of one step; passing rows without an action stay counted only. */
export function stepChecksHtml(checks: readonly StepCheck[], labels: StepBarLabels): string {
  if (!checks.length) return "";
  const n = checkCounts(checks);
  const chips = (["fail", "hole", "not-checked", "pass"] as const).filter((s) => n[s] > 0)
    .map((s) => `<span class="step-chip ${s}" title="${esc(L(labels, s))}">${n[s]} ${STATUS_ICON[s]}</span>`).join("");
  const rows = checks.filter((c) => c.status !== "pass" || (c.action && c.area !== "files")).map((c) => {
    const text = `<span class="step-check-icon ${c.status}" aria-label="${esc(L(labels, c.status))}">${STATUS_ICON[c.status]}</span> ${esc(c.label)}${c.detail ? ` <span class="step-check-detail">${esc(c.detail)}</span>` : ""}`;
    return c.action
      ? `<li><button class="step-check ${c.status}" data-step-check="${esc(c.id)}" title="${esc(c.action.title)}">${text}</button></li>`
      : `<li class="step-check ${c.status}">${text}</li>`;
  }).join("");
  return `<div class="step-checks"><div class="step-chips">${chips}</div>${rows ? `<ul>${rows}</ul>` : ""}</div>`;
}

/** "Project checks" (unmapped checks) and the readiness links, as the last step. */
export function projectChecksHtml(checks: readonly StepCheck[], labels: StepBarLabels, links: readonly { command: string; label: string }[] = []): string {
  if (!checks.length && !links.length) return "";
  const ls = links.map((l) => `<button class="step-link" data-step-link="${esc(l.command)}">${esc(l.label)}</button>`).join("");
  return `<section class="step-project"><h4>${esc(L(labels, "projectChecks"))}</h4>${stepChecksHtml(checks, labels)}${ls ? `<div class="step-links">${ls}</div>` : ""}</section>`;
}

/** TOUR2's list with each step's checks right after its button. */
export function injectStepChecks(inner: string, byStep: readonly (readonly StepCheck[])[], labels: StepBarLabels): string {
  return inner.replace(/(<button data-tour-step="(\d+)"[^>]*>[\s\S]*?<\/button>)/g, (all, _b: string, i: string) => all + stepChecksHtml(byStep[Number(i)] ?? [], labels));
}

/** Steps of the default journey while no tour runs: a click starts that tour at the step (or goes there, for "Explore"). */
export interface DefaultSteps {
  readonly title: string;
  /** Set for a TOUR2 tour (click = start it at the step); absent for the built-in "Explore the project". */
  readonly tourId?: string;
  readonly steps: readonly { label: string; checks: readonly StepCheck[] }[];
}

export function defaultStepsHtml(d: DefaultSteps, labels: StepBarLabels): string {
  const items = d.steps.map((s, i) => {
    const attr = d.tourId !== undefined ? `data-step-start="${i}" data-step-tour="${esc(d.tourId)}"` : `data-step-go="${i}"`;
    return `<li class="tour-step"><button ${attr}><span class="tour-n">${i + 1}</span> ${esc(s.label)}</button>${stepChecksHtml(s.checks, labels)}</li>`;
  }).join("");
  return `<div class="step-default"><h4>${esc(d.title)}</h4><ol class="tour-steps">${items}</ol></div>`;
}

/** Replace NAVTOUR1's "No tour yet" line by the default steps; else put them first in the section. */
export function withDefaultSteps(inner: string, noneText: string, html: string): string {
  const none = `<p class="tour-none">${esc(noneText)}</p>`;
  if (inner.includes(none)) return inner.replace(none, html);
  return inner.replace(/(<section class="tours"[^>]*>)/, `$1${html}`);
}

/** Append "Project checks" at the end of the Tours section. */
export function withProjectChecks(inner: string, html: string): string {
  if (!html) return inner;
  const at = inner.lastIndexOf("</section>");
  return at < 0 ? inner + html : inner.slice(0, at) + html + inner.slice(at);
}

export type StepBarMessage =
  | { type: "step-check"; id: string }
  | { type: "step-start"; tourId: string; index: number }
  | { type: "step-go"; index: number }
  | { type: "step-link"; command: string };

export function parseStepBarMessage(raw: unknown): StepBarMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const n = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000;
  const s = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  switch (m.type) {
    case "step-check": return s(m.id, 600) ? { type: "step-check", id: m.id as string } : null;
    case "step-start": return s(m.tourId, 128) && n(m.index) ? { type: "step-start", tourId: m.tourId as string, index: m.index as number } : null;
    case "step-go": return n(m.index) ? { type: "step-go", index: m.index as number } : null;
    case "step-link": return s(m.command, 128) && /^datapass\.[\w.]+$/.test(m.command as string) ? { type: "step-link", command: m.command as string } : null;
    default: return null;
  }
}

/** The bar's own clicks (included after `toursScript` and `guidedScript`, same nonce). */
export function stepBarScript(api: string): string {
  return `(() => {
  const slot = document.getElementById("tours"); if (!slot) return;
  slot.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.stepCheck !== undefined) ${api}.postMessage({ type: "step-check", id: d.stepCheck });
    else if (d.stepStart !== undefined) ${api}.postMessage({ type: "step-start", tourId: d.stepTour, index: Number(d.stepStart) });
    else if (d.stepGo !== undefined) ${api}.postMessage({ type: "step-go", index: Number(d.stepGo) });
    else if (d.stepLink !== undefined) ${api}.postMessage({ type: "step-link", command: d.stepLink });
  });
})();`;
}

const CSS = `body{padding:0 8px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground)}
button{background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:2px 4px}
button:hover{background:var(--vscode-list-hoverBackground)}button:disabled{opacity:.5;cursor:default}
h3,h4{margin:8px 0 4px;font-weight:600}ol.tour-steps{padding-left:0;list-style:none;margin:0}
.tour-step.current>button{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.tour-n{opacity:.7}.tour-badge{font-size:.85em;opacity:.8}.tour-text{padding:4px 8px;opacity:.9}
.tour-jump{width:100%;box-sizing:border-box;margin:4px 0}
.step-checks{margin:0 0 4px 18px}.step-checks ul{list-style:none;padding:0;margin:0}
.step-chip{font-size:.85em;margin-right:6px}.step-chip.fail,.step-check-icon.fail{color:var(--vscode-problemsErrorIcon-foreground)}
.step-chip.hole,.step-check-icon.hole{color:var(--vscode-problemsWarningIcon-foreground)}
.step-chip.pass,.step-check-icon.pass{color:var(--vscode-testing-iconPassed)}
.step-chip.not-checked,.step-check-icon.not-checked{opacity:.7}.step-check-detail{opacity:.7;font-size:.9em}
.guided-modes,.guided-head,.guided-edit,.tour-nav,.tour-journeys,.tour-list,.step-links{display:flex;flex-wrap:wrap;gap:4px}
.guided-mode.active,.tour-journey.active,.tour-pick.active{text-decoration:underline}`;

/** The Steps view page: one `#tours` slot and the three scripts under one nonce. */
export function stepBarPage(cspSource: string, nonce: string, scripts: readonly string[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">${CSS}</style></head>`
    + `<body><div id="tours"></div><script nonce="${nonce}">const vscodeApi = acquireVsCodeApi();\n${scripts.join("\n")}\nvscodeApi.postMessage({ type: "steps-ready" });</script></body></html>`;
}
