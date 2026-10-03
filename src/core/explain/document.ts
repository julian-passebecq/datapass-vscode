/**
 * V5 EXPLAIN1 (TL-8) "Export explainer": the project-level views rendered into ONE self-contained HTML page
 * a client can open from disk — inline CSS and SVG, a CSP that forbids every remote load, no script.
 * Each section is drawn by the standalone view renderer (`screenModel` → headless `toHtml`), so the page shows
 * exactly what the views show. Header: project, Git revision, date, audience marking, origins legend.
 * Pure and deterministic for given inputs (the date is passed in).
 */
import { navViewCss } from "../../views/viewHtml";
import { registeredLayouts, screenModel } from "../../webview/views/renderer";
import { escapeHtml, toHtml } from "../../webview/views/headless";
import { label, type BindingData, type Labels, type VNode } from "../../webview/views/model";
import type { LayoutKind, NavState, ViewDef } from "../navigation/navTypes";
import { explainProvider, type ExplainFacts } from "./sources";
import type { ExplainSection } from "./presets";
import { tourPlayerParts, type PlayerTour } from "./tourPlayer";

/** A guided tour as the page lists it (TOUR2 `datapass.tour/1` steps, mapped to section anchors by the host). */
export interface ExplainTour { readonly id: string; readonly title: string; readonly steps: readonly { readonly title: string; readonly text?: string; readonly sectionId?: string }[] }

export interface ExplainInput {
  readonly facts: ExplainFacts;
  readonly sections: readonly ExplainSection[];
  readonly labels: Labels;
  readonly projectTitle: string;
  /** Git HEAD of the coordination repository; undefined when the folder is not a Git repository. */
  readonly git?: { readonly revision: string; readonly dirty: boolean };
  /** ISO date (YYYY-MM-DD); the only time-dependent value of the page. */
  readonly date: string;
  readonly generator: string;
  readonly tours?: readonly ExplainTour[];
  /** V5 TOURSHARE1: one saved tour played inside the page (read-only, no script); absent = no player. */
  readonly tourPlayer?: PlayerTour;
}

export interface ExplainResult { readonly html: string; readonly included: readonly string[]; readonly skipped: readonly string[] }

const ORIGIN_ORDER = ["declared", "static", "observed", "theoretical", "datapass-guidance", "ai-proposed"];

/** What a layout kind needs in the data to draw something; kinds not listed draw from any data. */
const LAYOUT_NEEDS: Readonly<Record<string, (data: readonly BindingData[]) => boolean>> = {
  metrics: data => data.some(d => Array.isArray(d.metrics) && d.metrics.length > 0),
};

/**
 * The first registered layout in preference order that has data to draw (e.g. `metrics` with zero metrics falls
 * back to the next listed layout); else the first registered one, else the last listed, else `table`.
 */
export function pickLayout(preferred: readonly string[], registered: ReadonlySet<string>, data: readonly BindingData[]): LayoutKind {
  const usable = preferred.filter(l => registered.has(l));
  return (usable.find(l => LAYOUT_NEEDS[l]?.(data) ?? true) ?? usable[0] ?? preferred[preferred.length - 1] ?? "table") as LayoutKind;
}

