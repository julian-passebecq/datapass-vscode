/**
 * V4-NAV `code-steps` layout kind (NAVREN4) in the nav renderer, self-registered (NAVWIRE1: out/gen/layouts.ts).
 * A binding provider puts a `CodeStepsInput` in `steps`; the host side attaches the PQSAMP1 samples before
 * sending (`bindCodeStepsSamples(...).input`). Same model as `drawCodeSteps` (`codeStepsModel`), drawn as a
 * node tree: each step selects itself (`{type:"select", nodeId}`), the step at the location is marked
 * selected, and each step shows its sample slot (a small table with its origin, or a hole).
 */
import { holesNode, label, type BindingData, type Hole, type LayoutEntry, type LayoutModel, type VNode } from "../model";
import { codeStepsModel, DEFAULT_CODE_STEPS_LABELS, type CodeStepRow, type CodeStepsInput, type CodeStepSampleView, type CodeStepsLabels } from "./codeSteps";

const obj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);
const arr = (x: unknown): x is unknown[] => Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";

function isSample(x: unknown): boolean {
  if (!obj(x)) return false;
  if (x.state === "hole") return str(x.reason);
  return x.state === "sample" && str(x.origin) && arr(x.columns) && x.columns.every(str) && arr(x.rows) && x.rows.every(arr);
}

/** Untrusted `steps` payload → a `CodeStepsInput`, or false (the view then shows a `steps-invalid` hole). */
export function isCodeStepsInput(x: unknown): x is CodeStepsInput {
  return obj(x) && arr(x.steps) && arr(x.holes) && str(x.origin) && x.holes.every(h => obj(h) && str(h.reason))
    && x.steps.every(s => obj(s) && str(s.id) && str(s.kind) && str(s.label) && str(s.origin)
      && arr(s.tables) && s.tables.every(t => obj(t) && str(t.id) && str(t.role))
      && arr(s.params) && s.params.every(p => obj(p) && str(p.name) && str(p.value) && str(p.origin))
      && (s.sample === undefined || isSample(s.sample)));
}

function badge(origin: string, ai: boolean): VNode {
  return { tag: "span", cls: ai ? "dp-origin dp-origin-ai" : "dp-origin", text: origin };
}

function sampleNode(s: CodeStepSampleView, labels: CodeStepsLabels): VNode {
  if (s.kind === "hole") return { tag: "div", cls: "dp-step-sample dp-sample-hole", attrs: { role: "note", "aria-label": labels.sample }, text: s.reason };
  return { tag: "div", cls: "dp-step-sample", attrs: { "aria-label": labels.sample }, children: [
    { tag: "div", cls: "dp-sample-caption", children: [{ tag: "span", text: s.caption }, badge(s.origin, s.aiProposed)] },
    { tag: "table", cls: "dp-sample-table", children: [
      { tag: "thead", children: [{ tag: "tr", children: s.columns.map(c => ({ tag: "th", text: c, attrs: { scope: "col" } })) }] },
      { tag: "tbody", children: s.rows.map(r => ({ tag: "tr", children: r.map(c => ({ tag: "td", text: c })) })) }] },
    ...(s.more ? [{ tag: "p", cls: "dp-sample-more", text: s.more }] : [])] };
}

function stepNode(r: CodeStepRow, showNotes: boolean, labels: CodeStepsLabels): VNode {
  const head: VNode = { tag: "div", cls: "dp-step-head", children: [
    { tag: "span", cls: "dp-step-index", text: String(r.index) },
    { tag: "span", cls: `codicon codicon-${r.icon} dp-step-icon`, attrs: { title: r.kindLabel, "aria-label": r.kindLabel } },
    { tag: "span", cls: "dp-step-label", text: r.label },
    badge(r.origin, r.aiProposed),
    ...(r.lines ? [{ tag: "span", cls: "dp-step-lines", text: `${labels.lines} ${r.lines}` }] : [])] };
  const children: VNode[] = [head];
  if (r.chips.length) children.push({ tag: "div", cls: "dp-step-tables", attrs: { "aria-label": labels.tables }, children: r.chips.map(c => ({
    tag: "span", cls: "dp-chip", text: c.id, attrs: { title: `${c.role} ${c.id}`, style: `border-color:${c.color};--dp-chip-color:${c.color}` } })) });
  if (r.params.length) children.push({ tag: "dl", cls: "dp-step-params", attrs: { "aria-label": labels.params }, children: r.params.flatMap(p => [
    { tag: "dt", text: p.name }, { tag: "dd", children: [{ tag: "span", text: p.value }, badge(p.origin, false)] }]) });
  if (showNotes && r.note) children.push({ tag: "p", cls: "dp-step-note", attrs: { "aria-label": labels.note }, children: [{ tag: "span", text: r.note.text }, badge(r.note.origin, r.note.aiProposed)] });
  children.push(sampleNode(r.sample, labels));
  return { tag: "li", cls: "dp-step nv-selectable", attrs: { role: "option", "aria-selected": String(r.selected), tabindex: "0", "data-node-id": r.id },
    on: { action: "select", nodeId: r.id }, children };
}

export const codeStepsLayoutModel: LayoutModel = ({ view, data, labels, location }) => {
  const steps = DEFAULT_CODE_STEPS_LABELS;
  const holes: Hole[] = [];
  const blocks: VNode[] = [];
  for (const d of data) {
    if (d.steps === undefined) continue;
    if (!isCodeStepsInput(d.steps)) { holes.push({ kind: "steps-invalid", reason: label(labels, "steps.invalid"), field: d.source }); continue; }
    const m = codeStepsModel(d.steps, { labels: steps, selected: location.nodeId });
    blocks.push(m.empty
      ? { tag: "p", cls: "dp-empty", text: m.empty }
      : { tag: "ol", cls: "dp-steps", attrs: { role: "listbox", "aria-label": m.title ?? view.title }, children: [
        ...m.rows.map(r => stepNode(r, m.showNotes, steps)),
        ...m.holes.map(h => ({ tag: "li", cls: "dp-hole", text: h }))] });
  }
  const all = holesNode([...data, { source: "code-steps", origin: "static", holes } satisfies BindingData], labels);
  const body: VNode = blocks.length ? { tag: "div", cls: "dp-code-steps", children: blocks } : { tag: "p", cls: "nv-empty", text: label(labels, "view.noSteps") };
  return { tag: "div", cls: "nv-layout nv-layout-code-steps", children: all ? [body, all] : [body] };
};

export default { kind: "code-steps", model: codeStepsLayoutModel } satisfies LayoutEntry;
