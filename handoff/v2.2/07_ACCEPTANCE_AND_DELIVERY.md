# 07 — implementation order, UX, security and acceptance

## Build order: avoid turning this review into another rewrite

| Pass | Deliverable | Exit criterion |
|---|---|---|
| A | Audit current v0.8 code and migrate a synthetic v1 project in memory | Existing tests preserved; original manifest recoverable; no live service needed |
| B | Shared identity/ref/contracts, remote-only repo/App and private local session | Works for FOIL-shaped and retail BI fixtures; no hard-coded client logic |
| C | Manual request/result and plan review, exact base digests, artifact validation | Wrong revision/scope/input/result rejected; file edits do not authorize execution |
| D | Task-specific capability/preflight and one native Fabric/Databricks/Airflow path | Correct tool route and prerequisites; optional agent tools do not degrade manual workflow |
| E | FOIL domain-pack forms, dependency facets and Programme projection | Budget versus geometry invalidation demonstrated; no second scientific kernel |
| F | PublicationBrief and DiagramCloud projection | Audience/source restrictions and native mapping checked; no auto-publication |
| G | Optional imported authority snapshots and then qualified read connector | Partial/stale/unauthorized states visible; no database write path |
| H | Exact cloud target acceptance | Account/OS/extension version, entitlement, network, configuration, bounded run and receipt all verified separately |

Claude can combine passes, but must not install/provision every provider simply to make all cards green. Focus the first vertical slice on the selected FOIL experiment workflow. Preserve V2.1 Airflow and portability requirements; use bounded migration assessment, not arbitrary transpilation.

## Suggested code separation (illustrative, adapt to current source)

- `core/model`: project/item/artifact/port/source/revision/observation types and schemas.
- `core/policy`: scope, action, publication and retention decisions.
- `core/exchange`: bounded parsing, base comparison, delta preview, staging and receipts.
- `core/impact`: dependency-facet graph and stale analysis.
- `adapters`: native operation capabilities, not company physics.
- `domainPacks`: reviewed declarative schemas/forms/templates.
- `views`: work scope, inputs/outputs, checklist, tool status and collapsible AI panel.
- `integrations`: optional authority snapshots and DiagramCloud mapping.

Keep the vendor file the source of native semantics. Shared types must not flatten all parameter/runtime/trigger semantics into a lowest-common-denominator pipeline language.

## UX: minimal normal path, depth when needed

Default work panel: project/scope/version + objective + next prerequisite + checklist + Inputs/Outputs + Open native tool. A collapsible detail area shows source age, hashes, native versions, operation capabilities, missing identities and evidence limits. A Programme tab adds the broader business/research picture without crowding the daily cloud workflow.

AI panel presets: Current task; Missing prerequisites; Problems; Selected contract; Programme summary; Publication brief. Preview bytes/source count/omissions and redacted fields before Copy or Save. Keep clipboard import, file import and staged review one click away; do not export the same giant project dump for every preset.

The user can mark Done/Blocked/Problem/Skipped and add a short note. A checked task is user-reported progress, not proof that a runtime is correct. Show the receipt/evidence separately. External detailed how-to remains in chat; native actions show a short next step and fallback.

## Security and reliability requirements

### Inbound data

Bound bytes, nesting, collection sizes and parser resource use. Reject duplicate JSON keys, nonfinite numbers, unsupported schema versions, unexpected fields and YAML custom tags/alias explosions. Unknown native extensions may be preserved as opaque data only when the contract explicitly permits them; never execute them. Labels, sources, documents, notebook output, SVG/XML and messages are untrusted data.

### File and operation review

Use workspace/provider URI-aware resolution; reject traversal, unauthorized roots, symlink escapes and unexpected absolute paths. Do not treat remote VFS URIs as local `fsPath`. Classify executable setup files such as tasks.json, launch.json, devcontainer.json, MCP config and package scripts as high-risk proposals, not ordinary text whose installation/run is automatic.

Approval attaches to the exact selected delta and base state. Changed selection or changed source invalidates approval. Stage and revalidate before apply. Multi-file writes need a recovery journal; multi-repo work is not a global atomic transaction. Preserve backups and report partial application. Never auto-push, auto-merge, stash or discard dirty user work.

### Cloud execution

Use qualified typed actions and controlled argument vectors, not free shell strings supplied by AI. Some source validators import/execute code or require network; label them accordingly. Discovery must not import DAG Python, evaluate notebook code or run Terraform/provider plugins without a deliberate action.

Verify actual target identity/resource/environment again at execution. A DataPass scope cannot enforce peer-extension IAM. A missing or stale account/capacity/budget is a prerequisite to resolve. Review defaults, activation side effects, quotas, retention, rollback and teardown before deploy. Do not interpret developing an adapter as permission to create billable resources.

### Native client coexistence

Coordinate file reload/save with Power BI Desktop and other clients. Respect virtual workspaces and local/remote extension-host placement. Do not globally rewrite extensionKind or workspace trust. Native editor commands/APIs must be capability-probed for the installed version with a safe manual fallback.

### Shared resources and locks

One active work scope per window remains. Local scope locks are advisory and host-scoped; stale PID alone is not sufficient across remote hosts/profiles. Use owner nonce/lease/recovery logic and explicit takeover. Wind/Hydro may read the same VM while editing distinct workload configs. A host reboot affects both and needs a separate shared-resource warning/approval; do not promise conflict prevention across all external clients.

### Performance

Lazy adapter activation, bounded file watchers, debounced refresh, cached tool probes with timestamps and explicit network refresh. No permanent expensive CLI sweeps, live telemetry warehouse inside the extension or background cloud crawling. External workloads continue when VS Code closes.

## Acceptance matrix

| Test | Expected result |
|---|---|
| Synthetic retail project without FOIL pack/Mongo | Same inputs/outputs, BI and AI exchange works |
| Remote-only Streamlit repo changed in GitHub | New observed revision, no forced clone/pull or false deployed status |
| Result for wrong project/base/input/request bytes | Reject or quarantine, preserve current state |
| Budget-only case edit | LCOE/report/brief stale; geometry CAD retained only when dependencies confirm it |
| Geometry or pose edit | Relevant CAD/2D/model outputs stale; historical receipts retained |
| Unknown dependency facet | Conservative stale state, not optimistic green |
| Fabric notebook task without Copilot/MCP/FabricStudio | No false missing prerequisite for unrelated optional tools |
| Fabric VFS file | No accidental local-path write; correct native handoff |
| PBIP model rename / unsupported report format | Impact and supported-edit check; no silent conversion/overwrite |
| RTI deploy preserving a paused source assumed | Warning/block: target activation is possible; rebind and budget reviewed |
| Airflow Git-Sync plus incompatible identity mode | Explicit unsupported/needs-config state, not generic Ready |
| Grafana dashboard Git Sync with missing datasource | Datasource configuration remains a separate prerequisite |
| Mongo native Playground supplied by AI | Never automatic execution; optional bounded query path only |
| Snapshot unauthorized/partial/stale | States and coverage retained; no empty-success fiction |
| DiagramCloud private defaults/unknown fields | Fail closed or create reviewed supported projection; never silent publication |
| PPTX/website from internal brief | Candidate output, not publication-authorized; source/claim restrictions retained |
| Interrupted staged import | Recoverable journal; no half-promoted accepted state |
| Close VS Code | Cloud scheduler/application keeps operating independently |

Unit/schema tests cannot prove cloud, desktop, scientific or public-content correctness. Maintain test evidence per exact capability tuple and revision. Retain skipped tests and reasons in reports rather than calling a partially skipped CI run full qualification.
