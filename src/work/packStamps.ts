/**
 * 0.27 (P1, D-23): the stamp of the pack or work order being built now — the selected variant, the
 * environment and the bridge revision (HEAD of the coordination repository). See core/exchange/stamp.
 */
import type { PackStamp } from "../core/exchange/stamp";
import type { WorkSession } from "./session";

/** Variant and environment only (synchronous): what the launch confirmation compares. */
export const selectionStamp = (session: WorkSession): PackStamp => session.selectionStamp();

/** The full stamp, with the bridge revision: what packs and orders record, and what staleness compares. */
export const packStamp = (session: WorkSession): Promise<PackStamp> => session.packStamp();
