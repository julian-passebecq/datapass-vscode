# V5 plan: index (TECH LEAD GLOBAL DataPass, Opus high · 2026-10-01 · rules V3.8)

Binding decisions: ARCH_DECISIONS § "V5 architecture (TECH LEAD GLOBAL)" TL-1…TL-14. PM 27 copies this table into PLAN § V5 (it owns PLAN). GOs: `D:\PROJ\datapass\go\<PKG>.md` (existing) and `go\V5-<PKG>.md` (new). Julian's frame (12:10): **V5 delivers the maximum; V6 = small polish + new clients.** Visual version: the V5 plan Artifact (link in the PM 27 report).

**Gates.** (1) V4-NAV renderer kinds: GITMR2/3, OTEL2, EXPLAIN1, PEDA1b need NAVREN2 (graph, no MR yet) and NAVREN3 (!192) merged; they code on stubs until then. (2) Common: VERBUMP1 → V5FREEZE1 → REPIN5 before any V5 standalone MR re-pins Common (TL-13). (3) Boundaries unchanged: no client code execution, no deploy, no hidden AI call, remote calls only in replay/opt-in readers.

**Amendments to the existing V5 GOs** (DBTMAT1, DETACH1/2, GITMR1–3, OTEL1/2, OTELSPI1, STUDIO2–4, PQSAMP1, AUTHPNL1, EVPIN1, EVCAPT1, EVACTOR1, XGAP1, TODOSTALE1, V5E2E1): report to the coordinator named in the PLAN Team table, not to the session id in the GO (TL-9; COORD 31/32 are retired). Shared files are append-only (TL-1). Never mint `schemas/vN` (TL-2). DBTMAT1 reuses `src/core/materialize/` (MAT1, already has the notebook and SJD targets, TL-5).

| Pkg | Repo | State 12:30 | Depends on | M | Wave |
|---|---|---|---|---|---|
| DETSPI1 · GITSPI1 · OTELSPI1 | Common project-contracts | !175 · !172 · !173 open | — | 8+8+8 | W0 |
| EVPIN1 · EVCAPT1 · EVACTOR1 | Common (+ vscode !215) | !179 · !178 · !180 open | — | 6+5+5 | W0 |
| VERBUMP1 → V5FREEZE1 | Common | not started (COORD Common) | gap batch; contracts above | 4+5 | W0 |
| **MULTIFAM1** | Common analyzers core | new GO (TL-6) | — | 12 | W0 |
| **TOURSPI1** | Common view-spi | new GO (TL-11) | — | 6 | W0 |
| **REPIN5** | vscode + cloud + studio | new GO (TL-13) | V5FREEZE1 | 10 | W0b |
| DBTMAT1 · DETACH2 · STUDIO2 · PQSAMP1 | vscode · Common · studio · vscode | running (PM 27 subagents) | MAT1 ✓, DBTRUN1 ✓ | 20+10+18+10 | W1 |
| GITMR1 · OTEL1 | vscode · cloud | !214 · !128 open | GITSPI1 · OTELSPI1 | 12+15 | W1 |
| GITMR2 · STUDIO3 · AUTHPNL1 | vscode · studio · vscode | chips pending | NAVREN2/3 · STUDIO1 ✓ (TL-3 vendoring) · NAVCTX1 | 14+20+12 | W1 |
| DETACH1 | vscode | GO ready | DBTMAT1 | 14 | W1 |
| **PINDRIFT1** | Common tool + 3 CI lines | new GO | — | 10 | W1 |
| **DAGUX1** | vscode | new GO (rc.1 remarks) | — | 12 | W1 |
| **PEDA1a2** | Common arch-catalog | split from PEDA1a 13:0x (go/V5-PEDA1a2.md: ~15 decision cards + SQL techniques), PM 28 subagent | PEDA1a | ~8 | W1 |
| **PEDA1a** | Common arch-catalog | new GO (TL-12; 25 concepts + ~10 Spark/SQL + ~15 decision cards) | — | 17 | W1 |
| **TOUR2** | vscode | new GO (TL-11) | NAVTOUR1 + NAVCAT1 + NAVBAR1 (+ Learning/Interview modes, toggles) | 16 | W1 |
| OTEL2 | vscode | chip pending (stub) | OTEL1 + REPIN5 (analyzers-api) + NAVLIN1 | 14 | W2 |
| GITMR3 | vscode | GO ready | GITMR2 + NAVCHG1 + PINDRIFT1 | 14 | W2 |
| XGAP1 · TODOSTALE1 | Common + vscode | GO ready | NAVTODO1 · EVPIN1 | 6+4 | W2 |
| **SJDMAT1** | vscode | new GO (TL-5) | DBTMAT1 | 8 | W2 |
| **TOURAI1** | vscode | new GO | TOUR2 | 10 | W2 |
| **PEDA1b · PEDA2** | vscode | new GO | PEDA1a (concept part), PEDA1a2 (§2b decision cards), NAVPRIN1 · PEDA1b + TOUR2 ("whole picture" 5-question spine) | 13+12 | W2 |
| **PEDA3** | vscode | new GO (TL-12c, query showcase cards) | PEDA1a + **PEDA1a2** (SQL techniques) + PEDA1b | 12 | W2 |
| **EXPLAIN1** | vscode | new GO (TL-8) | NAVHOME1, NAVLIN1, NAVTODO1, TOUR2 | 14 | W2 |
| **ARCHCALL1** | Common + vscode | new GO (TL-7) | NAVCTX2 | 10 | W2 |
| **LAYOUT1** | vscode | new GO (rc.1 remark) | NAVHOME1 | 10 | W2 |
| STUDIO4 | studio | GO ready | STUDIO2 + STUDIO3 | 15 | W2 |
| **V5FREEZE2** | Common | new GO (TL-2) | TOURSPI1, PEDA1a, ARCHCALL1, OTELSPI1 !173 (moved from V5FREEZE1, freeze review 1 Oct) | 4 | W3 |
| V5E2E1 → **V5TUT1** → **V5REL1** | vscode | GO ready / new GOs | everything above | 12+6+6 | W3 |

