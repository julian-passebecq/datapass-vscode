/**
 * V5 PEDA2: the part of `datapass.tour/1` (go/TOUR-PEDA-contract.md § 1) the built-in interview / learning /
 * whole-picture tours use, re-exported from the ONE standalone entry point (`navigation/tours/tourTypes.ts`, vendored
 * Common view-spi). Pure (no `vscode`).
 */
import { TOUR_LIMITS, TOUR_SCHEMA_ID } from "../navigation/tours/tourTypes";

export {
  WHOLE_PICTURE_STEP_IDS,
  type Tour,
  type TourDocument,
  type TourGeneration,
  type TourMode,
  type TourStep,
  type TourStepOrigin,
  type WholePictureStepId
} from "../navigation/tours/tourTypes";

export const TOUR_SCHEMA = TOUR_SCHEMA_ID;
/** TOUR_LIMITS.depth of view-spi `tour.ts` (TOURSPI1). */
export const TOUR_MAX_DEPTH = TOUR_LIMITS.depth;
