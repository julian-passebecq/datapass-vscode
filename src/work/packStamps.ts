/**
 * 0.27 (P1, D-23): the stamp of the pack or work order being built now — the selected variant, the
 * environment and the bridge revision (HEAD of the coordination repository).
 */
import { environmentOf, variantStamp, type PackStamp } from "../core/project/packStamp";
import { gitRunner, type WorkSession } from "./session";

/** Variant and environment: synchronous, what staleness compares. */
export function selectionStamp(session: WorkSession): PackStamp {
  const environment = environmentOf(session.projectMap().environments);
  return { variant: variantStamp(session.project.options, session.preview()), ...(environment ? { environment } : {}) };
}

/** The full stamp, with the coordination repository's commit when Git knows it. */
export async function packStamp(session: WorkSession): Promise<PackStamp> {
  const stamp = selectionStamp(session);
  const root = session.root?.fsPath;
  if (!root) return stamp;
  const head = await gitRunner(["rev-parse", "--verify", "HEAD"], root, 5000);
  const commit = head.ok ? head.stdout.trim() : "";
  return /^[0-9a-f]{40}$/.test(commit) ? { ...stamp, bridge: commit } : stamp;
}
