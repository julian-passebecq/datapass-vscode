# DataPass now — current entry point

Updated 2026-09-26. This page replaces the V1/V2/V3 handoffs as the place to start; those are in
[archive/](archive/) and remain the record of earlier passes. For the released version and what each
release changed, the sources of truth are the top of [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md),
[CHANGELOG.md](../CHANGELOG.md) and `git log` — handoffs pasted from other chats can be stale.

## What DataPass is

A single VS Code extension, the **DataPass Control Plane** (not Datapass Mosaic). A client AI prepares
a project in Git: a **bridge repository** (coordination repository) holds `.datapass/*.json` and lists
the **native repositories**, which keep their own code and native provider files. DataPass reads that,
shows the architecture first, lists the files each step needs and what is missing, opens the right
file or official tool, exchanges bounded context with the AI, and gets merged work with
Check / Get updates. It never deploys, pushes or runs project code.

Surfaces: four modes (Vanilla, Standard, DataPass, Advanced), the Project tree, the Architecture panel,
Details, the AI view (DataPass-guided / Agent / Manual), the Git view, the Workbench, work orders,
the toolkit catalogue, architecture variants (preview only). The user-facing overview is the
[README](../README.md); the French quick start is [docs/DEMARRER.md](../docs/DEMARRER.md).

## Read in this order

| Document | What it is |
|---|---|
| [PLAN.md](PLAN.md) | Versions V1 / V2 / V3 and the packages of the current release, with owners and status |
| [ROADMAP.md](ROADMAP.md) | The road to 1.0 and after (once merged; see PLAN.md meanwhile) |
| [v3/11_FOIL_MCP_REVIEW.md](v3/11_FOIL_MCP_REVIEW.md) | FOIL review of 0.24, decisions D-19 to D-28 |
| [v3/10_GLOBAL_IMPROVEMENT_PLAN.md](v3/10_GLOBAL_IMPROVEMENT_PLAN.md) | The global plan, decisions D-01 to D-18, features by version |
| [v3/09_AI_MODES_WORK_ORDERS_GIT.md](v3/09_AI_MODES_WORK_ORDERS_GIT.md) | AI modes, work orders, Git module, Claude & Codex panel |
| [v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md) | Toolkit catalogue, toolchain, agents |
| [v3/02_ARCHITECTURE.md](v3/02_ARCHITECTURE.md) | The V3 model (bridge repository, native repositories, the layer DataPass occupies) |
| [v3/04_NEXT_PASSES.md](v3/04_NEXT_PASSES.md) | Pass history and acceptance, testlab sections |
| [briefs/](briefs/) | Short decision briefs |
| [v3/night/](v3/night/) | Release notes of the night packages |

Contracts for preparing a project: [docs/PREPARING_A_PROJECT.md](../docs/PREPARING_A_PROJECT.md) and
the step-by-step [docs/guide/](../docs/guide/README.md). Still-valid reference: [ARCHITECTURE_LOCK.md](ARCHITECTURE_LOCK.md)
(product boundary), [SOURCE_MAP.md](SOURCE_MAP.md) (donor repositories), [DIAGRAMCLOUD_BRIDGE_V1.md](DIAGRAMCLOUD_BRIDGE_V1.md).

## Archived

[archive/](archive/): the V1, V2, V2.1 and V2.2 handoffs, their folders (`v1/`, `v2.1/`, `v2.2/`),
the pass 1 prompt and acceptance, and the superseded V3 documents (audit reconciliation, FOIL consumer,
sources, vision and readiness, windows and Power Ops, the V3 prompt). Old paths keep a one-line
redirect where something still links to them. V2.1 / V2.2 remain the design foundation of items,
artifacts, workflows and AI security; read them there when a decision refers to them.