| **STEPBAR1** | vscode | new GO go/V5-STEPBAR1.md (Julian 13:45: guided path as normal navigation + checks out of the project tree) | TOUR2 !244, NAVBAR1 !211 | 14 | W2 |
| **TOURSHARE1** | vscode | new GO go/V5-TOURSHARE1.md (tour inside the EXPLAIN1 HTML export; completeness audit) | TOUR2, EXPLAIN1 | 8 | W2 |
| NAVINTRO1b · NAVINTRO1c | vscode | GO ready (go/NAVINTRO1b.md, go/NAVINTRO1c.md; were missing from this table) | NAVINTRO1a | see GOs | W2 |
| **VERBUMP1 → V5FREEZE1** | Common | new GO go/V5-VERBUMP1-FREEZE1.md (ARCH-REVIEW S1: chain not started; NavOrigin out, evidence-id max 128) | !180 | 4+5 | W0 |
| **REPIN8** | vscode + cloud + studio | new GO go/V5-REPIN8.md (ARCH-REVIEW S1: re-pin after V5FREEZE2 + exchange-protocol vendored + every stub swapped; gate `git grep "until REPIN"` = 0) | V5FREEZE2, REPIN5 | 10 | W3 (before V5E2E1) |

**PM 29 rulings 14:00 (go/ARCH-REVIEW-2026-10-01-1345.md, go/V5-COMPLETENESS-2026-10-01.md):** W1 stand-ins (dbtNotebook.ts, repoSetContract.ts/stubs.ts, pinContract.ts) are aligned to the reviewed wire shapes (no `schemaId`, prefixed digests, actor `{kind,id}`) BEFORE their MRs merge, so `.datapass` records validate against frozen v3. OTEL2 drops its packs/index.ts and reuses NAVLIN1's lineage bindings; GITMR2 reuses GITMR1's repoSet (no copy under src/core/git/); TOURAI1 uses NAVTOUR1's tourTypes (one stub copy until REPIN8). PEDA2 done condition adds a "volumetry + objectives" step. V5REL1 includes the REPIN8 stub gate. Cut order unchanged.

