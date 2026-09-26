# V1-STAB — stabilisation sweep (2026-09-26)

Package V1-STAB of [handoff/PLAN.md](../PLAN.md) (ROADMAP §1.3), coder TAMPON 25, effort medium. Base: `main` at
`ba1719c` (0.26.0 + K2). Everything below was run on this PC (Windows 11, VS Code stable, throwaway profiles).

## Verdict

- **Bugs:** the 10 known carry-overs plus 2 new ones (a second Windows flake, and *Workbench Layout* in Standard mode).
  11 of the 12 are fixed in this PR. The `windowFlows` flake (item 3) is still open. None needed a design decision.
- **Stale documentation:** every guide of testlabs 4–10 was stale (old VSIX pins, the default Standard mode that
  hides the views they use, renamed labels, Mongoku). The guides are updated; see "Testlab guides".
- **Extension host log:** the desktop runner now lists every error line of the extension host logs that mentions
  DataPass, for each fixture. No fixture run since then has logged a DataPass error. Two logged lines are harmless and are
  ignored by name (`BENIGN_HOST_LINE` in `scripts/desktop-test.ts`):
  - a tree refresh cancelled while the host shuts down;
  - a test's own `git` call writing Git's CRLF warning to stderr.
- **Open for ARCHI:** the `windowFlows` flake (item 3) is not fixed. One fix went in (the exports are serialised),
  and the new diagnostic assertion will say which side fails next time. More limits are listed under "Left open".

## Bugs and fixes

| # | Bug | Fix | Test |
|---|---|---|---|
| 1 | `src/adapters/fabric.ts` still said "Workspace MCP configuration" (D-22) | "MCP registration file present (.vscode/mcp.json)", and the detail says it proves nothing about a server | — (label) |
| 2 | Rewriting `.vscode/mcp.json` dropped its BOM: `TextDecoder` strips the BOM by default | The command decodes with `ignoreBOM`; `planMcpFileEdit` keeps a leading BOM and never adds one | `tests/mcp.test.ts` |
| 3 | Flaky Windows test `windowFlows` ("Papers — review" rename) | **Not fixed, still open.** Power Ops exports now run one after another (a real race, kept). But the final local run on this PC failed once more (the list still had "Papers — review" after the rename), while CI passed on Windows and Ubuntu. A diagnostic assertion now tells "the rename was not stored" (the input prompt was missed) apart from "the list lagged behind the stored rename" | desktop `v3-research` |
| 3b | **New:** flaky `activeVariantFlows` "back to current forgets the entry" (CI run 36254906579) | The switch no longer saves twice (its own preview event is ignored); saves of the selected variant are serialised | desktop `v25-doc-pipeline` |
| 4 | Readiness rows not filtered by the selected variant | Readiness uses the variant's repositories (C brings its planned `factory`). Rows only other variants use (env files, repositories and their checks) are hidden, with a "Variant: … · N rows of other variants hidden" line. `readinessForVariant` | `tests/readiness.test.ts`, desktop doc-pipeline |
| 5 | **MAJOR (D-23):** Copy Context named the current architecture's component with variant B selected | The owning component comes from the selected variant's map (`componentPlaces`, `src/core/exchange/fileContext.ts`), the same selection as the P1 stamp in the pack | `tests/fileContext.test.ts`; desktop: B selected → "Component: Blob-triggered Function" and a stamp naming B; testlab 10 step 4.2 |
| 6 | A sibling clone with no `origin` read "not cloned" | "folder <name> found, no remote: identity not verified" (or "its remote is another repository"), with the next step *Locate an Existing Clone…*. The folder is still never bound on its own | `tests/trustRepairs.test.ts`; testlab 10 step 6.1 |
| 7 | A new `.vscode/mcp.json` was picked up only by *Refresh Work View* | Workspace-file probes are re-read on every probe call (local, cheap). The CLI probes keep their 5-minute cache | desktop doc-pipeline; testlab 10 step 10.2 |
| 8 | E1's `KNOWN_MCP_SERVERS` lacked K2's five Microsoft servers | Five evidence cards. "installed" and "registered" are unknown with reasons (hosted by Microsoft, or extension not probed; no fixed server name) | `tests/evidence.test.ts` (every `mcp-server` of the registry has a card) |
| 9 | Board-card, preparation and Workbench packs not stamped (P1) | `stamp` in both builders; the commands pass `session.packStamp()` | `tests/board.test.ts` |
| 10 | Testlab 10's "0.27+" steps | Normal steps: 3.1 *Open a Client Project…* and 10.4 the E1 card, both in the lab suite. `ouvre-vscode-labo.ps1` lets Julian reach the lab's on-disk GitHub | testlab 10, 11/11 |
| 11 | **New:** *Workbench Layout* in Standard focused the hidden Project view first, unguarded: if VS Code refused, Architecture and Details never opened | Each focus is best-effort | desktop `v22-modes` |

The guard test in `tests/evidence.test.ts` (no credential path in `src/core/evidence`) now ignores dotted
registry ids such as `mcp.azure`; `~/.azure` and `.azure` still fail it.

## Testlabs, step by step

