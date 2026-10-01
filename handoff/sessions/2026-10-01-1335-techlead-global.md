# Hand-off TECH LEAD GLOBAL DataPass (Opus high) → successor (2026-10-01 ~13:35 local, rules V3.8)

Written at 354 K (over the 250 K limit). Role: architecture authority for V4+V5; never merges, never edits PLAN.md; decisions go into `handoff/ARCH_DECISIONS.md`. Live PM: **PM 29** (local_b0e7d2f8-ca68-4334-b717-43838f5113e2). NAV coordinator: **COORD 39** (local_1334df48-775a-4d30-a626-eabe8eb918ab). Common: **COORD Common 12** (local_2091be1f-5056-4f56-a5b3-8950ee193a8b). Burn mode (Opus high allowed) ended at 14:00 → Claude Control V4.

## 1. Open tasks (architect-on-call, most urgent first)
1. **Core reviews when the MRs appear:** MULTIFAM1 (Common; must follow TL-6 amended A1–A6, go/MULTIFAM1-design-notes.md), TOURSPI1 (Common view-spi; go/TOUR-PEDA-contract.md § tour), V5FREEZE1 (go/V5FREEZE1-review.md § contents). Verdict ≤ 5 lines to PM 29.
2. **Check the 6 V5 contract MRs got their wire fixes** (ARCH_DECISIONS "V5FREEZE1 verdicts") before Common 12 runs V5FREEZE1; OTELSPI1 goes to V5FREEZE2.
3. **NAV train**: !199 → NAVWIRE1 !230 (approved) → R1/R2/R3 (V4-STATUS b1). NAVDATA1 !228 rebases on !201 (a10) and drops lineage providers (NAVLIN1 owns them). NAVCHG1 !232 is architecture-OK at eff50ab.
4. **W1 fixes** (go/V5-W1-review-1.md): chips W1FIX-DBTMAT1/PQSAMP1/GITMR1/EVPIN1. Re-review on request.
5. **PEDA1a split into PEDA1a + PEDA1a2** (decision cards + SQL technique ids); PEDA1b §2b and PEDA3 depend on PEDA1a2. NAVTOUR1+TOUR2 coder handed off (go/handoff-inbox/NAVTOUR1-TOUR2-coder-c7d6ad6b.md); !242/!244 are contract-aligned.
6. The Artifact (V5 plan view) https://claude.ai/artifact/RbPa5YhFJdv1Thgr6SDFTP was published from the previous session's scratchpad; to update it from a new session, pass its `url`.

## 2. Done (gitlab main)
- handoff/V5-PLAN.md (42 pkgs, ~445 M) · handoff/V4-STATUS-REMAINING.md (a1–a10, b1–b4, c, d) · ROADMAP 12:10 triage.
- ARCH_DECISIONS: TL-1…TL-14, TL-1/4/5/6 amended, TL-12b/12c, V5FREEZE1 verdicts, TL-14 corrected, NAV rulings (last commit c234d5c).
- GOs: go/V5-*.md (20), go/NAVDATA1.md; reviews/notes: go/V5FREEZE1-review.md, MULTIFAM1-design-notes.md, V5-W1-review-1.md, TOUR-PEDA-contract.md, NAV-train-conflict-map.md, V5-ACCEPTANCE.md.
- NAVWIRE1 !230 approved (self-registration via scripts/gen-registry.mjs → gitignored out/gen; kinds surface/layout/palette/binding/pack).

## 3. Next
V5FREEZE1 → REPIN5 → W2 starts; V5FREEZE2 (OTEL, TOURSPI1, PEDA1a/a2, ARCHCALL1 + test "answer origin ∈ EVIDENCE_ORIGINS"); V5E2E1 per go/V5-ACCEPTANCE.md → V5TUT1 → V5REL1.

## 4. Key files
handoff/V5-PLAN.md · handoff/V4-STATUS-REMAINING.md · handoff/ARCH_DECISIONS.md (end) · D:\PROJ\datapass\go\ (GOs + reviews above) · C:\Users\julia\.claude\effort-board\julian-idea-guided-tours-2026-10-01.md (Julian's 12:10 idea + 3 addenda).

## 5. Decisions (one line each; detail in ARCH_DECISIONS)
Self-registration replaces hand-edited shared lists (TL-1 am.) · two contract freezes in V5 (TL-2) · git read-only via one enforced wrapper (TL-4 am.) · MULTIFAM1 may mint repo-inventory v3 (TL-6 A1) · tours = saved paths in the ↑/↓×←/→ grid, Learning/Interview modes, cards cite project code (TL-11/12/12b/12c) · one binding provider per source; core never imports work/vscode; packs = `*.pack.ts` (NAV rulings) · auto-cancel pipelines on, incl. main (c10).

## 6. How to verify
`git log --oneline -5 gitlab/main` in datapass-vscode; `glab mr list` in vscode/common; grep "TL-" handoff/ARCH_DECISIONS.md. Push with `git -c credential.helper= -c 'credential.helper=!"C:/Users/julia/AppData/Local/Programs/glab/glab.exe" auth git-credential' push` (plain git hangs on the Credential Manager).

## 7. Lessons
- Plain `git push/fetch` can hang on the Windows Credential Manager; use glab as credential helper per command.
- Architect passes as parallel high subagents (merge simulation, contract review, design-vs-code notes) found S1s that reading the plan alone missed (empty views, stale vendoring, frozen-schema breaks).