**Totals:** 42 packages, ~445 M (19 new GOs, ~196 M; Julian's 12:10 addenda 1–3 included). Already merged for V5: STUDIO0, STUDIO1, STUDIOCI1, MAT1, DBTRUN1.
**Coders:** W0 now: contract reviews + 3 new packages (MULTIFAM1, TOURSPI1, then REPIN5). **W1 at 14:00: 10 coders** (4 subagents running, 3 chips, + DETACH1, PINDRIFT1, DAGUX1, PEDA1a, TOUR2, which fills 10 when the subagents end). W2: 10 coders as W1 merges. W3: 3 coders + Julian's test session with the V5TUT1 tutorial.
**Merge order, standalone (shared files, append-only):** DBTMAT1 → DETACH1 → GITMR1 → GITMR2 → PQSAMP1 → AUTHPNL1 → DAGUX1 → TOUR2 → SJDMAT1 → GITMR3 → OTEL2 → XGAP1/TODOSTALE1 → PEDA1b → TOURAI1 → PEDA2 → ARCHCALL1 → LAYOUT1 → EXPLAIN1 → V5E2E1 → V5TUT1 → V5REL1. **Common:** V5 contracts → VERBUMP1 → V5FREEZE1 → REPIN5; MULTIFAM1 independent (batch version rule); TOURSPI1, PEDA1a, ARCHCALL1, PINDRIFT1 → V5FREEZE2. Studio and cloud are independent. Out of order is fine when the rebase is clean.
**Cut order if quota runs short:** OTEL2, OTEL1, STUDIO4, LAYOUT1, then GITMR3 (TL-10). Never cut TOUR2, PEDA1a/b, EXPLAIN1, DETACH1, V5TUT1.

## Julian's ideas: triage (useful now · V5 · later · no)

| Idea | Verdict → package | Why (one line) |
|---|---|---|
| Guided tours in Navigator/mini-map, steps 1-2-3 + explanation box; walk a superior through (12:10) | **V5 core** → TOURSPI1, TOUR2, EXPLAIN1 | A tour is a saved path through the ↑/↓ × ←/→ grid; it reuses NAVTOUR1/NAVCAT1 and needs no new canvas. |
| AI-bridge-prepared routes ("understand the BI part") | V5 → TOURAI1 | Good use of the exchange, validated against real Locations; unknown ones become holes. |
| One-page DE cards + interviewer lens (12:10) | V5 → PEDA1a/b, PEDA2 | Strong only if each card cites the project's code; generic cards would be a course, not DataPass. |
| NAVTOUR1 journey tours + jump to a box | now (V4-NAV W2, not started) | Base for TOUR2; if still unassigned at 14:00, the TOUR2 coder does it first. |
| X-Ray button on OneLake/Fabric extensions | now → XRAYOL1 (x!5, CI failed) | Feasible by view id; the clicked item is best-effort, so the file fallback must be tested on both extensions. |
| Supercharged multi-repo Git "VSIX" | V5 module → GITMR1–3 (+ TL-4 seam); VSIX later | The value is cross-repo status/impact inside one lifecycle (AC-N16); the seam keeps a separate VSIX possible. |
| SQLRooms / Studio outside VS Code | V5 → STUDIO2–4 | Studio already runs SQLRooms 0.29 + DuckDB-WASM; it reuses cloud views by vendoring (TL-3). |
| Spark job vs notebook | V4 card EXEC1c + V5 → SJDMAT1 | Microsoft's own prod guidance; MAT1 already has the SJD target, so V5 adds only the wheel skeleton. |
| FastAPI OpenTelemetry | V5, low priority → OTELSPI1, OTEL1, OTEL2 | Cheap replay reader, but no client has FastAPI in prod: first to cut. |
| Power Query-style view | now NAVREN4 (!193) + V5 PQSAMP1 | Steps exist (Hop); the data sample is the V5 part. |
| Architect-on-call | now (process, this session) + V5 → ARCHCALL1 | Three triggers; in the product it is an exchange template, never a hidden call. |
| Visual Explainer | now (process: HTML views for Julian) + V5 → EXPLAIN1 | A client-shareable page of the project instead of markdown. |
| Rail redesign / left icon bar / DAG shapes, placement / layout presets per step (28 Sept) | V5 → DAGUX1, LAYOUT1 (rail = NAVBAR1) | Never scheduled since rc.1; NAV covers the rail, these two close the rest. |
| dbt canonical + detachable notebook | V5 → DETSPI1, DBTMAT1, DETACH1/2 | Explicit, stamped authority change; drift becomes a fact. |
| Gorgias "flag gaps" / OmicsLake / Elastic authority panel | V5 gaps → XGAP1; panel → AUTHPNL1; snapshot-restore later | Keep the parts that fit "never execute"; restoring data states and auto-PR loops do not. |
| Separate VSIXs (dashboard, Sankey, mega-lineage) · mobile companion | no · later | One lifecycle, one extension; mobile has no user need yet. |
| Guided tutorial with screenshots before every test session | rule → V5TUT1 | Julian's standing gate. |
| **Tech lead additions** | MULTIFAM1 design, PINDRIFT1, REPIN5, SJDMAT1, EXPLAIN1, ARCHCALL1, TOURSPI1 | Close the coverage, vendoring and drift holes found in today's review (TL-6, TL-13). |
