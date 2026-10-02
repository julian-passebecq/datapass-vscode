/**
 * V4-NAV `diff-history` layout kind in the nav renderer (NAVFIX1, review M3: the catalog's "History" view drew
 * `layout-unregistered`). A revision list is rows (rev, date, author, message…), so it reuses the table model and
 * its typed holes; a row selects its revision (`{type:"select"}`). The diff opening stays NAVHIST1's host side.
 * Self-registered (out/gen/layouts.ts).
 */
import type { LayoutEntry, LayoutModel, VNode } from "../model";
import { tableModel } from "./table.layout";

export const diffHistoryModel: LayoutModel = input => {
  const t = tableModel(input);
  return { ...t, cls: "nv-layout nv-layout-diff-history" } satisfies VNode;
};

export default { kind: "diff-history", model: diffHistoryModel } satisfies LayoutEntry;