**Legend:**
- **PASS (lab)** — run by the testlab's own automated suite in real VS Code, against this branch.
- **PASS (desktop)** — the same behaviour is asserted by the desktop suite, in Advanced mode.
- **PARTIAL** — the desktop suite asserts part of it.
- **HUMAN** — no automated check; for Julian's eyes.

### Testlab 10 — client journeys (lab suite: 11/11 PASS)

| Step | Result |
|---|---|
| 1 prepare | PASS (lab: reset + setup, twice) |
| 2 client project works without DataPass | PASS (lab: test OK, script A runs, no DataPass file). The disabled extension on screen is HUMAN |
| 3.1 *Open a Client Project…* | PASS (lab): both native repositories cloned, `factory` never offered, workspace file written; the 2nd run (SSH address) clones nothing |
| 3.2 manual script | HUMAN (unchanged script) |
| 3.3 bridge opens, 2 repositories found (https = SSH) | PASS (lab) |
| 4 A → B → C | PASS (lab), including 4.2: B's component in the pack |
| 5 missing clone | PASS (lab) |
| 6 no origin | PASS (lab): "folder doc-orchestration found, no remote: identity not verified", then Locate → unverified |
| 7 uncommitted change | PASS (lab) |
| 8 unsupported tool | PASS (lab) |
| 9 files present, never ran | PASS (lab) |
| 10 MCP | PASS (lab): present after *Re-inspect Project* alone; `doc-tools` card: registered observed, the rest unknown |
| end: nothing written | PASS (lab) |

### Testlab 9 — modes, context, checks, versions, variants (lab suite: 12/12 PASS)

- Steps 2, 3, 4, 5 and 6: PASS (lab).
- Step 6 first failed on stale wording: it expected "not coded", but 0.25 (R-04) says "no files". The suite now accepts
  both, and the guide uses the new labels.
- Step 7 (toolkit): HUMAN, no lab suite; the toolkit is covered by the desktop `toolkitFlows`.

### Testlabs 4–8 — no lab suite: matched step by step against the desktop suite

| Lab | PASS (desktop) | PARTIAL | HUMAN (not covered) |
|---|---|---|---|
| 4 Workbench multi-repo | 3.2–3.3, 4, 5, 6 | 2a–2c, 3.1, 3.4, 7 | 2d ("Nothing selected") |
| 5 options | 3.2–3.3, 7.1–7.3, 10.1, 10.3–10.5 | 2, 3.1, 5.1 | 4 (diagram layout), 5.2, 6 (own combination), 8.1–8.2, 9 |
| 6 board / DevOps | A.5c, A.6, A.7, B.2–B.5 | A.2, A.3, A.8, B.6, D | A.4 (filters), A.5a–b, A.9 · Part C removed (Mongoku gone in 0.26) |
| 7 windows / views | 2, 3, 4–8, 10, 11 | 9 | — |
| 7a Git | 1, 3, 4, 5, 6.1–6.2, 8 | 6.3, 7, 9 | 2 (Restricted Mode) |
| 7b work orders | 3, 4.1–4.6, 4.9–4.12, 5.1–5.5 | 2, 4.7–4.8, 5.6 | — |
| 8 tools / connections | 2.1, 2.2, 2.4, 3.1–3.4, 5.1–5.4 | 2.3, 4.1, 4.3, 6 | 2.5, 5.5 (secret in `identifiers`), 7 (Databricks profile) |

The desktop suite (every fixture, final run on this branch) is the evidence for the "PASS (desktop)" column.

## Testlab guides updated (D:\PROJ\datapass-testlab)

- **Testlabs 4–8, section 0:**
  - install 0.26.0 or newer, not the pinned 0.13–0.20 VSIX;
  - switch to the mode the lab needs (DataPass, or Advanced for 6 and 7b), because Standard hides the Project view,
    the Work view, Galaxy and several Workbench tabs;
  - `reset.ps1` before `setup.ps1` when the lab exists already;
  - the texts renamed since the lab was written, per lab.
- **Testlab 6:** Part C (Mongoku frozen) is replaced by a note: Mongoku was removed in 0.26.
- **Testlab 9:**
  - install ≥ 0.26.0;
  - step 6 uses the 0.25 labels (files present / some files present / no files);
  - repaired the reference to `verification-claude\run.ts` (a stray CR had eaten `\r`).
- **Testlab 10:**
  - install ≥ 0.26.0 with V1-STAB;
  - 3.1 and 10.4 are normal steps;
  - 4.2, 6.1 and 10.2 say what the fixed build shows;
  - the "points found" are marked fixed;
  - new `ouvre-vscode-labo.ps1`: it opens VS Code with the lab's Git rewrites, only for that process.

## Left open (for ARCHI; not bugs of this pass)

- **Old example copies.** Labs 5 and 7 copy their example from `D:\PROJ\datapass-vscode\examples\v3`, a checkout at
  0.20.0 (detached HEAD) whose manifests still carry `modules.mongoku` (accepted and ignored). Updating that checkout
  is Julian's machine state, not this repository.
- **Labs 6, 7a, 7b and 8** also write `modules.mongoku` in their own setup or model manifests. It is harmless (a
  legacy module id, ignored).
- **A 0.26.0 VSIX.** There is no 0.26.0 VSIX file on disk (the newest is 0.25.0). The guides say "0.26.0 or newer"
  and install from a build; the 1.0.0-rc package will provide one.
