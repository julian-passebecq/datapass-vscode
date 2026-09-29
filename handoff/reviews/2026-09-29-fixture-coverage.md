# Fixture coverage audit, DataPass V4 (2026-09-29, read-only)
Sources: cloud origin/main + v4/fake1, v4/capm1 (fake2/obs1/vm2/vm3b not pushed yet); common origin/main (IACCORPUS merged) + v4/obsc; hub origin/main. Legend: E = exists, P = planned (package), M = missing.

| Module | Fake data | State |
|---|---|---|
| IaC | HCL/tofu stacks (dev/prod, backend, imports) | E common `conformance-fixtures/iac/*`, fake1 `opentofu/` |
| | Plan JSON | E (wind-lab tst/prd, fake1 prod-plan). **Flag**: extra `note` key, hand-shaped, no `prior_state`/`configuration`/`resource_drift` |
| | State | E only 1 adverse old `terraform.tfstate`; M: v4 current state |
| | Bicep/ARM | E bicep-lab; **M: compiled ARM JSON**, **M: what-if output** (P IAC5/IACB reader, no fixture) |
| | K8s/Helm | E containers/shop, fake1 k8s; M: `helm template` rendered output, values per env |
| | SARIF | E 1 file, invented tool `synthetic-fixture-scanner`; M: real-shaped tfsec/checkov/trivy SARIF |
| | Infracost | **M** (P IAC5, no fixture) |
| Inventory | Fabric, Power BI, Databricks, Azure ARG | E recordings (fake1, provider-readers); bodies minimal (`{"job_id":1}`) |
| | OCI (instances, VCN, compartments) | **M** |
| Governance | workspace role assignments, capacities list, gateways/connections, deployment pipelines, git status/connection | **M all 5** |
| Monitoring | Capacity Metrics CU | E fake1 `capacity-cu-7d`, capm1 CSV/JSON |
| | Throttling 429 | E |
| | Azure Monitor metrics/activity log | **M** |
| | PBI refresh history | P FAKE2 |
| | Fabric job instances / Databricks runs | E fake1 histories (Fabric one not an OBS3 cassette, TRN1 fixes) |
| Observation | Spark event log (large cluster, skew, spill, autoscale) | P FAKE2 |
| | Fabric Spark monitoring (Livy/applications) | P FAKE2 |
| | Databricks runs/get + cluster events | P FAKE2 (runs E minimal); cluster events M |
| | Runtime lineage (OpenLineage/UC lineage) | **M** (OBSV1b consumes, nobody produces) |
| VM/infra | sshd, systemd(+timer), cloud-init, compose, K8s | E (oracle-vm, vm-sample, fake1) |
| | ufw/iptables, fail2ban, OCI security lists/NSG | **M** |
| Git/hub | repos, branches, MRs, CI pipelines | **M** (hub tests build repos in code; no GitLab API replays) |
| Project files | notebooks (.ipynb, Fabric .py, Databricks .py), PBIP/TMDL, ADF | E; M: Fabric SQL/Warehouse `.sql` project, dbt-style SQL, PySpark job set at scale |

**Gap count: 21 missing** (IaC 6, inventory 1, governance 5, monitoring 1, observation 2, VM 3, Git 1, project 2) + 5 planned (FAKE2 ×4, IAC5 imports) + 3 fidelity flags (plan `note`, SARIF invented tool, thin recording bodies).

