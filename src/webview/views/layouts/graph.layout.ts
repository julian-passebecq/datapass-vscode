/** V4-NAV `graph` layout kind (NAVREN2), self-registered (NAVWIRE1: out/gen/layouts.ts). */
import type { LayoutEntry } from "../model";
import { graphModel } from "./graph";

export default { kind: "graph", model: graphModel } satisfies LayoutEntry;
