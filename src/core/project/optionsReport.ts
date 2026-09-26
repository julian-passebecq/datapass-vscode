/**
 * Architecture options as Markdown (0.15): the comparison a person exports or reads, and the
 * context an AI gets to compare options or to apply a decision. Pure; built from the options file
 * (declarations) and DataPass's own analysis (consequences), never from file contents or paths.
 */
import { stampLine, type PackStamp } from "./packStamp";
import { scrub } from "../exchange/aiContext";
import { formatCostLine, formatCostTotal, sumCostLines } from "./costs";
import { type ArchitectureImpact, type ArchOption, type CriterionValue, type Decision, type OptionsAnalysis, type OptionsFile } from "./options";

export type OptionsReportPurpose = "export" | "compare" | "apply";

export interface OptionsReportInput {
  options: OptionsFile;
  analysis: OptionsAnalysis;
  project?: { id: string; title: string };
  purpose: OptionsReportPurpose;
  /** Limit to one decision (compare/apply) and, to apply, the option to move to. */
  decisionId?: string;
  optionId?: string;
  generatedAt: string;
  dataPassVersion: string;
  guideUrl?: string;
  /** 0.25 (V-A): the active variant line (title and coding state). */
  activeVariant?: string;
  /** 0.27 (P1, D-23): the selected variant, environment and bridge revision this pack is built for. */
  stamp?: PackStamp;
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function valueText(v: CriterionValue | undefined): string {
  if (v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  const dots = v.score ? `${"●".repeat(v.score)}${"○".repeat(5 - v.score)}` : "";
  return [v.text, dots].filter(Boolean).join(" ");
}

function toolsLine(i: ArchitectureImpact): string {
  if (!i.tools.newlyNeeded.length) return "no new tool";
  return i.tools.newlyNeeded.map(t => `${t.label}${t.state === "present" ? " (installed)" : t.state === "absent" ? " (not installed)" : ""}`).join("; ");
}

function supportLine(i: ArchitectureImpact): string {
  return `${i.support.operations} with operations, ${i.support.files} files only, ${i.support.unsupported} not supported`;
}

function componentsLine(i: ArchitectureImpact): string {
  const parts = [
    i.components.added.length ? `+${i.components.added.length} (${i.components.added.map(c => c.label).join(", ")})` : "",
    i.components.removed.length ? `−${i.components.removed.length} (${i.components.removed.map(c => c.label).join(", ")})` : "",
    i.components.replaced.length ? `~${i.components.replaced.length} (${i.components.replaced.map(c => `${c.label}: ${c.from ?? "?"} → ${c.provider ?? "?"}`).join(", ")})` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "unchanged";
}

/** Per currency, monthly and one-time apart, "partial: n of m decisions priced" when any is unknown (F01, F08). */
function costLine(i: ArchitectureImpact): string {
  return formatCostTotal(i.costs.total);
}

function decisionSection(o: OptionsFile, d: Decision, a: OptionsAnalysis, lines: string[]): void {
  lines.push("", `## ${d.title}${d.level ? ` (level: ${d.level})` : ""}`);
  if (d.question) lines.push(d.question);
  const current = d.options.find(x => x.id === d.current)!;
  const chosen = d.chosen ? d.options.find(x => x.id === d.chosen) : undefined;
  lines.push(`- Current (what graph.json describes): **${current.label}**`);
  if (chosen && chosen.id !== d.current) lines.push(`- Decided${d.decidedOn ? ` on ${d.decidedOn}` : ""}${d.decidedBy ? ` by ${d.decidedBy}` : ""}: **${chosen.label}** (not applied yet)${d.rationale ? ` — ${d.rationale}` : ""}`);
  const opts = d.options;
  const head = `| | ${opts.map(x => `${esc(x.label)}${x.id === d.current ? " (current)" : ""}${x.rejected ? " (rejected)" : ""}`).join(" | ")} |`;
  const rule = `|---|${opts.map(() => "---").join("|")}|`;
  const row = (label: string, cell: (x: ArchOption, i: ArchitectureImpact) => string) => `| ${esc(label)} | ${opts.map(x => esc(cell(x, a.byOption[`${d.id}=${x.id}`]!))).join(" | ")} |`;
  lines.push("", head, rule);
  lines.push(row("Summary", x => x.summary ?? "—"));
  for (const c of o.criteria ?? []) if (opts.some(x => x.values?.[c.id] !== undefined)) lines.push(row(`${c.label}${c.unit ? ` (${c.unit})` : ""}`, x => valueText(x.values?.[c.id])));
  lines.push(row("Components (DataPass)", (_x, i) => componentsLine(i)));
  lines.push(row("New official tools (DataPass)", (_x, i) => toolsLine(i)));
  lines.push(row("DataPass support (DataPass)", (_x, i) => supportLine(i)));
  lines.push(row("Declared cost of this choice", x => formatCostTotal(sumCostLines(x.costs, o.currency ?? "USD"))));
  for (const x of opts) {
    const bits: string[] = [];
    if (x.pros?.length) bits.push(`  - Pros: ${x.pros.join("; ")}`);
    if (x.cons?.length) bits.push(`  - Cons: ${x.cons.join("; ")}`);
    if (x.consequences?.length) bits.push(`  - Consequences: ${x.consequences.join("; ")}`);
    for (const c of x.costs ?? []) bits.push(`  - Cost: ${c.label}${c.price ? ` — ${c.price}` : ""} (${formatCostLine(c, o.currency ?? "USD")})${c.source ? ` — source ${c.source}` : ""}${c.asOf ? `, as of ${c.asOf}` : ""}${c.note ? ` — ${c.note}` : ""}`);
    if (x.requires?.length) bits.push(`  - Requires: ${x.requires.join(", ")}`);
    if (x.excludes?.length) bits.push(`  - Does not work with: ${x.excludes.join(", ")}`);
    if (bits.length) lines.push("", `- **${x.label}**`, ...bits);
  }
}

export function optionsMarkdown(input: OptionsReportInput): { text: string; bytes: number; truncated: boolean } {
  const { options: o, analysis: a } = input;
  const lines: string[] = [];
  const title = `${o.title ?? "Architecture options"}${input.project ? ` — ${input.project.title}` : ""}`;
  lines.push(`# ${title}`);
  lines.push(`Generated by DataPass ${input.dataPassVersion} on ${input.generatedAt}. Prices, scores, pros and cons are declarations from .datapass/options.json (with their source and date), not checked by DataPass; rows marked "(DataPass)" are DataPass's own analysis of the architecture and of this machine.`);
  if (input.activeVariant) lines.push(input.activeVariant);
  if (input.stamp) lines.push(stampLine(input.stamp));
  const focus = input.decisionId ? o.decisions.find(d => d.id === input.decisionId) : undefined;
  if (input.purpose === "compare") {
    lines.push("", "## What I am asking", focus
      ? `Compare the options of the decision "${focus.title}" for my project. Recommend one, explain the consequences in plain language, and point out anything missing or wrong in the comparison (consequences, prices without source or date, incompatible combinations). If the file needs corrections, return the complete corrected .datapass/options.json in one \`\`\`json block.`
      : "Compare these architecture scenarios for my project. Recommend one, explain the consequences in plain language, and point out anything missing or wrong in the comparison. If the file needs corrections, return the complete corrected .datapass/options.json in one ```json block.");
  } else if (input.purpose === "apply" && focus) {
    const target = focus.options.find(x => x.id === (input.optionId ?? focus.chosen)) ?? focus.options.find(x => x.id === focus.current)!;
    lines.push("", "## What I am asking",
      `I decided: "${focus.title}" → **${target.label}**. Apply it in a pull request: update .datapass/graph.json (and .datapass/project.json if repositories or sub-projects change) so that they describe this option, prepare or move the native files in their repositories, and update .datapass/options.json: set "current" of "${focus.id}" to "${target.id}" and remove "chosen". Do not delete the other options: they stay as alternatives. Never put secrets in any file; do not claim anything is deployed or tested.`);
  }

  lines.push("", "## Scenarios", "", "| Scenario | Picks | Components | New official tools | DataPass support | Declared cost | Problems |", "|---|---|---|---|---|---|---|");
  for (const s of a.scenarios) {
    const picks = s.impact.picks.filter(p => p.changed).map(p => `${p.decision}=${p.option}`).join(", ") || "all current";
    lines.push(`| ${esc(s.title)}${s.recommended ? " (recommended)" : ""} | ${esc(picks)} | ${s.impact.components.total} (${esc(componentsLine(s.impact))}) | ${esc(toolsLine(s.impact))} | ${esc(supportLine(s.impact))} | ${esc(costLine(s.impact))} | ${s.impact.problems.length} |`);
  }
  for (const d of focus ? [focus] : o.decisions) decisionSection(o, d, a, lines);
  const problems = a.problems.filter(p => p.severity !== "info");
  if (problems.length) { lines.push("", "## Problems DataPass found"); for (const p of problems.slice(0, 20)) lines.push(`- ${p.severity}: ${p.where} — ${p.message}`); }
  if (input.purpose !== "export") {
    lines.push("", "## Rules for your answer",
      "- Never put secrets, keys, tokens, connection strings or local paths in any file or in your answer.",
      "- Do not claim anything is deployed, tested or working; say which check I run in which official tool.",
      "- A price is an order of magnitude with its official source and the date you read it, in its own currency (never converted). A cost you do not know stays without a figure: never 0.",
      "- DataPass adds costs per currency and marks a total \"partial\" when a decision or line has no figure; do not read a partial total as the full cost.");
    if (input.guideUrl) lines.push(`- DataPass formats: ${input.guideUrl}`);
  }
  let text = scrub(lines.join("\n")) + "\n";
  const enc = new TextEncoder();
  const max = 40_000;
  let truncated = false;
  if (enc.encode(text).byteLength > max) {
    truncated = true;
    const marker = "\n…[truncated; ask me for the rest]\n";
    while (enc.encode(text + marker).byteLength > max) text = text.slice(0, Math.floor(text.length * 0.92));
    text += marker;
  }
  return { text, bytes: enc.encode(text).byteLength, truncated };
}
