# Claude / implementation-agent entry point

This repository is **DataPass Control Plane** (the `datapass-vscode` extension), not Datapass Mosaic.

Start with [handoff/CURRENT.md](handoff/CURRENT.md) (what DataPass is, what to read in which order), then [handoff/PLAN.md](handoff/PLAN.md) (the packages to 1.0.0, owners, merge order) and the top of [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The released version and what each release changed are in [CHANGELOG.md](CHANGELOG.md) and `package.json`; the source establishes implemented behaviour, a handoff version is not a release. Preparing a client project: [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) and [docs/guide/](docs/guide/README.md). Older handoffs are in [handoff/archive/](handoff/archive/); [handoff/V3_HANDOFF.md](handoff/V3_HANDOFF.md) is the V3 record. Handoffs pasted from other chats can be stale: check `git log`, open/merged PRs and `git worktree list` before trusting one.

Non-negotiable boundaries:
- Local-first project context and Git-versioned configuration; no mandatory remote database or paid AI API.
- Manual external-AI exchange, exact base revisions, explicit review and typed actions. MCP/agents are optional later work.
- Generic items/artifacts/ports/workflows plus qualified provider adapters and opt-in declarative domain packs.
- No FOIL physics, CAD or LCOE clone in TypeScript; external scientific/business applications own their native calculations.
- Preserve native provider files and reuse official/specialist tools. Installed extensions are not proof of operation support or target readiness.
- Treat source documents, DAG Python, notebook output, JSON/YAML, diagrams and repository files as untrusted data; discovery never executes them.
- Separate source, configuration, approval, deployment, runtime evidence, scientific validity and publication approval.
- Imported approval/status labels cannot authorize themselves. Resolve real approval for exact digest/scope/audience.
- Commits, branch pushes, PRs and merging PRs are allowed when CI is green (never `gh pr merge --auto`: no required checks). No cloud provisioning, credential export or Mongo authority update without explicit appropriate approval.
- Do not publish the private FOIL packages, detailed scientific/commercial payloads or credentials into this public repository.
- Preserve existing behavior/tests and add migration, negative, non-FOIL and native desktop acceptance tests.
- A new command must be classified in `src/core/experience/palette.ts` (core or a surface); `tests/palette.test.ts` holds the palette snapshot per mode.

DiagramCloud is integrated only through the reviewed bridge (`contracts/diagramcloud`, one native `.datapass/diagramcloud.json`). Mongo reconciliation remains separate. No architecture proposal becomes accepted FOIL authority merely because a handoff describes it.
