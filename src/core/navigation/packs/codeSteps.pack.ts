/**
 * V5HOLE1 view pack: a "Code steps" view on every artifact (Power Query, SQL, PySpark… files with a Hop
 * explanation), bound to `hop-steps`. The view-spi catalog offers code-steps only on Spark artifacts and
 * below the artifact level; a file without an explanation shows a typed hole. The id is the catalog's Spark
 * "steps" id on purpose: a kind with its own Steps view keeps it and gets no duplicate (resolveViews skips a
 * `*` view whose id is already offered).
 */
import type { PackEntry } from "../viewPacks";

export const CODE_STEPS_PACK: readonly PackEntry[] = [
  { artifactKind: "*", level: "artifact", views: [{ id: "steps", title: "Code steps", layout: "code-steps", bindings: [{ source: "hop-steps" }] }] }
];

export default CODE_STEPS_PACK;