## Official formats to follow
- Plan/state JSON: https://developer.hashicorp.com/terraform/internals/json-format · https://opentofu.org/docs/internals/json-format/
- ARM what-if: https://learn.microsoft.com/rest/api/resources/deployments/what-if · Bicep build: https://learn.microsoft.com/azure/azure-resource-manager/bicep/bicep-cli#build
- SARIF 2.1.0: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html · Infracost JSON: https://www.infracost.io/docs/features/cli_commands/#breakdown (`--format json`)
- Fabric: role assignments https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspace-role-assignments · capacities https://learn.microsoft.com/rest/api/fabric/core/capacities/list-capacities · connections/gateways https://learn.microsoft.com/rest/api/fabric/core/gateways · deployment pipelines https://learn.microsoft.com/rest/api/fabric/core/deployment-pipelines · git https://learn.microsoft.com/rest/api/fabric/core/git/get-status · job instances https://learn.microsoft.com/rest/api/fabric/core/job-scheduler/get-item-job-instance · Spark monitoring https://learn.microsoft.com/rest/api/fabric/spark/livy-sessions · throttling https://learn.microsoft.com/rest/api/fabric/articles/throttling
- Power BI refresh history: https://learn.microsoft.com/rest/api/power-bi/datasets/get-refresh-history-in-group
- Azure Monitor metrics: https://learn.microsoft.com/rest/api/monitor/metrics/list · activity log: https://learn.microsoft.com/rest/api/monitor/activity-logs/list
- Databricks runs/get, clusters/events: https://docs.databricks.com/api/azure/workspace/jobs/getrun · https://docs.databricks.com/api/azure/workspace/clusters/events · UC lineage: https://docs.databricks.com/api/azure/workspace/lineage (tables)
- Spark event log (JSON lines of SparkListener events) + REST: https://spark.apache.org/docs/latest/monitoring.html · OpenLineage spec: https://openlineage.io/docs/spec/object-model
- OCI security lists / NSG: https://docs.oracle.com/iaas/api/#/en/iaas/20160918/SecurityList/ · instances https://docs.oracle.com/iaas/api/#/en/iaas/20160918/Instance/
- GitLab REST (MRs, pipelines): https://docs.gitlab.com/api/merge_requests/ · https://docs.gitlab.com/api/pipelines/
- fail2ban jail.conf: https://github.com/fail2ban/fail2ban/blob/master/config/jail.conf · ufw: https://manpages.ubuntu.com/manpages/noble/man8/ufw.8.html

## Proposed FIX packages (all under ids.json, OBS3 cassette format, labelled synthetic)
| Id | Repo path | M | Model | Gate |
|---|---|---|---|---|
| FIXIAC | cloud `fixtures/foil-synthetic/iac-evidence/`: full plan JSON (drop `note`, add prior_state/configuration/resource_drift), current state, compiled ARM + what-if, tfsec/checkov SARIF, Infracost JSON, helm template output | 15 | Sonnet | after FAKE1; IAC5 tests read it |
| FIXGOV | cloud `fixtures/foil-synthetic/recordings/governance-*.json`: role assignments, capacities, gateways/connections, deployment pipelines, git status | 12 | Sonnet | after FAKE1 + TRN1 |
| FIXMON | cloud `.../recordings/azure-monitor-*.json` + enrich Databricks/Fabric/PBI bodies to full documented fields | 10 | Sonnet | after TRN1 |
| FIXLIN | cloud `fixtures/foil-synthetic/runtime/lineage/`: OpenLineage events + UC lineage + Databricks cluster events | 10 | Sonnet | after FAKE2 |
| FIXVM | cloud `fixtures/foil-synthetic/oracle-vm/`: ufw/iptables-save, fail2ban jail.local, OCI security list/NSG/instance replays | 8 | Sonnet | after VM2 |
| FIXGIT | hub `fixtures/gitlab-replay/`: projects, branches, MRs, pipelines, jobs | 10 | Sonnet | after HG1b |
| FIXPRJ | cloud `fixtures/foil-synthetic/project/`: Warehouse SQL project, 20+ PySpark jobs, notebooks at scale | 12 | Sonnet | parallel, now |

## 3 recommendations
1. Launch FIXIAC and FIXGOV first: IAC5 and governance readers otherwise ship with zero format-faithful input.
2. Add a check in FAKE1's consistency test that every recording body validates against the fields listed in its official doc (reject `note`-style extras).
3. Replace the invented SARIF tool with real tool driver names/rule IDs (checkov CKV_*, tfsec) so importer mapping is tested.