export function buildExplainHtml(input: ExplainInput): ExplainResult {
  const { facts, labels } = input;
  const layouts = new Set(registeredLayouts());
  const rendered: { section: ExplainSection; body: VNode }[] = [];
  const skipped: string[] = [];
  const origins = new Set<string>();
  for (const section of input.sections) {
    const provider = explainProvider(section.source);
    if (!provider) { if (section.optional) { skipped.push(section.id); continue; } }
    const data: BindingData[] = facts.prepared === false
      ? [{ source: section.source, origin: "declared", holes: [{ kind: "no-project", field: section.source, reason: label(labels, "hole.no-project") }] }]
      : provider ? provider(facts, section.params ?? {})
      : [{ source: section.source, origin: "static", holes: [{ kind: "no-provider", field: section.source, reason: label(labels, "hole.no-provider") }] }];
    collectOrigins(data, origins);
    const layout = pickLayout(section.layouts, layouts, data);
    const view: ViewDef = { id: section.id, title: section.title, layout, bindings: [{ source: section.source }], ...(section.description ? { description: section.description } : {}) };
    const state: NavState = { location: { level: "project", nodeId: facts.map.project?.id ?? "project", artifactKind: "project" }, viewId: section.id, back: [], forward: [] };
    const screen = screenModel({ state, views: [view], labels, data });
    // The view body only: the shell header (location, view tabs) belongs to the interactive host.
    const body = screen.children?.find(c => c.tag === "main") ?? screen;
    rendered.push({ section, body });
  }

  const player = input.tourPlayer ? tourPlayerParts(input.tourPlayer, rendered.map(r => ({ id: r.section.id, body: r.body })), labels) : undefined;
  player?.origins.forEach(o => origins.add(o));
  const L = (k: string) => escapeHtml(label(labels, k));
  const marking = `marking.${facts.audience}`;
  const gitText = input.git ? `${escapeHtml(input.git.revision)}${input.git.dirty ? ` (${L("header.dirty")})` : ""}` : L("header.noGit");
  const legend = ORIGIN_ORDER.filter(o => origins.has(o)).concat([...origins].filter(o => !ORIGIN_ORDER.includes(o)).sort())
    .map(o => `<li><span class="nv-origin nv-origin-${escapeHtml(o.replace(/[^a-z0-9-]+/gi, "-").toLowerCase())}">${L(`origin.${o}`)}</span> ${L(`legend.${o}`)}</li>`).join("");
  const toc = rendered.map(r => `<li><a href="#xp-${escapeHtml(r.section.id)}">${escapeHtml(r.section.title)}</a></li>`).join("");
  const tours = (input.tours ?? []).filter(t => t.steps.length).map(t => `<section class="xp-tour" aria-label="${escapeHtml(t.title)}"><h3>${escapeHtml(t.title)}</h3><ol>${
    t.steps.map(s => `<li>${s.sectionId && rendered.some(r => r.section.id === s.sectionId) ? `<a href="#xp-${escapeHtml(s.sectionId)}">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}${s.text ? ` — <span class="nv-muted">${escapeHtml(s.text)}</span>` : ""}</li>`).join("")}</ol></section>`).join("");
  const sections = rendered.map(r => `<section class="xp-section" id="xp-${escapeHtml(r.section.id)}"><h2>${escapeHtml(r.section.title)}</h2>${
    r.section.description ? `<p class="nv-muted">${escapeHtml(r.section.description)}</p>` : ""}${player?.boxes.get(r.section.id) ?? ""}${
    toHtml(player?.bodies.get(r.section.id) ?? r.body)}</section>`).join("\n");
  const title = escapeHtml(input.projectTitle);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;" />
<meta name="generator" content="${escapeHtml(input.generator)}" />
<title>${title}</title>
<style>${navViewCss()}${explainCss()}${player?.css ?? ""}</style>
</head>
<body>
<div class="nv-root xp">
<p class="xp-marking xp-marking-${facts.audience}" role="note">${L(marking)}</p>
<header class="xp-head">
<h1>${title}</h1>
<dl class="xp-meta">
<dt>${L("header.git")}</dt><dd><code>${gitText}</code></dd>
<dt>${L("header.date")}</dt><dd>${escapeHtml(input.date)}</dd>
<dt>${L("header.audience")}</dt><dd>${L(`audience.${facts.audience}`)}${facts.omitted.length ? ` · ${L("header.omitted")}: ${facts.omitted.length}` : ""}</dd>
</dl>
${legend ? `<section class="xp-legend"><h2>${L("legend.title")}</h2><ul>${legend}</ul></section>` : ""}
</header>
<nav class="xp-toc" aria-label="${L("page.contents")}"><ul>${toc}</ul></nav>
${tours ? `<section class="xp-tours"><h2>${L("page.tours")}</h2>${tours}</section>` : ""}
${player ? `${player.panel}\n` : ""}<main>
${sections}
</main>
<footer class="xp-foot nv-muted">${L("page.generator")} (${escapeHtml(input.generator)}). ${L("page.static")}</footer>
</div>
</body>
</html>
`;
  return { html, included: rendered.map(r => r.section.id), skipped };
}

function collectOrigins(data: readonly BindingData[], into: Set<string>): void {
  const cell = (c: unknown) => { if (c && typeof c === "object" && "origin" in c && typeof (c as { origin: unknown }).origin === "string") into.add((c as { origin: string }).origin); };
  for (const d of data) {
    into.add(d.origin);
    for (const r of d.rows ?? []) Object.values(r.cells).forEach(cell);
    for (const c of d.cards ?? []) { if (c.origin) into.add(c.origin); c.fields.forEach(f => cell(f.value)); }
  }
}

/** Page chrome on top of the nav view CSS; a browser has no VS Code theme, so colours come from the light/dark scheme. */
function explainCss(): string {
  return `
  :root { --xp-bg: #ffffff; --xp-fg: #1f2328; --xp-mark: #9a6700; }
  @media (prefers-color-scheme: dark) { :root { --xp-bg: #0d1117; --xp-fg: #e6edf3; --xp-mark: #d29922; } }
  body { margin: 0; background: var(--xp-bg); color: var(--xp-fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .xp { max-width: 1100px; margin: 0 auto; padding: 16px; }
  .xp-marking { margin: 0 0 12px; padding: 6px 10px; border: 1px solid var(--xp-mark); color: var(--xp-mark); border-radius: 4px; font-weight: 600; }
  .xp-marking-public { border-color: var(--nv-border); color: var(--nv-muted); }
  .xp-head h1 { margin: 0 0 8px; font-size: 24px; }
  .xp-meta { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 12px; }
  .xp-meta dt { color: var(--nv-muted); } .xp-meta dd { margin: 0; overflow-wrap: anywhere; }
  .xp-legend h2, .xp-tours h2 { font-size: 14px; margin: 12px 0 4px; }
  .xp-legend ul, .xp-toc ul { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .xp-toc { position: sticky; top: 0; background: var(--xp-bg); padding: 8px 0; border-bottom: 1px solid var(--nv-border); margin-bottom: 8px; }
  .xp-toc a, .xp-tour a { color: var(--nv-focus); }
  .xp-section { padding-top: 8px; scroll-margin-top: 48px; }
  .xp-section h2 { font-size: 18px; margin: 16px 0 2px; }
  .xp-section .nv-main { padding: 8px 0; overflow-x: auto; }
  .xp-foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid var(--nv-border); font-size: 12px; }
  @media print { .xp-toc { position: static; } }
  `;
}
