# DataPass IaC module — proposal for the V4 architecture (for Codex)

From PM DataPass 2, 2026-09-29, at Julian's request. Status: **product intent confirmed by Julian; architecture to be designed by Codex.** Read with `PM_REVIEW_2026-09-29.md` (same folder) and ADR-0004/0005/0007.

## 0. Intent (Julian)

Julian is a cloud beginner who wants DataPass to make real cloud work guided and safe. Fabric **platform management** (capacities, workspaces, lakehouses, role assignments, Git connection, environments) is today only reachable through the Fabric toolbox that DataPass lists (Fabric extension, Fabric Studio by Gerhard Brueckl, Fabric CLI `fab`, `fabric-cicd`, Fabric MCP servers). Infrastructure as code (Terraform / OpenTofu) is the reviewed, versioned route for the same objects, and it is what real Fabric teams use for the platform layer, with Fabric Git integration and `fabric-cicd` / deployment pipelines for item content.

Julian wants a **new module: DataPass IaC**, shipped as a **separate opt-in VSIX** (like Observe), that turns a Terraform/OpenTofu repository into an understood, checked, environment-aware part of the project architecture, and connects it to the data lineage and to the Fabric toolbox. It must **add** to DataPass, never change what exists.

Reference repositories (public, read them): `github.com/giancarllotorres/IaC-Fabric` (stacks `core/` = Azure RG + tfstate storage, `main/` = Fabric; `vars/tst|prd.tfvars`, `backend/tst|prd.backend.tfvars`, Azure DevOps YAML `pipeline-core/main/master.yml`; resources `fabric_workspace`, `fabric_lakehouse` bronze/silver/gold, `fabric_notebook`, `fabric_workspace_role_assignment`, providers `azurerm`, `azuread`, `azapi`, `fabric`) and `github.com/carlosacchi/microsoft-fabric-with-terraform` (modules `fabric-workspace`, `fabric-api`, `key-vaults`, `law`, `storage`; `data "fabric_capacity"`, `azapi_resource` of type `Microsoft.Fabric/workspaces`, `dev.tfvars`, `terraform.yml`).

## 1. It is additive — verified against the current code

The current project model already has a place for all of this; nothing in manifest v5 or graph 0.2 changes and existing bridges (FOIL, Codex Wind Lab) keep loading without migration:

| Where | Already there |
|---|---|
| `src/core/project/providers.ts:74` | provider `terraform` = "Terraform / OpenTofu" (and `bicep`) |
| `src/core/project/profiles.ts:145` | repository profile "Terraform / OpenTofu root": `*.tf` with role `infrastructure`, operation `infra.tofu.plan` |
| `profiles.ts:19,30` | file role `infrastructure` with operations validate / deploy |
| `src/adapters/infrastructure.ts` | detects `tofu` (declared route), `terraform` (optional), their VS Code extensions; "Copy tofu validate / plan" (copy only, never executed) |
| `schemas/datapass-project.schema.json` | `fabric`, `infrastructure`, `fabric-git-sync`, `fabric-workspace-git` |
| `schemas/datapass-graph.schema.json` | provider `terraform`, layer `infrastructure` |
| V4 architecture | packet A5 (bounded static Terraform/Bicep analysis, no module/provider fetch, no `plan`) |

So the module is: **an analyzer plugin + a declarative Fabric/Azure resource pack + optional additive fields + a VSIX surface.** The only shared prerequisite is the V4 identity model (see §3.3), which V4 needs anyway.

## 2. Module boundary

- **Name:** DataPass IaC (`datapass-iac` VSIX), opt-in, depends on the DataPass core extension API and on Common (semantic IR, evidence, analyzer host). Same module-registration contract as Observe (define it once for both: contribution points, lens registration, analyzer plugins, readiness rules, commands; palette classification per `src/core/experience/palette.ts`).
- **Owns:** HCL analysis (or configures A5 for it), the IaC resource packs, environment/stack model for IaC, readiness rules `IAC-*`, plan-JSON import, IaC views.
- **Does not own:** executing Terraform (never), cloud credentials (never stored), Fabric item content deployment (Fabric Git / `fabric-cicd` / deployment pipelines stay the route; DataPass links to them).
- **Tool choice per project:** `tofu` or `terraform` (setting + manifest field, default `tofu`); identical analysis, only the suggested commands differ.

## 3. Technical design (what Codex should specify)

