# 07 — project/workspace UX, Git and persistence

## 1. Daily interface, not another admin dump

Keep the useful v0.8 health-first Galaxy behavior. Reorganize around what the user is doing:

```text
FOIL > Wind > Experiment preparation     architecture: R0 proposal

TODAY: one objective, blockers, next step
PROJECT: flexible tree and compact architecture
ITEMS: Workflows | Notebooks | Apps | Artifacts | Resources
DETAIL: source, parameters, bindings, evidence, native tool
AI EXCHANGE [collapsible]: preview/copy/import
```

A central editor-sized detail panel can coexist with a compact sidebar. Use progressive disclosure: the selected case/workflow gets space; advanced provider details are collapsed. Do not make all cards equal-sized or force tiny diagrams into the sidebar. Respect VS Code theme tokens, keyboard navigation, screen readers and light/dark themes. Do not introduce a new UI framework just for branding if the existing implementation suffices.

## 2. One workspace per window, not one technology

A workspace is the user's configured work boundary, potentially containing related Airflow, Fabric, Databricks and app items. Several editor tabs are allowed. The same logical workspace should normally be exclusive among DataPass-controlled local windows.

Use stable project/workspace IDs, not labels, for locks. A local atomic lock/lease includes session identity, host identity, owner process and heartbeat. Handle stale locks, process reuse, crash recovery and explicit takeover. Release best-effort on shutdown; never rely solely on a close event.

Remote SSH/containers complicate storage: an extension may run remotely while VS Code UI is local. Define what host/registry owns exclusivity and test it. Do not advertise cross-machine or cross-remote-host global locks without a coordinator. V2.1 can enforce local-host managed-session exclusivity and clearly warn when the boundary cannot be verified.

The extension cannot forbid the user opening a cloud resource manually in another official extension. This is a DataPass workflow policy, not an IAM/security boundary.

## 3. Git: provider-neutral, repository-specific

A repository descriptor supports a canonical remote URL, provider, tracked ref, observed commit/time, optional local clone/worktree, ownership/classification and relevant paths. Remote-only is a valid state; users develop some apps through ChatGPT/GitHub without opening a local clone.

Show local clean/dirty/ahead/behind only when actually observed. An unavailable credential is not an empty repository. A commit discovered remotely is not a deployed application. Preserve separate CI and runtime evidence.

Multi-provider support means ordinary Git remotes can point to GitHub, Azure Repos, GitLab or another server. Specialized PR/CI operations require their own supported client/adapter. The FOIL historical governance currently uses GitHub code authority; supporting Azure DevOps does not silently migrate that authority. Azure DevOps may be a runner while source stays in GitHub.

Do not force a monorepo, clone, checkout, pull, merge or push just by selecting a scope. Prepare a workspace proposal and show changes. Two windows changing branches in the same working tree is unsafe even if their DataPass scopes differ: reuse explicit separate worktrees or block conflicting branch operations.

## 4. Durable configuration versus local state

| Data | Owner/storage |
|---|---|
| Core extension source, tests, descriptors | This repository / built VSIX |
| Project items, schemas, native config, reviewed plans/templates | Owning Git repository |
| Native provider runtime, schedules and actual runs | Provider/runtime |
| Current UI layout, selected scope, caches, local session | VS Code state/storage |
| Shared local session registry | Explicit local lock storage, not synced settings |
| Credentials | Vendor auth/SSH/vault/SecretStorage |
| CAD, Parquet, large reports | Approved artifact/object/Git LFS storage; metadata references in graph |
| FOIL accepted facts, business backlog, architecture decisions | Existing owning FOIL authorities |

Use `workspaceState`, `globalState`, `storageUri` and `globalStorageUri` deliberately; selected preferences can opt into Settings Sync, but process/session locks and machine paths must not sync. SecretStorage is encrypted and does not provide a general cross-device password vault. [S11]

The VSIX contains application code, not the user's project data. An upgrade must preserve/migrate user state, not reset it or embed private configs into packaging. A new machine can clone reviewed project configuration and rebind local paths/auth separately.

Keep transient daily notes local by default with explicit export/commit options. Durable accepted plans/checkpoint receipts can be saved by user choice and linked to external work items. Do not commit every UI click or create a duplicate FOIL backlog.

## 5. Quick access and setup management

