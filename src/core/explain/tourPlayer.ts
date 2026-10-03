/**
 * V5 TOURSHARE1: a read-only tour player inside the EXPLAIN1 explainer page. One saved `datapass.tour/1` tour
 * (go/TOUR-PEDA-contract.md) becomes: a tour panel (ordered steps), one explanation box per step placed in the
 * section that shows the step's box, Previous / Next links, and the matching box highlighted. The page keeps
 * EXPLAIN1's rules: no script (CSP), no remote URL. Stepping is plain `#fragment` links; the box shows on
 * `:target` and the highlight uses `:has()` (a browser without it still shows the box, only the outline is lost).
 * A step whose Location is not in the export (unknown node, or left out for this audience) is a typed hole that
 * names neither the box nor its text, so a confidential name never reaches the page through a tour.
 * AI-proposed steps keep their `ai-proposed` badge. Pure.
 */
import { escapeHtml } from "../../webview/views/headless";
import { label, type Labels, type VNode } from "../../webview/views/model";
import type { NavLocation } from "../navigation/navTypes";
import { flattenSteps } from "../navigation/tours/store";
import type { Tour, TourStep, TourStepOrigin } from "../navigation/tours/tourTypes";

/** One step as the page shows it (explanation already resolved by the host). */
export interface PlayerStep {
  readonly number: string;
  readonly label: string;
  readonly location: NavLocation;
  readonly viewId: string;
  readonly origin: TourStepOrigin;
  /** Resolved explanation; undefined = typed hole "explanation not found". */
  readonly text?: string;
  readonly optional?: boolean;
}
export interface PlayerTour { readonly id: string; readonly title: string; readonly steps: readonly PlayerStep[] }

export interface PlayerContext {
  readonly title: string;
  readonly label: (l: NavLocation) => string;
  readonly explain: (ref: string, step: TourStep) => string | undefined;
}

/** A tour (sub-steps flattened in reading order) with its words resolved. */
export function playerTour(tour: Tour, ctx: PlayerContext): PlayerTour {
  return {
    id: tour.id, title: ctx.title,
    steps: flattenSteps(tour.steps).map(({ step, number }) => {
      const text = ctx.explain(step.explanationRef, step);
      return { number, label: ctx.label(step.location), location: step.location, viewId: step.viewId, origin: step.origin,
        ...(text ? { text } : {}), ...(step.optional ? { optional: true } : {}) };
    })
  };
}

/** Player words; the export's labels (`datapass.explain.labels`) override them key by key. */
export const TOUR_PLAYER_LABELS: Readonly<Record<string, string>> = {
  "tour.heading": "Guided tour",
  "tour.start": "Start the tour",
  "tour.step": "Step",
  "tour.of": "of",
  "tour.previous": "Previous",
  "tour.next": "Next",
  "tour.back": "Back to the tour",
  "tour.optional": "optional",
  "tour.howto": "Follow the steps: each one opens its explanation next to the part of the page it is about.",
  "tour.hole.unknown-location": "box missing: this step points to something that is not in this export",
  "tour.hole.no-explanation": "explanation not found",
  "origin.ai-proposed": "AI-proposed"
};

/** Where a step landed: in a section (with or without a highlighted box), on the panel, or a hole. */
export type StepPlacement =
  | { readonly kind: "section"; readonly sectionId: string; readonly highlighted: number }
  | { readonly kind: "page" }
  | { readonly kind: "hole"; readonly hole: "unknown-location" };

export interface RenderedSection { readonly id: string; readonly body: VNode }

export interface PlayerParts {
  /** The tour panel (ordered steps, start link, the boxes of page-level and hole steps). */
  readonly panel: string;
  /** Explanation boxes to insert at the top of each section, by section id. */
  readonly boxes: ReadonlyMap<string, string>;
  /** Section bodies with the highlight classes of their steps' boxes (sections without steps are unchanged). */
  readonly bodies: ReadonlyMap<string, VNode>;
  readonly css: string;
  readonly placements: readonly StepPlacement[];
  readonly origins: readonly string[];
}

const NODE_ID = "data-node-id";

function hasNode(n: VNode, id: string): boolean {
  return n.attrs?.[NODE_ID] === id || (n.children ?? []).some(c => hasNode(c, id));
}
function countNode(n: VNode, id: string): number {
  return (n.attrs?.[NODE_ID] === id ? 1 : 0) + (n.children ?? []).reduce((s, c) => s + countNode(c, id), 0);
}
/** Copy of `n` where every node carrying a marked id gets the classes for it. */
function mark(n: VNode, classes: ReadonlyMap<string, readonly string[]>): VNode {
  const id = n.attrs?.[NODE_ID];
  const add = id !== undefined ? classes.get(id) : undefined;
  const kids = n.children?.map(c => mark(c, classes));
  return { ...n, ...(add ? { cls: [n.cls, ...add].filter(Boolean).join(" ") } : {}), ...(kids ? { children: kids } : {}) };
}

/** Section a step belongs to: the section named like its view when it shows the box, else the first that shows it. */
export function placeStep(step: Pick<PlayerStep, "location" | "viewId">, sections: readonly RenderedSection[]): StepPlacement {
  if (step.location.level === "project") {
    const s = sections.find(x => x.id === step.viewId);
    return s ? { kind: "section", sectionId: s.id, highlighted: 0 } : { kind: "page" };
  }
  const shown = sections.filter(s => hasNode(s.body, step.location.nodeId));
  const s = shown.find(x => x.id === step.viewId) ?? shown[0];
  return s ? { kind: "section", sectionId: s.id, highlighted: countNode(s.body, step.location.nodeId) } : { kind: "hole", hole: "unknown-location" };
}

