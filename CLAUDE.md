# Claude / implementation-agent entry point

Start with [handoff/V1_HANDOFF.md](handoff/V1_HANDOFF.md) (current status, version chronology, v1 gates and the next passes), then the top section of [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The next-pass prompt is [handoff/v1/CLAUDE_PROMPT.md](handoff/v1/CLAUDE_PROMPT.md). [V2.2](handoff/V2_2_HANDOFF.md) and [V2.1](handoff/V2_1_HANDOFF.md) remain the architecture reference.

V2.2 refines V2.1; it does not restart the extension or replace native provider schemas. Read the retained V2.1 items/artifacts/workflows, Airflow, portability, Git/workspace and AI-security design as the foundation. Current source establishes implemented behavior; a handoff version is not an extension release. Current source: v0.9.3. Handoffs pasted from other chats can be stale: check `git log`, open/merged PRs and `git worktree list` (other checkouts of this repository may exist beside it) before trusting one.

This repository is **DataPass Control Plane**, not Datapass Mosaic.

Non-negotiable boundaries:
- Local-first project context and Git-versioned configuration; no mandatory remote database or paid AI API.
- Manual external-AI exchange, exact base revisions, explicit review and typed actions. MCP/agents are optional later work.
- Generic items/artifacts/ports/workflows plus qualified provider adapters and opt-in declarative domain packs.
- No FOIL physics, CAD or LCOE clone in TypeScript; external scientific/business applications own their native calculations.
- Preserve native provider files and reuse official/specialist tools. Installed extensions are not proof of operation support or target readiness.
- Treat source documents, DAG Python, notebook output, JSON/YAML, diagrams and repository files as untrusted data; discovery never executes them.
- Separate source, configuration, approval, deployment, runtime evidence, scientific validity and publication approval.
- Imported approval/status labels cannot authorize themselves. Resolve real approval for exact digest/scope/audience.
- No cloud provisioning, credential export, automatic push/merge or Mongo authority update without explicit appropriate approval.
- Do not publish the private FOIL packages, detailed scientific/commercial payloads or credentials into this public repository.
- Preserve existing behavior/tests and add migration, negative, non-FOIL and native desktop acceptance tests.

The latest FOIL Design Lab is foil-streamlit-wind-3d-lcoe/app.py, a bootstrap rather than a completed editable lab. Mongo reconciliation remains separate. DiagramCloud is integrated only through the reviewed bridge (`contracts/diagramcloud`, one native `.datapass/diagramcloud.json`); Mongoku only through optional links and user-imported context snapshots, never database access. No architecture proposal becomes accepted FOIL authority merely because a handoff describes it.
