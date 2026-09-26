/**
 * 0.25 (package V-A): the selected variant — the architecture a person previews right now, on this
 * machine, per project. It is a preview only: not a decision (Record decision), not a test (a native
 * check on a declared environment) and never an activation (switching the live route is operational,
 * outside DataPass). Internal names keep "active variant" (the global-state key is unchanged). It is the architecture preview made persistent: the tree, Details, the
 * diagram, the Workbench and the packs for an AI all follow it, and it is chosen in 1–2 clicks from
 * the status bar or the Options view.
 *
 * Machine-local by design: it lives in VS Code's global state (keyed by project id), never in a
 * repository. The committed choice stays *Record decision* in options.json.
 *
 * Pure: the stored entry and the options file in, what to show out.
 */
import { CODING_LABELS, codingOfPicks, type CodingState, type VariantsAnalysis } from "./variants";
import { picksFrom, type OptionsFile } from "./options";

/** Global-state key (one map for every project on this machine). */
export const ACTIVE_VARIANT_KEY = "datapass.v25.activeVariant";
/** Projects remembered at most (the oldest entries go first). */
export const MAX_REMEMBERED_PROJECTS = 100;

/** What is remembered for a project: a scenario ("decided" or a declared one) or a list of picks. */
export interface ActiveVariantEntry { scenario?: string; picks?: string[]; at: string }
export type ActiveVariantStore = Record<string, ActiveVariantEntry>;

/** The same shape as the session's preview request. */
export interface VariantRequest { scenario?: string; picks?: string[] }

const PICK = /^[A-Za-z0-9._-]{1,64}=[A-Za-z0-9._-]{1,64}$/;
const ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Whatever global state holds, as a valid store (anything malformed is dropped). */
export function readStore(raw: unknown): ActiveVariantStore {
  const out: ActiveVariantStore = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key.length > 200 || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const scenario = typeof e.scenario === "string" && ID.test(e.scenario) ? e.scenario : undefined;
    const picks = Array.isArray(e.picks) ? e.picks.filter((p): p is string => typeof p === "string" && PICK.test(p)).slice(0, 50) : undefined;
    if (!scenario && !picks?.length) continue;
    out[key] = { ...(scenario ? { scenario } : { picks }), at: typeof e.at === "string" ? e.at : "" };
  }
  return out;
}

/** The store with this project's entry set (or removed for the current architecture). Never mutates. */
export function withEntry(store: ActiveVariantStore, projectKey: string, req: VariantRequest | undefined, now: string): ActiveVariantStore {
  const next: ActiveVariantStore = { ...store };
  delete next[projectKey];
  const scenario = req?.scenario && req.scenario !== "current" ? req.scenario : undefined;
  const picks = !scenario ? (req?.picks ?? []).filter(p => PICK.test(p)).slice(0, 50) : [];
  if (scenario || picks.length) next[projectKey] = { ...(scenario ? { scenario } : { picks }), at: now };
  const keys = Object.keys(next);
  if (keys.length > MAX_REMEMBERED_PROJECTS) {
    for (const k of keys.sort((a, b) => (next[a]!.at).localeCompare(next[b]!.at)).slice(0, keys.length - MAX_REMEMBERED_PROJECTS)) delete next[k];
  }
  return next;
}

export const sameRequest = (a: VariantRequest | undefined, b: VariantRequest | undefined): boolean =>
  (a?.scenario ?? "") === (b?.scenario ?? "") && (a?.picks ?? []).join(",") === (b?.picks ?? []).join(",");

export interface ResolvedVariant {
  /** What the session previews; undefined = the current architecture (graph.json). */
  request?: VariantRequest;
  /** Set when the remembered variant no longer exists and DataPass went back to the current architecture. */
  fellBack?: string;
}

