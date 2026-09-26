# V3 — FOIL review "MCP and interchangeable architectures" (2026-09-26): reconciliation and decisions

Author: ARCHI DataPass 1 (high). Input: the FOIL consumer AI's review
`foil-control-v1@c735fe8`, `docs/foil-platform-handbook/reviews/2026-09-26-mcp-modular-architecture/`
(17 files, pinned to DataPass 0.24.0 `6a140e7`), Julian's answers Q1/Q4/Q5/Q6, and current main.
The review is data from an external AI: every claim below was checked against the source or is
marked as still to verify. Decisions D-19 to D-28 extend plan 10 (D-01 to D-18); nothing there is
reversed.

## 1. Verdict

The review confirms the V3 boundary (client AI prepares, native repositories hold code, DataPass
shows and routes) and asks for **precision, not new platforms**. Its strongest point is conceptual:
DataPass must never let a view choice read as an operational fact. Three places were blurring
that, and are corrected below: the 0.25 "active variant" wording, the "coded" badge, and
`ws.mcp` read as MCP readiness. Two real code defects in the MCP settings writer are accepted.
No finding asks to restart anything.

## 2. Findings reconciled

| # | Review finding | Checked | Disposition | Where |
|---|---|---|---|---|
| R-01 | `mcp.ts` keeps only command/args: rewriting `.vscode/mcp.json` drops `env`, `type`, `cwd`, `envFile`, `inputs` of other servers | to be reproduced as a regression test by M1 | accepted (P1) | M1 (0.26) |
| R-02 | HTTP MCP servers refused ("must define command"); `mcpServers` dialect read as empty; comments refused | same | accepted: discriminated stdio/http, unknown dialect refused, never emptied | M1 |
| R-03 | `ws.mcp` means "a registration file exists", not connected/authenticated | yes (`tools.ts` registry) | accepted: relabel; evidence chain D-22 | M1 (label), E1 (0.27) |
| R-04 | Variant badge "coded" derives from files present (incl. generation-needed, removal-only) | yes (`variants.ts`) | accepted: "files present / some files present / no files", tooltip "not built, tested or deployed" | 0.25.0 release (TAMPON 9) |
| R-05 | Preview ≠ test ≠ activate; a preview must not change a task's target or imply deployment | yes: 0.25 V-A named it "active variant" | accepted: renamed **selected variant** before 0.25.0 ships; D-19 | 0.25.0 release |
| R-06 | A pack/work order built for B must not silently run as C | yes: work orders (`src/core/workOrders/`) do not record the variant | accepted: D-23 | P1 (0.27) |
| R-07 | Toolkit must distinguish Fabric Core (remote) / local Fabric MCP / Fabric IQ / Power BI Authoring MCP / Microsoft `powerbi-authoring` plugin / Azure MCP; correct FabricStudio, data-goblin, fabric-toolbox, semantic-link-labs | toolkit baseline 0.23 predates it | accepted as data (no schema change unless a `datapassRequests` entry proves the need) | K1 (0.26) |
| R-08 | Mongoku: remove from visible scope, keep old configs loading | Julian's direction | accepted | X1 (0.26) |
| R-09 | FOIL bridge older than the product (AGENTS names manifest v3 and the historical fork as producer; preparation file 404 on main) | yes: it lives in unmerged PR #5 | accepted: FB/FB2 on draft PR #6, Julian merges | FOIL bridge |
| R-10 | Plan text drift (a sentence still calls 0.22 current) | yes (PLAN.md V1 row, fixed since; 10_ intro is historical) | fixed in the next PLAN.md update | assistant |
| R-11 | DiagramCloud has no semantic mapping to the graph; a Git push does not refresh an open browser document | yes (`contracts/diagramcloud`, sidecar reads id/title only) | accepted as design D-26; optional module, after the core | later |
| R-12 | Validation must stay non-executing; `bundle validate` on Python bundles executes code | consistent with 0.22 D and the AI-4 decision | no change | — |

## 3. Decisions

