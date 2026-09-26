/**
 * 0.27 (P1, D-23): the stamp of the pack or work order being built now — the selected variant, the
 * environment and the bridge revision (HEAD of the coordination repository). See core/exchange/stamp.
 */
import type { PackStamp } from "../core/exchange/stamp";
import type { WorkSession } from "./session";
import { contextChange } from "../core/refresh/tracker";
import { UserFacingError } from "./io";

/** Variant and environment only (synchronous): what the launch confirmation compares. */
export const selectionStamp = (session: WorkSession): PackStamp => session.selectionStamp();

/** The full stamp, with the bridge revision: what packs and orders record, and what staleness compares. */
export const packStamp = (session: WorkSession): Promise<PackStamp> => session.packStamp();

/**
 * V1-FRESH (A03): capture what a pack or an order is built from now; the returned check throws when
 * the project, the selected variant, the environment, project.json or options.json changed since.
 * Call the check just before the copy or the write, so what is copied matches what was shown.
 */
export function contextGuard(session: WorkSession, what = "The pack was not copied"): () => void {
  const before = session.contextIdentity();
  return () => {
    const why = contextChange(before, session.contextIdentity());
    if (why) throw new UserFacingError(`${what}: ${why} while it was being built. Build it again for the current selection.`);
  };
}