### 3.1 Static HCL analysis
- Parser: Julian allows Python analyzers (even embedded): `python-hcl2` is a candidate; TS options (`tree-sitter-hcl` WASM, HashiCorp `hcl2json`-style WASM) as fallback/no-Python path. Pick with a golden corpus.
- Resolution rules: local modules (`source = "./modules/x"`) followed inside the repo; registry/Git modules = opaque node with `source` + `version`, never fetched; variables resolved per environment from `*.tfvars` (and defaults); `count` / `for_each` expanded only when literal after variable resolution, otherwise one node flagged `expansion: unknown`; `locals` evaluated only for literal expressions; anything unresolved is **shown as unresolved, never guessed** (same rule as the Airflow reader).
- Output per root: resources and data sources with address (`module.x.fabric_lakehouse.bronze`), type, provider, resolved literal attributes, references (implicit via expressions and explicit `depends_on`), outputs, required providers and versions, backend config.
- Discovery never executes: no `terraform init`, no provider plugin, no external data source, no `.terraform/` read.

### 3.2 Resource packs (declarative data, not code — modular, versioned with the provider version)
Map resource types to semantic kinds, icons, layers and diagram edges. First pack (verify names against the pinned provider versions; keep it data so new types need no release):
- **Fabric provider (`microsoft/fabric`)**: `fabric_workspace`, `fabric_workspace_role_assignment`, `fabric_workspace_git`, `data.fabric_capacity`, `fabric_lakehouse`, `fabric_warehouse`, `fabric_notebook` (with `definition` path), `fabric_data_pipeline`, `fabric_environment`, `fabric_spark_*` settings/pools, `fabric_semantic_model`, `fabric_report`, `fabric_eventhouse` / KQL, `fabric_connection`, `fabric_domain`, shortcuts, managed private endpoints.
- **Azure**: `azapi_resource` by `type` (`Microsoft.Fabric/capacities`, `Microsoft.Fabric/workspaces`), `azurerm_fabric_capacity`, `azurerm_resource_group`, `azurerm_storage_account` / `_container` (flag a container used as **state backend**), `azurerm_key_vault`, `azurerm_log_analytics_workspace`, role assignments.
- **Entra ID (`azuread`)**: service principals, groups, app registrations (identity nodes, never secrets).
- Later packs: Databricks provider (workspace, clusters, jobs, Unity Catalog), Power BI, Bicep equivalents.
- Medallion hint: names/tags like bronze/silver/gold map to layer badges (configurable, not hard-coded).

### 3.3 Identity and reconciliation (shared with V4 — the one core dependency)
One Fabric workspace can appear as: a `.tf` resource address, a Fabric Git folder / `.platform` `logicalId`, a workspace seen by `fab` / Fabric Studio, and an Observe reading. Define a **logical identity** `(provider, kind, stable name/key, environment)` separate from revision, plus typed aliases (`tf-address`, `fabric-logicalId`, `fabric-object-id`, `display-name`). Reconciliation must be explicit evidence, never inferred silently. This enables a **declared (IaC) vs observed (Observe) drift view** later.

### 3.4 Environments and stacks
- Environments from `vars/<env>.tfvars` + `backend/<env>.backend.tfvars` (or workspace names) → V4 **realizations** (ADR-0005): one architecture, tst/prd realizations with their resolved differences (SKU F2 vs F64, names, admins).
- Stacks: several roots in one repo (`core/` then `main/`) with an order; `terraform_remote_state` / outputs→variables become stack edges. Show the order in the diagram and in the guided steps.

### 3.5 Bridge to data lineage (high value)
`fabric_notebook.definition` points to a notebook file in the repo → the static PySpark lineage (Q3 decision) of that notebook → reads/writes of `fabric_lakehouse` bronze/silver/gold. So one view shows **infrastructure → items → code → data flow**. Same for `fabric_data_pipeline` definitions.

### 3.6 CI/CD pipelines that run Terraform
Read Azure DevOps YAML, GitLab CI and GitHub Actions statically: stages (init / validate / plan / apply) per environment, approvals/environments, service connection names (not secrets). Show them as the delivery path of the stack. Flag `-auto-approve` on production, apply without a prior saved plan, missing manual approval for prd.

### 3.7 Readiness rules `IAC-*` (stable diagnostic codes, evidence-based)
IAC-001 principal given as email where an Object ID is required (the "Invalid UUID" failure) · IAC-002 deploying service principal not in capacity admins ("Unable to find capacity") · IAC-003 Fabric tenant settings needed for service principals (call Fabric APIs, create workspaces) — cannot be read statically: shown as a checklist item the user confirms, or verified by Observe · IAC-004 capacity SKU/region availability (checklist + known list) · IAC-005 no remote backend or no state locking · IAC-006 `*.tfstate` or `.terraform/` committed (secret risk) · IAC-007 secrets literal in `.tf`/`.tfvars` (use Key Vault / variables) · IAC-008 providers not pinned (`required_providers`, `.terraform.lock.hcl` missing) · IAC-009 `-auto-approve` on prd · IAC-010 workspace declared without Git connection while the project says content is Git-synced (`fabric-git-sync`) · IAC-011 role assignments to individual users instead of groups · IAC-012 missing tags / naming convention (convention configurable per project) · IAC-013 things Terraform cannot manage yet (item-level access, some Git-sync steps) → hand-off to `fab` / Fabric Studio / `fabric-cicd`, never silently "done".
Rules are evidence records with origin (static / user-confirmed / observed / imported) per the review's origin field; a label in a bridge never self-authorizes.