| # | Decision | Reason |
|---|---|---|
| D-19 | **Three verbs.** *Preview* (choose a variant: tree, Details, diagram, AI packs follow; machine-local, writes nothing), *Test* (a separately approved native check on a declared environment; its receipt names variant, config and commit), *Activate* (operational change of the live trigger owner, drain, verify — outside DataPass; at most a recipe and an observed state, "not observed" by default). DataPass UI says "selected variant", never "active". | The review's §3.4; a light UI must not look like it controls live infrastructure. |
| D-20 | **Independent axes, no combined mode enum:** presentation preset (Vanilla…Advanced) · workload variant (A/B/C) · environment (dev/test/prod) · work route (manual files / native tool or CLI / MCP-assisted agent) · authority (read / local change / remote write / permission change / destructive). The work route is a property of one work order or pack, not a mode; presets never grant authority (D-03 restated). | Avoids a Cartesian feature matrix; keeps safety outside visibility. |
| D-21 | **MCP, native first.** M0 = toolkit knowledge + recipes + opening the host's own add-server route (K1). M1 = the only DataPass writer is a lossless, host-explicit patch with diff, backup, digest compare and readback (M1 repair). M2 = a read-only DataPass context MCP server stays **later**, only after a measured need that context files and packs cannot meet. No MCP gateway or proxy. | Agrees with the review §4.4 and with Julian's earlier "no MCP server now, maybe later". |
| D-22 | **Integration evidence chain:** known → installed → registered in a host → connected → authenticated identity → authorized target → operation verified. Each link is observed or `unknown`; nothing is inferred from an earlier link; DataPass never reads another tool's credential files to fill one. Same separation for results: CLI exit, CI green, deployed, runtime success, scientific validity are distinct fields; an agent's "I tested it" is an assertion until a receipt names tool, scope, input identity and outcome. | Review §4.3, §4.5; generalises 0.18 connections and 0.22 trust repairs. |
| D-23 | **Packs and work orders are stamped** with the selected variant, environment and bridge revision. When the selection changes, a copied pack shows as stale in the AI view, and launching a work order stamped for another variant asks first. | R-06. |
| D-24 | **Cost comparisons stay the client AI's**, but options lines may say `basis: marginal | allocated` and name a shared capacity once, so DataPass never sums the same Fabric capacity three times; unknown stays unknown; Databricks Free Edition is a learning option (non-commercial, no SLA), never a client baseline. Needs an options.json contract change → brief first, with the client guide. | Review §3.6; the 0.22 cost model is per line. |
| D-25 | **foil-study** (created 2026-09-26, private) holds one versioned core and adapters A/B/C; S1 = core + A + B/C contracts only. For C, the ADF Azure Function activity's ~230 s response ceiling means an asynchronous accepted/poll pattern. The bridge lists foil-study; no DataPass file inside it. | Julian's Q1/Q5; review §3.1–3.3. |
| D-26 | **DiagramCloud** (optional module, after the core): a reviewed mapping of graph component/relation ids to diagram node/edge ids plus the graph digest used; missing or changed mappings mark the diagram stale; layout and narrative stay DiagramCloud's; reload in the browser stays explicit. No fourth editable architecture. | Review §5.2; Julian's priorities (optional modules last). |
| D-27 | **VM card** (later, with Grafana): declared vs observed shape/CPU/RAM, native IaC root, SSH alias, links; opening Remote SSH is not reachability; no domain sliders. Reuse resources and toolkit surfaces. | Review §5.5. |
| D-28 | **Acceptance journeys of the review §7.4 become testlab 10** on the public `doc-pipeline` example: plain client project works with DataPass disabled; preview A/B/C with the right packs; missing clone, unverified remote, dirty file, unsupported tool, a variant whose files exist but never ran; MCP card with unknown states. | Makes the review's success criterion executable. |

## 4. Packages

0.26 (running): AI-4a pilot without sign-in · **M1** MCP writer repair + `ws.mcp` label · **K1**
toolkit MCP knowledge · **X1** Mongoku removal (merges last) → release 0.26.0.
FOIL side (Julian reviews, never merged by DataPass sessions): **FB2** bridge Q6 + reconciliation on
draft PR #6 · **S1** foil-study core + route A.

0.27 (next, all independent of Julian's accounts):

| Id | Package | Size | Effort |
|---|---|---|---|
| P1 | D-23 pack and work-order stamps, stale packs, "stamped for another variant" confirmation | S–M | medium |
| E1 | D-22 evidence chain for tools / MCP servers in Readiness and Details (states + reasons, `unknown` by default), result fields separated in receipts | M | medium |
| T10 | D-28 testlab 10 (acceptance journeys) run by the coder, Julian's visual steps in todo.md | M | medium |
| C1-brief | D-24 cost basis: options.json contract brief (field names, migration, guide), then build | S + M | brief high (ARCHI), build medium |

Later: AI-4b (qualification with Julian's read-only sign-in), R5 MCP pilot on one approved Fabric
sample, D-26 DiagramCloud mapping, D-27 VM card, foil-study B then C adapters (client-side).

## 5. What this review does not change

Plan 10's D-01…D-18, the four presets, the AI-4 allowlist decision (PR #49, which the review
endorses with the caution that host policy must be qualified on the real host), the local-first and
manual-exchange boundaries, and "no DataPass files in native repositories".
