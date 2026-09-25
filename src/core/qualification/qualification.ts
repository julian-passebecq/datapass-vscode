/**
 * Qualification: what actually worked on this machine and account, per operation. Pure.
 *
 * Results are reported by the person who ran the operation in the native tool ("worked",
 * "failed", "not tried"). They are observations with a date, the DataPass version and the tool
 * versions detected at that moment — not proof, and never inferred from a "ready" preflight.
 * Stored per user (not in the repository) so one report covers every project on this machine.
 */
import { scrub } from "../exchange/aiContext";
import type { ToolObservation } from "../capabilities/tools";
import type { PreflightStatus } from "../capabilities/preflight";

export const QUALIFICATION_RESULTS = ["worked", "failed", "not-tried"] as const;
export type QualificationResult = typeof QUALIFICATION_RESULTS[number];

export interface QualificationRecord {
  capabilityId: string;
  label: string;
  result: QualificationResult;
  note?: string;
  projectId: string;
  scopeId: string;
  /** Preflight status when the result was recorded. */
  preflight: PreflightStatus;
  at: string;
  dataPassVersion: string;
  /** Tool id → version (or state) of the tools this operation depends on, at that moment. */
  tools: Record<string, string>;
}

export const MAX_NOTE = 500;

/** Keep notes short and free of local paths and credential-shaped text before storing them. */
export function cleanNote(note: string | undefined): string | undefined {
  const text = note?.replace(/\s+/g, " ").trim();
  return text ? scrub(text).slice(0, MAX_NOTE) : undefined;
}

export function toolSnapshot(toolIds: readonly string[], tools: ReadonlyMap<string, ToolObservation>): Record<string, string> {
  return Object.fromEntries(toolIds.map(id => {
    const o = tools.get(id);
    return [id, o ? (o.state === "present" ? o.version?.trim() || "present" : o.state) : "unknown"];
  }));
}

const ICON: Record<QualificationResult, string> = { worked: "✅ worked", failed: "❌ failed", "not-tried": "⏸ not tried" };

export interface ReportInput {
  records: readonly QualificationRecord[];
  dataPassVersion: string;
  vscodeVersion: string;
  platform: string;
  generatedAt: string;
  tools: ReadonlyMap<string, ToolObservation>;
}

/** Markdown for Julian to paste back to Claude: environment, tool detections, then results. */
export function qualificationReport(input: ReportInput): string {
  const rows = [...input.records].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.capabilityId.localeCompare(b.capabilityId));
  const counts = QUALIFICATION_RESULTS.map(r => `${rows.filter(x => x.result === r).length} ${r}`).join(" · ");
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const lines = [
    "# DataPass qualification report",
    "",
    `Generated ${input.generatedAt} · DataPass ${input.dataPassVersion} · VS Code ${input.vscodeVersion} · ${input.platform}`,
    "",
    "Results are what the tester reported after running each operation in its native tool. They are dated observations, not automated proof.",
    "",
    `## Results (${counts})`,
    "",
    ...(rows.length ? [
      "| Project | Operation | Result | Preflight then | Note | Recorded | Tools then |",
      "|---|---|---|---|---|---|---|",
      ...rows.map(r => `| ${esc(r.projectId)} / ${esc(r.scopeId)} | ${esc(r.label)} \`${r.capabilityId}\` | ${ICON[r.result]} | ${r.preflight} | ${esc(r.note ?? "")} | ${r.at} (DataPass ${r.dataPassVersion}) | ${esc(Object.entries(r.tools).map(([k, v]) => `${k} ${v}`).join(", "))} |`)
    ] : ["No result recorded yet. Use \"Record result\" on an operation in the Work view."]),
    "",
    "## Tools detected now",
    "",
    "| Tool | State | Version |",
    "|---|---|---|",
    ...[...input.tools.values()].sort((a, b) => a.toolId.localeCompare(b.toolId)).map(o => `| ${o.toolId} | ${o.state} | ${esc(o.version?.trim() ?? "")} |`),
    ""
  ];
  return lines.join("\n");
}