### 3.8 Operations (DataPass never applies)
Copy/run-in-terminal commands chosen by the user: `init -backend-config=backend/<env>.backend.tfvars`, `fmt -check`, `validate`, `plan -var-file=vars/<env>.tfvars -out=<env>.tfplan`, `show -json <env>.tfplan > <env>.plan.json`. **Import the plan JSON** (user-produced) as evidence origin `imported`: exact create/update/delete per resource, shown on the diagram and in a plan diff view. `apply` stays with the user or the pipeline. State files are **not read by default** (they contain secrets); an optional, explicit "import state summary" would redact all sensitive attributes.

### 3.9 Security
Analyzer runs in the sandboxed analyzer host (no network, read-only workspace, timeout, JSON protocol). No provider/module download. Redaction of anything marked `sensitive`, of `.tfvars` values matching secret patterns, and of state content. No credential ever stored by DataPass.

### 3.10 VS Code surface (modular, configurable)
- An **IaC lens** in the left tree: stacks → environments → resources (grouped by kind).
- An **infrastructure layer** on the architecture diagram (toggle, legend, preset per experience mode), with capacity → workspace → items edges and the notebook→lakehouse lineage bridge.
- A **Hop-style view for a `.tf` file**: resources on the left, code on the right, cursor ↔ block sync (reuse the Hop grammar).
- **Plan diff view** from imported plan JSON (per environment).
- Readiness items in the Readiness lens with the `IAC-*` codes.
- Toolbox hand-offs: "open in Fabric Studio", "copy `fab` command", "`fabric-cicd` deploy" for what Terraform does not cover.
- Guided flow (Home task): "Prepare the Fabric platform": choose tool → check readiness → plan tst → review diff → run apply yourself → verify with Observe (optional).

### 3.11 AI and Prototype Cloud
- Work order to the client AI: "write/extend the Terraform for this architecture", with the resource pack as the vocabulary and the readiness rules as acceptance.
- Prototype Cloud (after DataPass V4): a chosen blueprint can emit a Terraform/OpenTofu skeleton through the same pack (emitters are code-generation: keep them outside the analyzers package, as the review notes).

### 3.12 Toolkit additions (catalogue entries, detected, never installed automatically)
`tflint` (+ azurerm ruleset), `checkov` / `trivy config` (static security scan; their SARIF output importable as evidence), `terraform-docs`, Azure Verified Modules as a reference source.

## 4. Additive contract changes (all optional)
- Graph node: `declaredBy?: { tool: "terraform"|"opentofu"|"bicep", root: string, address: string }`.
- Project manifest: `infrastructure.iac?: { tool: "tofu"|"terraform", roots: [{ path, stack?, order?, environments: [{ name, varFiles[], backendConfig? }] }] }`.
- Evidence kinds: `iac.static`, `iac.plan` (imported plan JSON digest + summary), `iac.scan` (SARIF), `iac.confirmed` (user-confirmed checklist item). All with the origin field and schema version.
- Diagnostic codes `IAC-001…` in the shared validator corpus.

## 5. Suggested work packets (each ≤ 30 M billed tokens, one coder conversation)
| Id | Packet | Depends on |
|---|---|---|
| IAC0 | ADR "IaC module": boundary, identity aliases, contracts above, parser choice | ADR-0003/0005 fixes, identity model |
| IAC1 | HCL static analyzer (roots, modules local/opaque, variables per env, references) + golden corpus | analyzer host, A5 (or IAC1 = A5 extended) |
| IAC2 | Fabric + Azure + Entra resource pack (data) + icons + layers | IAC1 |
| IAC3 | Environments/stacks → realizations; stack order edges | IAC1, ADR-0005 realizations |
| IAC4 | Readiness rules IAC-001…013 with diagnostic corpus | IAC2 |
| IAC5 | Plan JSON import + plan diff view | IAC2, evidence origin |
| IAC6 | Notebook/pipeline definition → lineage bridge | IAC2, static PySpark lineage |
| IAC7 | CI pipeline reading (ADO / GitLab / GitHub) | IAC3 |
| IAC8 | `datapass-iac` VSIX shell: module registration, IaC lens, diagram layer, `.tf` Hop view, palette | module contract (shared with Observe) |
| IAC9 | Synthetic fixture repo mirroring the reference patterns (core/main stacks, tst/prd, ADO YAML, deliberate readiness failures) + qa:ui journeys | IAC1–IAC8 |
| IAC10 | Julian's guided tutorial with screenshots + a mini project ("fabric-iac-lab": plan against a trial capacity; Julian runs apply himself) | IAC9 |

