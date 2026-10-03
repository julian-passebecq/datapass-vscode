// TL-11 guided tours (TOURSPI1, go/TOUR-PEDA-contract.md § 1): the ONE standalone re-export of `datapass.tour/1`, from the
// vendored Common view-spi (`src/tour.ts`). Callers import from here so the contract has a single entry point in DataPass.
export {
  TOUR_SCHEMA_ID,
  TOUR_STEP_ORIGINS,
  TOUR_MODES,
  TOUR_LIMITS,
  TOUR_SECTION_IDS,
  WHOLE_PICTURE_STEP_IDS,
  TOUR_REF_PATTERN,
  TOUR_HOLE_KINDS,
  TOUR_JSON_SCHEMA,
  tourDocumentSchema,
  validateTourDocument,
  checkTours,
  type TourStepOrigin,
  type TourMode,
  type TourSectionId,
  type WholePictureStepId,
  type TourHoleKind,
  type TourStep,
  type TourGeneration,
  type Tour,
  type TourDocument,
  type TourHole,
  type TourCheck,
  type TourContext
} from "@juliandatapass-group/view-spi";
