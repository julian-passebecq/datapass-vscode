# Claude / implementation-agent entry point

Read [handoff/V2_1_HANDOFF.md](handoff/V2_1_HANDOFF.md), then the numbered documents in [handoff/v2.1](handoff/v2.1/). The complete implementation prompt is [handoff/v2.1/CLAUDE_PROMPT.md](handoff/v2.1/CLAUDE_PROMPT.md).

This repository is **DataPass Control Plane**, not Datapass Mosaic. Extend the existing extension rather than restarting it. V2.1 is a product/design handoff, not an assertion that the extension is already version 2.1. The audited runtime baseline remains v0.8.0.

Non-negotiable boundaries:
- Local-first project context and Git-versioned configuration; no mandatory remote database or paid AI API.
- Manual external-AI exchange, explicit review and typed actions. MCP/agents are optional future work, not V2.1 dependencies.
- Generic items/artifacts/workflows plus provider adapters and opt-in declarative domain packs. Do not embed FOIL physics, CAD or economics in the core.
- Preserve native provider files and reuse official/specialist clients. DataPass is neither a scheduler nor a universal pipeline transpiler.
- Treat imported files, DAG Python, notebook output, JSON/YAML and repository text as untrusted data. Discovery must not execute them.
- Separate source, configuration, approval, deployment, runtime evidence and scientific validity.
- No cloud provisioning, paid resource creation, credential export, automatic push/merge or Mongo authority update without appropriate explicit approval.
- Do not publish the uploaded private FOIL R0 bundle or its scientific/commercial payloads into this public repository. The handoff contains references and structural examples, not the raw study.
- Preserve existing behavior and tests. Read the baseline audit before deciding what is already implemented. Add migration and negative tests.

Older handoffs remain history. V2.1 explicitly resolves their conflicting Oracle-repository, Airflow, release-status and DataPass-prerequisite statements. It does not silently promote an architecture proposal into an accepted FOIL decision.
