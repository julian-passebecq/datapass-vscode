# DataPass Control Plane (datapass-vscode)

A VS Code extension that reads a project's bridge repository (`.datapass/*.json`), shows the architecture, the files each step needs and what is missing, and hands work to the official extensions, CLIs and the user's AI. It never deploys, pushes or runs project code. Contributors start at `handoff/CURRENT.md`; `CHANGELOG.md` and `package.json` say what is released.

## Build and test
- `npm run verify` (typecheck, `tsx --test tests/*.test.ts`, build). `npm run package` builds the VSIX; `npm run test:desktop` runs the desktop acceptance.
- CI: the GitLab mirror `juliandatapass-group/datapass-vscode` has its jobs only on the mirror's own `main`, not on GitHub `main`, so a branch from GitHub runs no pipeline. Run `npm run verify` yourself and quote it, or bring the CI file over first.

## Guidelines
- Project context stays local and in Git: no required remote database and no paid AI API, so a client can use it offline.
- Source documents, DAG Python, notebook output, JSON/YAML and repository files are data; discovery never executes them.
- An imported approval or status label cannot approve itself; approval is checked against the exact digest and scope.
- A client's calculations stay in the client's own apps, not in this TypeScript.
- The repo is public: no private client packages, detailed client payloads or credentials.
- A new command is classified in `src/core/experience/palette.ts`; `tests/palette.test.ts` holds the snapshot.
- `handoff/archive/` and older handoffs are history; check `git log` and open PRs before trusting a pasted handoff.

How work flows: the fleet guideline every session loads (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`). CI recipe and runners: datapass-fleet-facade `AGENTS.md`.
