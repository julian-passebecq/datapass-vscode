/**
 * V4-NAV NAVREN4: the `code-steps` layout kind — a Power-Query-style ordered list of a file's steps
 * (read, join, remove nulls…), each with its kind icon, label, the tables it touches as coloured chips
 * (same colour per table id as the mini-map and graph kinds) and its parameters. Selecting a step posts
 * `{type:"select", nodeId}` so the host decorates the code (NAVCODE1). An optional note column shows only
 * evidence that exists; AI text is labelled ai-proposed. It does not replace the Hop view (Hop stays a
 * `surface`).
 *
 * Pure parts (`codeStepsModel`, `codeStepsFromHop`) build a DOM-free model; `drawCodeSteps` paints it.
 * Labels, icons and origin names are data (`DEFAULT_CODE_STEPS_LABELS`), overridable by the host.
 */
import type { HopState } from "../../../views/hopState";

/** § 34 origins (the vocabulary every binding provider uses). */
export type ValueOrigin = "static" | "theoretical" | "ai-proposed" | "observed" | "illustrative" | "datapass-guidance";

export interface CodeStepParam { readonly name: string; readonly value: string; readonly origin: ValueOrigin }
export interface CodeStepInput {
  readonly id: string;
  /** Step kind id (read, join, filter…); the icon and the fallback label come from the labels data. */
  readonly kind: string;
  readonly label: string;
  readonly origin: ValueOrigin;
  /** Table / dataset ids the step reads or writes, in order; colours are looked up per id. */
  readonly tables: readonly { readonly id: string; readonly role: "in" | "out" | "join" }[];
  readonly params: readonly CodeStepParam[];
  /** Existing evidence only (an AI note, a sample summary); never invented here. */
  readonly note?: { readonly text: string; readonly origin: ValueOrigin };
  /** 1-based inclusive line range, when the step maps to code. */
  readonly lines?: readonly [number, number];
}
export interface CodeStepsInput {
  readonly title?: string;
  readonly steps: readonly CodeStepInput[];
  readonly holes: readonly { readonly reason: string }[];
  readonly origin: ValueOrigin;
}

export interface CodeStepsLabels {
  readonly empty: string;
  readonly holes: string;
  readonly tables: string;
  readonly params: string;
  readonly note: string;
  readonly lines: string;
  readonly kinds: Readonly<Record<string, { readonly label: string; readonly icon: string }>>;
  readonly origins: Readonly<Record<ValueOrigin, string>>;
  readonly roles: Readonly<Record<"in" | "out" | "join", string>>;
}

export const DEFAULT_CODE_STEPS_LABELS: CodeStepsLabels = {
  empty: "No steps for this artifact yet.",
  holes: "Not known",
  tables: "Tables",
  params: "Parameters",
  note: "Note",
  lines: "Lines",
  kinds: {
    source: { label: "Source", icon: "database" }, read: { label: "Read", icon: "arrow-down" },
    filter: { label: "Filter", icon: "filter" }, transform: { label: "Transform", icon: "symbol-operator" },
    join: { label: "Join", icon: "merge" }, aggregate: { label: "Aggregate", icon: "symbol-array" },
    write: { label: "Write", icon: "save" }, task: { label: "Task", icon: "run" },
    branch: { label: "Branch", icon: "git-branch" }, config: { label: "Configuration", icon: "settings-gear" },
    test: { label: "Test", icon: "beaker" }, other: { label: "Step", icon: "circle-small" }
  },
  origins: {
    static: "static", theoretical: "theoretical", "ai-proposed": "ai-proposed", observed: "observed",
    illustrative: "illustrative", "datapass-guidance": "DataPass guidance"
  },
  roles: { in: "reads", out: "writes", join: "joins" }
};

/** Theme-token fallback when the host passes no palette (NAVMAP1's navPalette supplies the real one). */
const FALLBACK_COLORS = [
  "var(--vscode-charts-blue)", "var(--vscode-charts-green)", "var(--vscode-charts-orange)",
  "var(--vscode-charts-purple)", "var(--vscode-charts-red)", "var(--vscode-charts-yellow)"
] as const;

export function fallbackColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!;
}

