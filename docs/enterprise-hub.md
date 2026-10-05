# Enterprise / Portfolio / Project Hub

The Hub projects existing project manifests, catalogs and local WorkOrders. It stores only view preferences and selected scope in VS Code workspace state. Git, host CI, agent reports and person-reviewed evidence keep separate origins. A declared release or BOM qualification never means that a cloud deployment was verified.

Open **DataPass: Open Portfolio**, select a company/program/project, then use Overview, Architecture, Lineage, Work, Git, Cloud, Evidence or Decisions. Architecture, Lineage and Decisions reuse the existing deep tools. Another project's tools open in that project's window. **Show Context Inspector** reopens the contextual view. Its minimap supports collapse, hide and persisted preferences; it summarizes local refs and worktrees with observed merge bases, rather than a history graph.

## Declare the portfolio

Existing `.datapass/catalog.json` projects may include `organization`, `program` and `localPath`. Relative `localPath` resolves against the catalog directory; it is an explicit local binding, never an instruction to clone. Unavailable projects remain visible with unknown live state. External catalogs use the existing `datapass.catalogs` preference. Observation is bounded to 50 declared/recent projects.

Add optional `hub` declarations to the existing schemaVersion 5 project manifest:

```json
{
  "hub": {
    "company": { "id": "foil", "label": "FOIL" },
    "program": { "id": "energy", "label": "Energy" },
    "dataZones": [{ "id": "raw", "label": "RAW" }],
    "providerTargets": [
      { "id": "fabric-qa", "label": "Fabric QA", "cloudProvider": "azure", "platform": "Microsoft Fabric", "service": "workspace" },
      { "id": "oci-qa", "label": "OCI QA", "cloudProvider": "oci", "platform": "OCI", "service": "compartment" }
    ],
    "repositoryTargets": [{ "repoRef": "app", "environment": "qa", "targets": ["fabric-qa", "oci-qa"], "enabled": true, "sourceFolder": "src", "components": ["api"], "evidence": ["docs/targets.md"] }],
    "bom": [{ "id": "app", "repoRef": "app", "version": "1.0.0", "state": "candidate" }],
    "releases": [{ "id": "rc1", "label": "Release candidate", "version": "1.0.0-rc.1" }]
  }
}
```

The repository and environment must already be declared. Git host, cloud provider, platform/service, logical target and environment are independent axes. A repository can bind zero, one or several targets. Disabling an environment disables its effective bindings. Data zones are a separate axis.

Environment IDs remain configurable within the existing identifier syntax. Optional fields include `label`, `enabled`, `production`, `ephemeral`, `classification`, `predecessors`, `promotesTo`, `owner` and `regionPolicy`. Promotions can branch and converge; unknown references and cycles are rejected. Production is determined by explicit fields, never by the name. TEST and PROD need not exist.

## Observe Git and CI

**Refresh local Git** performs bounded, read-only observations. **Refresh Git + CI** additionally uses the existing configured `gh`, `glab` or Azure CLI login. No new credentials are stored and no deployment runs. Unsupported/missing login, absent evidence, changed HEAD or a truncated successful response produces UNKNOWN. CI PASS requires successful reported pipelines/workflows for the exact observed HEAD; a PR badge alone does not establish that.

The Git summary includes branch/upstream, ahead/behind, staged/unstaged/untracked/conflicted state, detached HEAD, worktrees, PR/MR and five recent commit summaries. At most 500 changed paths and eight semantic comparisons of at most 128 KiB per side are shown. SQL, notebook, IaC and pipeline diff primitives come from the existing pinned Common package and the pure Git 0.2 primitives in `datapass-vscode-hub` at `7dcd191841304454050ed9c3d9b831a30aa688f5`. No new history, full blame, stash or hunk workbench is embedded. Linked/outside and credential configuration contents are excluded; summaries remain static parsing evidence.

## WorkOrder dependencies and qualification

WorkOrders retain their existing format and policy. The optional `dag` contains `requires`, `produces`, `unblocks`, `related`, `supersedes`, `acceptance`, `evidence`, `priority` and `draft`. Edit selected WorkOrder DAG prepares a reviewed revision through the existing WorkOrder form; it keeps the previous order.

The projection exposes DRAFT, READY, BLOCKED, RUNNING, EVIDENCE_RECEIVED, FAILED, QUALIFIED, DONE and SUPERSEDED. Missing/ambiguous dependencies and cycles block readiness. An agent's done report produces EVIDENCE_RECEIVED. Legacy DONE alone does not unlock dependants. **Qualify selected WorkOrder** requires a person to confirm every acceptance criterion and supply reviewed evidence references. Qualification records the current order/Markdown/attachments digest under the existing serialized state-write lock. Changed inputs invalidate it. A qualified predecessor unlocks its explicit dependants; **Next READY WorkOrder** chooses by priority and selected project/subproject within existing policy, then selects the order without launching an agent.

## Companion boundary

Lens, Cloud and X-Ray are optional. Registered fixed commands receive `datapass.hub-context/1` inspect-or-plan context: company/program/project, repository, observed revision/worktree, selected component/artifact, environment, enabled provider targets, evidence refs, origins and return scope. Local absolute worktree paths are not put into the view. Only an observed current/worktree HEAD can be routed. An absent command shows an unavailable/install hint and leaves the Hub usable.

Installed tests register typed contract receivers to verify outbound payloads and absence handling. They do not prove that separately released companion products accept this new envelope. Those products' receiving-contract compatibility and actual end-to-end behavior require their compatible installed releases.

## Qualification evidence

`tests/enterpriseHub.test.ts` covers fixtures A–P and domain boundaries. `tests/integration/enterpriseHubFlows.ts` exercises the installed VSIX with real temporary Git repositories/worktrees, offline exact-HEAD host responses and person qualification. `tests/qa-hub.smoke.test.ts` exercises actual Portfolio/Home/Inspector webviews, dark/light/narrow, keyboard controls, hide/show and reload persistence; reports/screenshots go to `out/qa-hub`. Existing V6/native, legacy desktop, UI and performance gates continue to run. Fixture CI evidence qualifies behavior, not live client or provider entitlement.
