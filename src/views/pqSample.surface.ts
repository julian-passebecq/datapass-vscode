/** V5 PQSAMP1 surface: `datapass.codeSteps.sampleStep` and its sample store (self-registered, NAVWIRE1). */
import type { NavSurface } from "../core/navigation/register";
import { registerPqSample } from "./pqSampleHost";

export default registerPqSample satisfies NavSurface;
