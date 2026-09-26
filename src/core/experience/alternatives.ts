/**
 * 0.22 modes: the "alternatives exist" marker. Standard hides the Options section; instead each
 * component an options.json decision can change carries a small marker. Pure. The components a
 * decision touches are the ones the Workbench already lists for it: declared concerns plus what
 * its non-current options remove or replace. DataPass gives no verdict here (D-05).
 */
import type { OptionsFile } from "../project/options";

/** Component id → titles of the decisions that can change it. */
export function alternativesByComponent(options: OptionsFile | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of options?.decisions ?? []) {
    const ids = new Set([
      ...(d.concerns ?? []),
      ...d.options.filter(o => o.id !== d.current).flatMap(o => [...(o.changes?.remove ?? []), ...(o.changes?.replace ?? []).map(r => r.id)])
    ]);
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), d.title]);
  }
  return out;
}
