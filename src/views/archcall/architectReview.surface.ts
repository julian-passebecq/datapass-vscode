/** ARCHCALL1 surface: architect review through the AI exchange (offer() is the seam for the three triggers). */
import type { NavSurface } from "../../core/navigation/register";
import { registerArchitectReview } from "./architectReview";

export default ((context, host) => { registerArchitectReview(context, host.session); }) satisfies NavSurface;