export interface CodeStepChip { readonly id: string; readonly role: string; readonly color: string }
export interface CodeStepRow {
  readonly id: string;
  readonly index: number;
  readonly icon: string;
  readonly kindLabel: string;
  readonly label: string;
  readonly origin: string;
  readonly aiProposed: boolean;
  readonly chips: readonly CodeStepChip[];
  readonly params: readonly { readonly name: string; readonly value: string; readonly origin: string }[];
  readonly note?: { readonly text: string; readonly origin: string; readonly aiProposed: boolean };
  readonly lines?: string;
  readonly selected: boolean;
}
export interface CodeStepsModel {
  readonly title?: string;
  readonly rows: readonly CodeStepRow[];
  readonly holes: readonly string[];
  /** The note column is shown only when at least one step carries evidence. */
  readonly showNotes: boolean;
  readonly empty?: string;
}

export const MAX_CODE_STEPS = 300;

export function codeStepsModel(input: CodeStepsInput, opts: { labels?: CodeStepsLabels; colorOf?: (id: string) => string; selected?: string | null } = {}): CodeStepsModel {
  const labels = opts.labels ?? DEFAULT_CODE_STEPS_LABELS;
  const colorOf = opts.colorOf ?? fallbackColor;
  const steps = input.steps.slice(0, MAX_CODE_STEPS);
  const holes = input.holes.map(h => h.reason);
  if (input.steps.length > MAX_CODE_STEPS) holes.push(`${input.steps.length - MAX_CODE_STEPS} more steps not shown`);
  const rows = steps.map((s, index): CodeStepRow => {
    const kind = labels.kinds[s.kind] ?? labels.kinds.other ?? { label: s.kind, icon: "circle-small" };
    const seen = new Set<string>();
    const chips = s.tables.filter(t => !seen.has(`${t.role}:${t.id}`) && seen.add(`${t.role}:${t.id}`))
      .map(t => ({ id: t.id, role: labels.roles[t.role], color: colorOf(t.id) }));
    return {
      id: s.id, index: index + 1, icon: kind.icon, kindLabel: kind.label, label: s.label,
      origin: labels.origins[s.origin], aiProposed: s.origin === "ai-proposed", chips,
      params: s.params.map(p => ({ name: p.name, value: p.value, origin: labels.origins[p.origin] })),
      note: s.note && s.note.text.trim() ? { text: s.note.text, origin: labels.origins[s.note.origin], aiProposed: s.note.origin === "ai-proposed" } : undefined,
      lines: s.lines ? (s.lines[0] === s.lines[1] ? `${s.lines[0]}` : `${s.lines[0]}–${s.lines[1]}`) : undefined,
      selected: opts.selected === s.id
    };
  });
  return { title: input.title, rows, holes, showNotes: rows.some(r => r.note), empty: rows.length ? undefined : labels.empty };
}

/**
 * Hop explanation → code-steps input. The explanation is written by the client AI, so its notes are
 * ai-proposed; a step's own provenance maps declared → static, inferred → ai-proposed,
 * estimated → theoretical, illustrative → illustrative.
 */
export const HOP_PROVENANCE_ORIGIN = { declared: "static", inferred: "ai-proposed", estimated: "theoretical", illustrative: "illustrative" } as const satisfies Record<string, ValueOrigin>;

export function codeStepsFromHop(state: HopState): CodeStepsInput {
  if (state.kind !== "explained" || state.state === "invalid") {
    return { title: state.title ?? state.fileName, steps: [], holes: [{ reason: state.banner?.title ?? "No explanation for this file" }], origin: "ai-proposed" };
  }
  const steps = state.steps.map((s): CodeStepInput => {
    const origin = HOP_PROVENANCE_ORIGIN[s.provenance];
    const tables: { id: string; role: "in" | "out" | "join" }[] = [
      ...s.inputs.map(id => ({ id, role: "in" as const })),
      ...s.joins.flatMap(j => [{ id: j.left, role: "join" as const }, { id: j.right, role: "join" as const }]),
      ...s.outputs.map(id => ({ id, role: "out" as const }))
    ];
    const params: CodeStepParam[] = [
      ...s.joins.map(j => ({ name: j.typeLabel, value: j.keys.map(([l, r]) => `${l} = ${r}`).join(", "), origin: HOP_PROVENANCE_ORIGIN[j.provenance] })),
      ...s.columns.map(c => ({ name: c.name, value: c.from ?? "", origin }))
    ];
    return {
      id: s.id, kind: s.kind, label: s.title, origin, tables, params, lines: s.lines,
      note: s.note ? { text: s.note, origin: "ai-proposed" } : undefined
    };
  });
  const holes = [...state.steps.filter(s => s.beyond).map(s => ({ reason: `${s.title}: lines beyond the file as it is now` })),
    ...(state.state === "stale" ? [{ reason: state.banner?.title ?? "stale" }] : [])];
  return { title: state.title ?? state.fileName, steps, holes, origin: "ai-proposed" };
}

