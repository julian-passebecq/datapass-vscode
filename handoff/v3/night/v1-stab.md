# V1-STAB — stabilisation sweep (TAMPON 25, 2026-09-26)

Full report: [handoff/v1/STABILISATION.md](../../v1/STABILISATION.md): every testlab step PASS / PARTIAL / HUMAN,
bugs and fixes.

## What changed (code)
- `src/adapters/fabric.ts`: label "MCP registration file present (.vscode/mcp.json)" (D-22).
- **BOM:**
  - `src/core/mcp.ts` `planMcpFileEdit` keeps a leading BOM;
  - `src/core/actions.ts` decodes the file with `ignoreBOM`.
- `src/core/evidence/integrations.ts`: the five K2 Microsoft MCP servers get evidence cards; `registrationReason`.
- **Copy Context follows the selected variant (D-23):**
  - `src/core/exchange/fileContext.ts` gets `componentPlaces(map)`;
  - `src/work/fileContextCommands.ts` uses the selected variant's map.
- **Readiness follows the selected variant:**
  - `src/core/readiness/readiness.ts` gets `readinessForVariant` and `Readiness.variant`;
  - `src/work/session.ts` `readiness()` uses the variant's repositories and hides rows only other variants use;
  - `src/views/projectTree.ts` shows the "Variant: … · N rows of other variants hidden" line.
- **A same-name sibling with no or another origin is named:**
  - `src/core/project/resolve.ts` gets `RepoObservation.nearby` and the wording "folder X found, no remote: identity
    not verified";
  - `src/work/projectObserver.ts` fills `nearby`, and never binds the folder.
- `src/core/capabilities/probe.ts`: workspace-file probes (`.vscode/mcp.json`) are re-read on a cache hit.
- **Packs stamped:** `src/core/project/{boardPack,preparation}.ts` take a `stamp`, and the commands pass `packStamp()`.
- `src/work/windowCommands.ts`: Power Ops exports are serialised (the rename race of the `windowFlows` flake).
- `src/work/activeVariantCommands.ts`: a switch ignores its own preview event; saves are serialised (the second flake).
- `src/work/workbenchCommands.ts`: *Workbench Layout* focuses each view best-effort (the Project view is hidden in
  Standard).
- `scripts/desktop-test.ts`: per fixture, lists the extension host log's error lines that mention DataPass, minus
  two known harmless patterns.

## Tests added
- **Unit:**
  - `mcp` (BOM kept, never added);
  - `evidence` (a card for every registry `mcp-server`);
  - `readiness` (`readinessForVariant`);
  - `trustRepairs` (the nearby wording);
  - `board` (card and preparation stamps);
  - `fileContext` (component from the variant's map).
- **Desktop:**
  - `activeVariantFlows`: B's component and stamp in the pack; `factory` in Readiness only under C;
  - `evidenceFlows`: *Re-inspect Project* sees a new `mcp.json`;
  - `experienceFlows`: *Workbench Layout* in Standard.

## Testlabs (outside this repository, D:\PROJ\datapass-testlab)
- Lab 10 suite: 11/11 (steps 3.1 and 10.4 new, `run.ts` passes the lab's Git rewrites).
- Lab 9 suite: 12/12 (accepts the 0.25 coding labels).
- Guides 4–10 updated (install, mode, labels, Mongoku); new `10-parcours-client\ouvre-vscode-labo.ps1`.

## Decisions taken alone
- Readiness hides only env files and repositories (and their checks) used only by other variants; toolchain and
  connection rows are project-wide and stay.
- A same-name sibling whose origin is another repository gets the same "identity not verified" wording, and is still
  never bound.
- **Item 3 is still open.** The final local run failed once more after the export serialisation.
  - `windowFlows` now asserts the stored name first. If "rename not stored" fires, the input prompt was missed (UI
    timing); otherwise the list lagged behind the rename.
  - The flake of item 3 had no surviving CI log. The fix targets the race the code allows (two concurrent exports);
  if it comes back, the next suspect is the open-view request watcher firing late.
