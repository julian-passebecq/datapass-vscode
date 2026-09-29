# Hand-off for Codex (V4 tech lead) — DataPass state, checks and Julian's intent — 2026-09-29

From **PM DataPass 2** (global PM, Claude Control V3). Read with: `handoff/V4_VISION.md`, `handoff/ROADMAP.md` ("Idées de Julian — 2026-09-28"), `CHANGELOG.md`, and in `julian-passebecq/dataprojects` (branch `plan/datapass-v4-factory-constellation`) `handoff/2026-09-28_PM_ANSWERS_FOR_CODEX.md`. The source code is the truth; this page only points.

## 1. Where the product is
- **Released:** 1.0.0 (d8772d4). **Working version:** `1.1.0-rc.1` (d62ff62, PR #168) = V3. There will be no separate final 1.1.0 before V4 starts; rc fixes ship alongside V4.
- **On main after rc.1:** QAEXIT + POLISH-2 (#170), POLISH-3 (#177). **Local, not pushed yet:** POLISH-4 (branch `claude/v1-1-x-polish-4`, commit 27d43ec). GitHub Actions minutes are exhausted, so nothing is pushed until your feedback arrives.
- Project schema unchanged (`schemaVersion` 5). Optional bridge files: `.datapass/links.json` (`datapass.links` v1) and `.datapass/understanding/…` (`datapass.understanding` v1).

## 2. What V3 / 1.1.x built (the base V4 extends)
| Area | Built | Where |
|---|---|---|
| Navigation | One left tree with lenses (Project, Architecture, Git, AI / Work orders, Readiness); thin right rail (Details, AI, DAG, Git); DataPass Home (module tiles, layouts, links page) | V3-SHELL #154, V3-HOME #153 |
| **DataPass Hop** | A file opens with its code on the right and a vertical step picture on the left (inputs/outputs, columns, provenance, SQL joins), synchronised cursor ↔ step; stale explanations flagged; "Explain this file" = a work order for the client AI (DataPass never writes the explanation) | V3-HOP1 #151, V3-HOP2 #159, `datapass.understanding` v1 |
| Airflow | Static DAG reading (never executed), tasks + dependencies view, unreadable parts listed not guessed | V3-AIRFLOW #158 |
| Git | PR and local-change badges on diagram blocks; file history | V3-GITDIAG #157 |
| Appearance | Lighter overlay with its own palette, toggles and colour settings; neutral tree icons; diagram light/dark themes | V3-THEME #152, FIX-ICONS #162 |
| POLISH-3 (Julian's rc.1 check) | Visible lens row "Showing: <lens> ▾" + status-bar item; rail folds to 170 px; one Git view at a time; DAG button finds the project's DAG files; each rail button opens its own view | #177 |
| POLISH-4 (local) | Home button restores the project layout; one-click code zoom A-/A+ (Alt+-/Alt+=); `DataPass: Appearance…` picker; DataPass back in the Activity Bar with a bolder icon | 27d43ec |

## 3. Checks and tests
- **Unit/integration:** ~90 test files (`npm test`, tsx + node:test), palette snapshot per mode (`tests/palette.test.ts`); CI runs the full suite on every PR (paused now: no Actions minutes).
- **Automated UI run (qa:ui, Codex Wind Lab fake client, rc.1, 2026-09-28 00:52):** 17 journeys, **13 reached** (R01–R05, J01–J03, J05–J08, J10), **4 blocked** (J04, J09, J11, J12), 0 findings. Report: `D:\PROJ\datapass-qa-v3rc1\qa-ui\20260928-0052-codex-wind-lab\report.json`. QAEXIT (#170) makes qa:ui fail on any incomplete report.
- **Julian's manual rc.1 test (~20 min, `SESSION-JULIAN.md`):** "looks better", "**Hop makes much more sense**". His remarks became POLISH-3 and POLISH-4 (all fixed or local), the rest are V4 ideas (§ 5).
- **Coder model trial (28 Sept, closed by Julian):** one dummy package (SQL table read/write extractor) run on Sonnet 5.5 xhigh and on Opus 5.5 medium: similar cost ($1.06 / $1.00); Sonnet was 2.4× slower but more robust (passed all of Opus's tests; Opus failed 7 of Sonnet's 22 edge cases). **Decision: all coders stay on Opus 5.5 medium.** The Sonnet code is discarded; the edge-case list (quotes and escapes, subqueries, `EXTRACT(… FROM …)`, `IS DISTINCT FROM`, `MERGE … USING` as a read) is useful input for the V4 SQL analyzer ADR.

## 4. Julian's V4 decisions (fixed, `handoff/V4_VISION.md`)
1. **First V4 product: DataPass V4 = understand a real project**: each file's role and layer, its milestones, static lineage (inputs → outputs), findings, and optional AI questions only where the analysis is uncertain. **SQL first, then Python/PySpark, then notebooks.** It extends Hop.
2. Suggested order (PM): Common Semantic Core alpha → understanding v1 adapter → SQL analyzer → first file-understanding UX → PySpark.
3. **Prototype Cloud** (compare 2–3 architectures, no provisioning) and **Factory** (a local prototype that really runs) come **after** DataPass V4, not in parallel.
4. **You (Codex) are the tech lead**: coders start V4 only after your first ADRs; the PM turns your ADRs and work packets into `handoff/PLAN.md` § V4.
5. **Test gate:** before any test session Julian gets a guided tutorial with screenshots (where everything is, every shortcut). It is a standing step of every release candidate.

## 5. Julian's ideas for V4 (ROADMAP, "Idées de Julian — 2026-09-28")
- A thin icon bar on the **left** as well; keep the thin right rail, or optionally replace it with a top button that opens the AI menu. **All configurable.** Full rail redesign (what each button opens, order, placement).
- **Preset window layouts per project step**, opened from a task in Home.
- **Airflow DAG view**: a shape and icon per operator type (sensor, branch, transfer, compute…), an optional horizontal layout, a choice of where the view lives (editor tab, bottom panel, rail). Today it works but is "pas très pratique".
- Ergonomics (done in POLISH-4, confirm in V4 UX): visible DataPass icon, easy code zoom, findable theme setting, Home restores the layout.

## 6. Standing product rules (Julian)
- **Modular UI:** every visual indicator (bands, edges, badges, legends, rails) can be switched on/off, moved, and bundled in presets tied to the experience modes. Nothing hard-coded.
- **Core first:** Fabric, Databricks, Azure (incl. the Oracle VM over SSH), notebooks, cloud architecture. DiagramCloud and Grafana are optional opt-in modules. **No monitoring** in DataPass (only a project links page). **Mongoku removed** from what DataPass shows (old configs still load).
- **AI:** modes (manual, DataPass-guided, agent work orders through the Claude/Codex desktop apps); the AI pilot only validates and plans, never deploys. No MCP server now (possible later). No mandatory paid AI API.
- **Boundaries:** discovery never executes client code; no cloud provisioning; no mandatory AI, Docker or Airflow; native provider tools reused, not rebuilt; no FOIL physics/CAD/LCOE in TypeScript; FOIL-private data never in public repos; the client AI writes the client's repositories, DataPass writes only the extension, common and hub.
- **Julian** answers only product/feature questions (in plain French, recommended option first). Merges, CI, reviews, package order and versions are decided by the PM.

## 7. What the PM needs from you
1. The first **ADRs** (Common Semantic Core, how understanding v1 evolves, SQL analyzer design and its limits, where lineage and findings live, how the modular layout/rail is configured).
2. **Work packets** for LOT 1–2, each: scope, files, done condition, tests, estimated size (≤ 30 M billed tokens per coder package; the PM splits larger ones), dependencies and merge order.
3. Milestones with the tests/audits you want (automated qa:ui journeys to add for V4, and what goes into Julian's tutorial + test session).
4. Open questions for Julian, if any, as product choices with your recommendation first.