/** Webview → host message for a selected step (validated by the host like workbench.ts). */
export type CodeStepsPost = (message: { type: "select"; nodeId: string }) => void;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function badge(doc: Document, origin: string, ai: boolean): HTMLElement {
  const b = el(doc, "span", ai ? "dp-origin dp-origin-ai" : "dp-origin", origin);
  b.title = origin;
  return b;
}

/** Paints the model into `host` (text only, no innerHTML); arrow keys move, Enter/Space/click selects. */
export function drawCodeSteps(host: HTMLElement, model: CodeStepsModel, post: CodeStepsPost, labels: CodeStepsLabels = DEFAULT_CODE_STEPS_LABELS): void {
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (model.title) host.append(el(doc, "h2", "dp-steps-title", model.title));
  if (model.holes.length) {
    const ul = el(doc, "ul", "dp-holes");
    ul.setAttribute("aria-label", labels.holes);
    for (const h of model.holes) ul.append(el(doc, "li", "dp-hole", h));
    host.append(ul);
  }
  if (model.empty) { host.append(el(doc, "p", "dp-empty", model.empty)); return; }
  const list = el(doc, "ol", "dp-steps");
  list.setAttribute("role", "listbox");
  const items: HTMLElement[] = [];
  const select = (i: number) => {
    items.forEach((it, j) => { it.setAttribute("aria-selected", String(i === j)); it.tabIndex = i === j ? 0 : -1; });
    items[i]!.focus();
    post({ type: "select", nodeId: model.rows[i]!.id });
  };
  model.rows.forEach((r, i) => {
    const li = el(doc, "li", "dp-step");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(r.selected));
    li.tabIndex = r.selected || (i === 0 && !model.rows.some(x => x.selected)) ? 0 : -1;
    li.dataset.nodeId = r.id;
    const head = el(doc, "div", "dp-step-head");
    const icon = el(doc, "span", `codicon codicon-${r.icon} dp-step-icon`);
    icon.title = r.kindLabel;
    icon.setAttribute("aria-label", r.kindLabel);
    head.append(el(doc, "span", "dp-step-index", String(r.index)), icon, el(doc, "span", "dp-step-label", r.label), badge(doc, r.origin, r.aiProposed));
    if (r.lines) head.append(el(doc, "span", "dp-step-lines", `${labels.lines} ${r.lines}`));
    li.append(head);
    if (r.chips.length) {
      const chips = el(doc, "div", "dp-step-tables");
      chips.setAttribute("aria-label", labels.tables);
      for (const c of r.chips) {
        const chip = el(doc, "span", "dp-chip", c.id);
        chip.style.borderColor = c.color;
        chip.style.setProperty("--dp-chip-color", c.color);
        chip.title = `${c.role} ${c.id}`;
        chips.append(chip);
      }
      li.append(chips);
    }
    if (r.params.length) {
      const dl = el(doc, "dl", "dp-step-params");
      dl.setAttribute("aria-label", labels.params);
      for (const p of r.params) { const dd = el(doc, "dd", undefined, p.value); dd.append(" ", badge(doc, p.origin, false)); dl.append(el(doc, "dt", undefined, p.name), dd); }
      li.append(dl);
    }
    if (model.showNotes && r.note) {
      const note = el(doc, "p", "dp-step-note", r.note.text);
      note.setAttribute("aria-label", labels.note);
      note.append(" ", badge(doc, r.note.origin, r.note.aiProposed));
      li.append(note);
    }
    li.addEventListener("click", () => select(i));
    li.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" && i + 1 < items.length) { e.preventDefault(); items[i + 1]!.focus(); }
      else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); items[i - 1]!.focus(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); }
    });
    items.push(li);
    list.append(li);
  });
  host.append(list);
}

/** Registration record for NAVREN1's `registerLayout("code-steps", …)` (one line once the registry lands). */
export const CODE_STEPS_LAYOUT = { kind: "code-steps", draw: drawCodeSteps, model: codeStepsModel } as const;