/** The remembered entry checked against today's options.json: a vanished scenario or option falls back to "current". */
export function resolveActiveVariant(options: OptionsFile | undefined, entry: ActiveVariantEntry | VariantRequest | undefined): ResolvedVariant {
  if (!entry || (!entry.scenario && !entry.picks?.length) || entry.scenario === "current") return {};
  if (!options) return { fellBack: "the project has no options.json any more" };
  if (entry.scenario === "decided") {
    return options.decisions.some(d => d.chosen && d.chosen !== d.current)
      ? { request: { scenario: "decided" } }
      : { fellBack: "no decision is waiting to be applied any more" };
  }
  if (entry.scenario) {
    return options.scenarios?.some(s => s.id === entry.scenario)
      ? { request: { scenario: entry.scenario } }
      : { fellBack: `the scenario "${entry.scenario}" is no longer in options.json` };
  }
  const valid = (entry.picks ?? []).filter(p => {
    const [d, o] = p.split("=");
    return options.decisions.some(x => x.id === d && x.options.some(y => y.id === o));
  });
  if (!valid.length) return { fellBack: "its options are no longer in options.json" };
  return { request: { picks: valid } };
}

export interface VariantChoice {
  /** "current", "decided", a declared scenario id. */
  id: string;
  label: string;
  description: string;
  detail?: string;
  active: boolean;
  request?: VariantRequest;
}

/** What the switcher lists: the current architecture, the decided one (when there is one), every declared scenario. */
export function variantChoices(options: OptionsFile, analysis: VariantsAnalysis | undefined, active: VariantRequest | undefined): VariantChoice[] {
  const coding = (id: string) => analysis?.scenarios.find(s => s.id === id);
  const state = (id: string) => { const c = coding(id); return c ? CODING_LABELS[c.state] : ""; };
  const out: VariantChoice[] = [{
    id: "current", label: "Current architecture (graph.json)", description: state("current"),
    detail: "What graph.json describes today", active: !active?.scenario && !active?.picks?.length
  }];
  if (options.decisions.some(d => d.chosen && d.chosen !== d.current)) {
    out.push({ id: "decided", label: "Decided (to apply)", description: state("decided"), detail: "Every recorded decision, not applied yet", active: active?.scenario === "decided", request: { scenario: "decided" } });
  }
  for (const s of options.scenarios ?? []) {
    out.push({
      id: s.id, label: s.title, description: [state(s.id), s.recommended ? "recommended" : ""].filter(Boolean).join(" · "),
      detail: s.description, active: active?.scenario === s.id, request: { scenario: s.id }
    });
  }
  return out;
}

export interface ActiveVariantView { title: string; state?: CodingState; reason?: string }

/** The active variant's title and coding state, from the session's preview. */
export function activeVariantView(options: OptionsFile | undefined, analysis: VariantsAnalysis | undefined, preview: { title: string; picks: ReadonlyMap<string, string> } | undefined): ActiveVariantView {
  if (!preview || !options) {
    const c = analysis?.scenarios.find(s => s.kind === "current");
    return { title: "Current architecture", state: c?.state, reason: c?.reason };
  }
  const c = analysis ? codingOfPicks(options, analysis, preview.picks) : undefined;
  return { title: preview.title, state: c?.state, reason: c?.reason };
}

/** One line for the packs an AI reads (Copy Context for My AI, options, work orders). */
export function activeVariantLine(v: ActiveVariantView): string {
  const files = v.state ? ` · files: ${CODING_LABELS[v.state]}${v.reason ? ` (${v.reason})` : ""}` : "";
  return `Selected variant (preview on this machine — not a decision, not a deployment): **${v.title}**${files}. Live route: not observed by DataPass. The committed architecture is graph.json; recorded decisions are in options.json.`;
}

/** The status-bar text: short, with the coding state. */
export function statusBarText(v: ActiveVariantView): string {
  return `$(versions) Variant: ${v.title.length > 40 ? `${v.title.slice(0, 39)}…` : v.title} · preview`;
}

/** Picks as "decision=option" for the options the active variant changes (for a header or a test). */
export function changedPicks(options: OptionsFile, req: VariantRequest | undefined): string[] {
  if (!req) return [];
  const picks = req.scenario ? undefined : picksFrom(options, req.picks ?? []);
  const scen = req.scenario ? options.scenarios?.find(s => s.id === req.scenario) : undefined;
  const map = picks ?? (scen ? picksFrom(options, scen.picks) : req.scenario === "decided" ? new Map(options.decisions.map(d => [d.id, d.chosen ?? d.current])) : new Map<string, string>());
  return options.decisions.filter(d => map.get(d.id) && map.get(d.id) !== d.current).map(d => `${d.id}=${map.get(d.id)}`);
}
