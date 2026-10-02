/** V4-NAV NAVAIX1 surface: the AI-written Location explanation command (AI-proposed evidence). */
import type { NavSurface } from "../register";
import { registerAiExplain } from "./aiExplainCommand";

export default ((context) => registerAiExplain(context)) satisfies NavSurface;