export function tourPlayerParts(tour: PlayerTour, sections: readonly RenderedSection[], labels: Labels): PlayerParts {
  const L = (k: string) => escapeHtml(labels[k] ?? TOUR_PLAYER_LABELS[k] ?? label(labels, k));
  const total = tour.steps.length;
  const anchor = (i: number) => `xp-ts-${i + 1}`;
  const placements = tour.steps.map(s => placeStep(s, sections));
  const badge = (o: string) => o === "ai-proposed" ? ` <span class="nv-origin nv-origin-ai-proposed">${L("origin.ai-proposed")}</span>` : "";
  const hole = (kind: string) => `<p class="nv-hole xp-tour-hole" role="note" data-hole-kind="${escapeHtml(kind)}">${L(`tour.hole.${kind}`)}</p>`;

  const box = (s: PlayerStep, i: number, p: StepPlacement): string => {
    const isHole = p.kind === "hole";
    const nav = [
      i > 0 ? `<a class="xp-tour-prev" href="#${anchor(i - 1)}">← ${L("tour.previous")}</a>` : `<span class="xp-tour-prev nv-muted" aria-disabled="true">← ${L("tour.previous")}</span>`,
      `<a class="xp-tour-back" href="#xp-tour">${L("tour.back")}</a>`,
      i < total - 1 ? `<a class="xp-tour-next" href="#${anchor(i + 1)}">${L("tour.next")} →</a>` : `<span class="xp-tour-next nv-muted" aria-disabled="true">${L("tour.next")} →</span>`
    ].join("");
    const head = `<p class="xp-step-head">${L("tour.step")} ${escapeHtml(s.number)} · ${i + 1} ${L("tour.of")} ${total}${
      isHole ? "" : ` — <strong>${escapeHtml(s.label)}</strong>`}${s.optional ? ` <span class="nv-muted">(${L("tour.optional")})</span>` : ""}${badge(s.origin)}</p>`;
    const body = isHole ? hole(p.hole) : s.text !== undefined ? `<p class="xp-step-text">${escapeHtml(s.text)}</p>` : hole("no-explanation");
    return `<aside class="xp-step" id="${anchor(i)}" aria-label="${L("tour.step")} ${escapeHtml(s.number)}">${head}${body}<nav class="xp-step-nav">${nav}</nav></aside>`;
  };

  const boxes = new Map<string, string>();
  const marks = new Map<string, Map<string, string[]>>();
  const pageBoxes: string[] = [];
  tour.steps.forEach((s, i) => {
    const p = placements[i]!;
    const html = box(s, i, p);
    if (p.kind !== "section") { pageBoxes.push(html); return; }
    boxes.set(p.sectionId, (boxes.get(p.sectionId) ?? "") + html);
    if (p.highlighted) {
      const m = marks.get(p.sectionId) ?? new Map<string, string[]>();
      m.set(s.location.nodeId, [...(m.get(s.location.nodeId) ?? []), `xp-hl-${i + 1}`]);
      marks.set(p.sectionId, m);
    }
  });
  const bodies = new Map<string, VNode>();
  for (const s of sections) { const m = marks.get(s.id); if (m) bodies.set(s.id, mark(s.body, m)); }

  const items = tour.steps.map((s, i) => {
    const p = placements[i]!;
    const what = p.kind === "hole" ? hole(p.hole) : escapeHtml(s.label);
    return `<li><a href="#${anchor(i)}">${L("tour.step")} ${escapeHtml(s.number)}</a> ${what}${badge(s.origin)}</li>`;
  }).join("");
  const panel = `<section class="xp-tours" id="xp-tour" aria-label="${L("tour.heading")}"><h2>${L("tour.heading")}: ${escapeHtml(tour.title)}</h2>${
    total ? `<p class="nv-muted">${L("tour.howto")}</p><p><a class="xp-tour-start" href="#${anchor(0)}">${L("tour.start")} →</a></p><ol class="xp-tour-steps">${items}</ol>` : ""}${pageBoxes.join("")}</section>`;

  // Only numeric, generated ids reach the CSS: no tour text is ever part of a selector.
  const highlight = tour.steps.map((_, i) => placements[i]!.kind === "section" && (placements[i] as { highlighted: number }).highlighted
    ? `.xp:has(#${anchor(i)}:target) .xp-hl-${i + 1}` : "").filter(Boolean);
  const css = `
  .xp-step { display: none; margin: 8px 0; padding: 8px 12px; border: 1px solid var(--nv-focus); border-left-width: 4px; border-radius: 4px; background: var(--xp-bg); scroll-margin-top: 56px; }
  .xp-step:target { display: block; }
  .xp-step-head { margin: 0 0 4px; } .xp-step-text { margin: 0 0 6px; white-space: pre-wrap; }
  .xp-step-nav { display: flex; gap: 16px; } .xp-step-nav a { color: var(--nv-focus); }
  .xp-tour-steps a, .xp-tour-start { color: var(--nv-focus); }
  .xp-tour-hole { display: inline; margin: 0; }
  .xp-section:has(> .xp-step:target) { outline: 2px dashed var(--nv-focus); outline-offset: 4px; }
  ${highlight.length ? `${highlight.join(",\n  ")} { outline: 3px solid var(--nv-focus); outline-offset: 2px; }` : ""}
  @media print { .xp-step { display: none !important; } }
  `;
  const origins = [...new Set(tour.steps.map(s => s.origin))];
  return { panel, boxes, bodies, css, placements, origins };
}
