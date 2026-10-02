/** V5HOLE1 `hop-steps` binding (code-steps payload from the Hop explanation), self-registered (NAVWIRE1: out/gen/bindings.ts). */
import type { BindingProvider } from "./index";
import { CODE_STEPS_SOURCE, provideCodeSteps } from "./codeSteps";

export const codeStepsProvider: BindingProvider = { source: CODE_STEPS_SOURCE, provide: provideCodeSteps };

export default codeStepsProvider;
