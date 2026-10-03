/**
 * V5 PEDA2: the part of `datapass.tour/1` (go/TOUR-PEDA-contract.md § 1) the built-in interview / learning /
 * whole-picture tours use. STUB until TOUR2 (!244, `src/core/navigation/tours/tourTypes.ts`, the ONE standalone
 * re-export) is on main: then this file only re-exports from there. Structurally identical, so the tours built here
 * validate unchanged. Pure (no `vscode`).
 */
import type { NavLocation } from "../navigation/navTypes";

export type TourStepOrigin = "datapass-guidance" | "ai-proposed" | "user";
export type TourMode = "learning" | "interview" | "general";
export interface TourGeneration { readonly include?: readonly string[]; readonly exclude?: readonly string[] }
export interface TourStep {
  readonly id?: string;
  readonly location: NavLocation;
  readonly viewId: string;
  readonly explanationRef: string;
  readonly origin: TourStepOrigin;
  readonly section?: string;
  readonly optional?: boolean;
  readonly substeps?: readonly TourStep[];
}
export interface Tour {
  readonly id: string; readonly titleRef: string; readonly audience?: string; readonly mode?: TourMode;
  readonly journey?: string; readonly generation?: TourGeneration; readonly steps: readonly TourStep[];
}
export interface TourDocument { readonly schema: "datapass.tour/1"; readonly tours: readonly Tour[]; readonly texts?: Readonly<Record<string, string>> }

export const TOUR_SCHEMA = "datapass.tour/1"; // STUB until TOUR2
export const WHOLE_PICTURE_STEP_IDS = ["arrive", "live", "change", "run", "trust"] as const; // STUB until TOUR2
export type WholePictureStepId = typeof WHOLE_PICTURE_STEP_IDS[number];
/** TOUR_LIMITS.depth of view-spi `tour.ts` (TOURSPI1). */
export const TOUR_MAX_DEPTH = 4; // STUB until TOUR2