Placement: after the DataPass V4 core packets (identity, analyzer host, SQL/PySpark lineage), in parallel with or right after Observe, since both share the module contract. It must not become a prerequisite of the DataPass V4.0 release.

## 6. Questions for Codex
1. Is IAC1 an extension of A5 or its replacement? (A5 already bounds Terraform/Bicep analysis.)
2. One module-registration contract for Observe and IaC — where does it live (Common or DataPass core API)?
3. Parser: python-hcl2 in the analyzer host vs a WASM HCL parser — accuracy on `for_each`, dynamic blocks, heredocs, templates.
4. Identity aliases schema and reconciliation evidence — shared with the drift view (declared vs observed).
5. Plan JSON is large and may contain sensitive values: redaction and size limits before it becomes evidence.

## 7. Fake IaC data first — so Julian can really try it (Julian, 2026-09-29)

Julian wants to exercise the module on realistic but **synthetic** data before any real tenant, exactly like the Codex Wind Lab fake client. So the fixture moves from last (IAC9) to **first (IAC-FIX0)**, and every later packet is tested against it.

**IAC-FIX0 — `wind-lab-fabric-iac`**, a new synthetic repository of the Codex Wind Lab fake client (the client AI writes it, as for the other fake client repos; DataPass never writes client repos), plus its entry in `codex-datapass-bridge` (`.datapass/project.json` with `infrastructure.iac`, graph nodes with `declaredBy`).

Content (mirrors the two reference repos, all names/IDs fake, GUIDs obviously synthetic, no real tenant):
- `core/` stack: `azurerm_resource_group`, `azurerm_storage_account` + `azurerm_storage_container` "tfstate" (the state backend), `azurerm_key_vault`, `azurerm_log_analytics_workspace`, a Fabric capacity via `azapi_resource` (`Microsoft.Fabric/capacities`), outputs consumed by `main/`.
- `main/` stack: `data.fabric_capacity`, `fabric_workspace` ×3 (bronze/silver/gold, or one workspace with three lakehouses), `fabric_lakehouse` bronze/silver/gold, `fabric_notebook` ×2 whose `definition` points to real notebook files in the fake client's code repo (so the lineage bridge IAC6 has something to follow: bronze → silver → gold with `spark.read` / `saveAsTable`), `fabric_data_pipeline` ×1, `fabric_workspace_role_assignment` (group + service principal), `fabric_workspace_git` on one workspace only.
- A local module `modules/fabric-workspace/` and one registry module reference (opaque, never fetched).
- Environments: `vars/tst.tfvars` (F2, trial names) and `vars/prd.tfvars` (F64), `backend/tst|prd.backend.tfvars`.
- Pipelines: `pipelines/azure-devops.yml` and `.gitlab-ci.yml` with init/validate/plan/apply per environment.
- **Deliberate faults, one per readiness rule** (each documented in `EXPECTED_FINDINGS.md` with its `IAC-*` code, so tests assert them): an email instead of an Object ID (IAC-001), the SP missing from capacity admins (IAC-002), a `terraform.tfstate` committed in an `old/` folder with fake values (IAC-006), a literal fake secret in `tst.tfvars` (IAC-007), one provider without a version (IAC-008), `-auto-approve` on prd (IAC-009), a Git-synced workspace without `fabric_workspace_git` (IAC-010), a role assignment to a single user (IAC-011), a `for_each` over an unresolved variable (must show "unresolved", never guessed).
- **Two saved plan JSON files** (`evidence/tst.plan.json`, `evidence/prd.plan.json`), synthetic, in the real `terraform show -json` format (creates, one update, one destroy on prd), with one `sensitive` value to prove redaction.
- A `README.md` that says in plain words what the fake platform is, and a `TRY_IT.md` for Julian: open the workspace, open the IaC lens, see tst vs prd, read the findings, open the plan diff, follow a notebook from its `.tf` resource to the gold lakehouse.

Tests on top: golden analyzer outputs per stack/environment, the `IAC-*` diagnostic corpus, qa:ui journeys (IaC lens, diagram layer, plan diff, `.tf` Hop view, lineage bridge), and the release-candidate tutorial with screenshots taken on this fixture. Optional later: a "real trial" variant where Julian runs `tofu plan` himself on a Fabric trial capacity (still no apply by DataPass).

Updated order: **IAC-FIX0 → IAC0 → IAC1 → IAC2/IAC3 → IAC4 → IAC5/IAC6 → IAC7 → IAC8 → IAC10** (IAC9 becomes the qa:ui journeys on the IAC-FIX0 fixture).