Per scope, show typed links to native workspaces, provider consoles, Git/CI, production/staging apps, Grafana folders, Airflow UI, OCI, IAM/billing and documentation. Links inherit through project/resource bindings but retain their actual owner and environment.

For unknown setup, show `Not configured`, not a fabricated URL or ID. Include 'why required', a concise next action, an official tool link and 'Copy missing prerequisites'. Prefer explicit vendor login and least-privilege scopes. Never ask the user to paste passwords into the AI exchange.

Environment panel: template path, actual local/runtime target, required names, source of presence observation, missing values, secret-reference status and freshness. A local `.env` existing does not prove the remote pod uses it. Show per-Wind/per-Hydro profiles even on a shared VM.

## 6. Practical AI exchange panel

One collapsible panel with two tabs:

**Export:** selected scope, intended task, context size, included artifacts, exclusions/redactions, preview; buttons Copy context, Copy blockers, Copy progress, Export file.

**Import:** paste/file input, detected format/protocol, base-revision status, proposed checklist and file changes, warnings/unsupported actions, diff, selection and Approve selected changes.

No code execution on paste. No automatic clipboard read on every focus event. Use VS Code clipboard/file APIs so local/remote behavior is deliberate. Show human-readable summary alongside JSON/YAML, not a wall of raw schema by default. Detailed guidance remains in external ChatGPT/Claude; screenshots can be shared there after privacy review.

## 7. Start work checklist

`Select objective → preflight → resolve blockers → open tool → execute explicitly → record result/problem → export progress`.

Each checklist item has a stable ID, label, status, note, related item/artifact/action and optional `externalWorkItemRef`. User statuses: todo, doing, done, blocked, problem, skipped. Attach observed proof separately from user completion.

Example:
- Verify case bundle hash.
- Confirm approved development account and capacity.
- Confirm image/runtime compatibility.
- Open the Airflow DAG or official Fabric/Databricks tool.
- Run the approved bounded workload.
- Inspect receipt and artifact outputs.
- Record a failure note and copy a redacted diagnostic package if needed.

Avoid a huge built-in tutorial system, kanban board, story points or velocity charts. The extension keeps structure and progress; AI explains the detailed steps.

## 8. Architecture and feature versions

Architecture, project milestone, domain-case revision, provider binding revision and source commit are different. Preserve version identity in exports. Feature matrices should split:

- planned inclusion per architecture version: included / excluded / deferred / undecided;
- implementation evidence: absent / prepared / partial / source-tested;
- observed deployment/runtime status and date.

This prevents illustrative 'Yes in v2' from becoming 'verified in production'. Historical snapshots are immutable; `current` is a pointer with explicit acceptance criteria. A change affecting shared resources shows both Wind and Hydro impact.

## 9. Native tools and handoff details

Use installed extension capability/command discovery with verified supported command IDs. Do not invent command names or rely on private undocumented APIs without a fallback. 'Open' may focus a view or browser console, not necessarily deep-link to the exact item if the vendor API cannot do that; label the limitation honestly.

Fabric composes official Microsoft tooling, Fabric CLI/cicd, curated `microsoft/fabric-toolbox`, and optional FabricStudio/OneLake-VSCode. Databricks stays official extension + CLI + DAB. Airflow uses its native UI, deployment tools and API where supported. OCI uses SSH/Remote SSH and existing ReactOracle/IaC paths. Grafana stays hosted and as-code, with native provider permissions.

DataPass should expose what it knows and what it cannot yet operate. Unsupported actions are disabled with an explanation, not fake buttons.

## 10. Observability and resources

Preserve hosted Grafana bindings, dashboards-as-code, datasource/auth refs, preview/plan/deploy boundaries and relevant run links. Separate infrastructure/runtime monitoring from Power BI/Streamlit scientific/business reporting.

For VM/IaC, distinguish desired manifest from actual observed machine shape, CPU architecture, free RAM/disk, workload limits and cost approval. Resource-envelope estimates must be labeled estimates and tied to scenario/measurement sources. Docker/K3s containers, Airflow database, logs, volumes and outbox all consume resources; an empty extension doesn't make them free.

Keep the V3 free-tier/reference-architecture guide independent from current projects. Instantiating a sample into a real project is a reviewed operation, not automatic provisioning. Mongoku's future snapshot is a separate read model; see the deferred note.
