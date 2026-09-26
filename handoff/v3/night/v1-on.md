# V1-ON — Open a Client Project (night note, 2026-09-26)

ROADMAP §1.3 package V1-ON. Coder: TAMPON 20, effort medium.

## What landed

- **DataPass: Open a Client Project…** (`datapass.openClientProject`, `src/work/openClientProject.ts`): paste the bridge's Git address (GitHub, Azure DevOps, GitLab; https or SSH) → choose a parent folder → the bridge is cloned (or its existing clone reused) → its `.datapass/project.json` is read → the declared repositories that are missing are offered in a checkbox list with their role (description), ticked by default except `remote-only` → cloned one at a time → the company workspace file (0.17 format, `buildCompanyWorkspace`) `<parent>/<project title>.code-workspace` is written → opened. Standard mode then lands on the Architecture panel (0.22 landing, unchanged).
- **Clone plan** (`src/core/project/cloneplan.ts`, pure): present / clone / planned / no-remote / conflict. A clone is located by remote identity (`remoteIdentity`: https ≡ SSH, the five Azure DevOps forms) among the parent's sub-folders and the expected folders, whatever its folder name. Planned repositories are never cloned; a folder holding another repository or plain files is never cloned over; a declared path outside the chosen folder is not cloned (clone it yourself); one clone is never claimed by two declarations.
- **Idempotent**: a re-run finds everything present, asks nothing, leaves the workspace file byte-identical (keeps company name, colour, startup view, other settings of an existing file).
- **Failures**: the first failed clone stops the run with Git's / the host's own message (progress lines stripped) and a **Retry** (modal); a sign-in refusal adds how to sign in. An empty folder left by a failed clone is removed so Retry can clone again.
- **Welcome**: "Open a Client Project…" in the empty Explorer (`workbench.explorer.emptyView`) and in the Project view of an empty window.
- **Walkthrough** "Get started with DataPass" (`datapass.getStarted`, `resources/walkthrough/*.md`): open a client project, the architecture, a file → context for my AI, Get updates, switch mode.

## Choices (logged in effort-board/questions.md)

- `git clone` runs through the resolved Git executable (`executablePath`, as the Git module does) with `GIT_TERMINAL_PROMPT=0` but **without** `GCM_INTERACTIVE=never` (the observer's setting), so Git Credential Manager can show its own sign-in window on a first clone. DataPass reads and stores no credential.
- `remote-only` repositories are listed but unticked (the manifest says they are never cloned automatically; ticking them is the person's choice).
- A clone found under another folder name is used as is (the company workspace lists it as a root, so the project observer finds it as a workspace folder).
- From an empty window the workspace opens in that window; otherwise a new window (the Test-mode folder seam records it).

## Tests

- Unit `tests/cloneplan.test.ts` (12): planned skipped, SSH/https equivalence, Azure DevOps `dev.azure.com/org/project/_git/repo` ≡ `org@vs-ssh.visualstudio.com:v3/org/project/repo` (and the other forms, both directions), conflicts, declared paths, bridge declared among repositories, re-run, address parsing, auth failure detection.
- Desktop fixtures `v26-open-client` and `v26-open-client-window` (`scripts/desktop-test.ts`), flows `tests/integration/openClientProjectFlows.ts`: "GitHub on disk" = bare repositories in a temp folder, real addresses rewritten by `url.<base>.insteadOf` (GIT_CONFIG_* env of the test host), so clones keep `https://github.com/...` / `https://dev.azure.com/...` origins. One command → bridge + pipeline cloned, lab found in `my-lab` (SSH origin), portal (planned) never cloned, workspace file with 3 roots, opened; second run (SSH address of the bridge) clones nothing and leaves the file unchanged; a failing clone shows Git's message and Retry; the opened workspace has the 3 roots and lands on Architecture in Standard. 4/4 pass locally.

## Release notes (for the release coder)

- New: **DataPass: Open a Client Project…** — from the bridge repository's Git address to a company window in one command (clones what is missing, finds what is already here, never clones planned repositories).
- New: walkthrough **Get started with DataPass** (Help → Welcome → Walkthroughs).

## Left

- V1-T10 testlab journey "open from bridge" can now use the command.
- Not done (out of scope): choosing a title-bar colour or startup view during the command (the company workspace command still does that).
