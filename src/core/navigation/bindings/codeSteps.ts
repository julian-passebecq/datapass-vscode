/**
 * V5HOLE1 (V5 acceptance row 05): the `hop-steps` binding — the code-steps payload (`CodeStepsInput`) of the
 * file at the current place, built from its Hop explanation (the client AI's understanding file, already
 * validated by the loader) with `codeStepsFromHop`; PQSAMP1 adds the step samples on the host side. The
 * explanation is untrusted data: it is mapped, never executed. Pure (no `vscode`).
 */
import type { HopState } from "../../../views/hopState";
import { codeStepsFromHop } from "../../../webview/views/layouts/codeSteps";
import type { BindingContext, BindingResult } from "./index";

/** The view-spi source the `code-steps` layout binds (NAV_BINDING_SOURCES). */
export const CODE_STEPS_SOURCE = "hop-steps";

export const CODE_STEPS_UNWIRED = "Code steps need the Hop explanations, which this view host does not pass.";
export const CODE_STEPS_NO_FILE = "No Hop explanation for this place: pick a file that has one.";
/** V5HOLE15: the explanation is still being read; the view redraws when it is. */
export const CODE_STEPS_LOADING = "Loading the Hop explanation…";

/** Hop state of the file at a place → binding result. Steps carry their own holes; no steps → binding holes only. */
export function codeStepsResult(state: HopState | undefined): BindingResult {
  if (!state) return { holes: [{ reason: CODE_STEPS_NO_FILE, kind: "not-declared" }], origin: "static" };
  const input = codeStepsFromHop(state);
  if (!input.steps.length) {
    const holes = input.holes.length ? input.holes : [{ reason: CODE_STEPS_NO_FILE }];
    return { holes: holes.map(h => ({ reason: h.reason, kind: "not-declared" })), origin: input.origin };
  }
  return { steps: input, holes: [], origin: input.origin };
}

export function provideCodeSteps(ctx: BindingContext): BindingResult {
  if (!ctx.hop) return { holes: [{ reason: CODE_STEPS_UNWIRED, kind: "binding-unavailable" }], origin: "static" };
  const state = ctx.hop(ctx.location);
  if (state === "loading") return { holes: [{ reason: CODE_STEPS_LOADING, kind: "loading" }], origin: "static" };
  return codeStepsResult(state);
}
