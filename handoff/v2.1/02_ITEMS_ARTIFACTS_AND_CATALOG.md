# 02 — items, artifacts, bindings and the catalog

## 1. The model in ordinary language

Use a small set of composable concepts. Do not make every entity a cloud resource and do not use 'artifact' to mean both a mutable editor tab and an immutable result.

| Concept | Meaning | Example |
|---|---|---|
| Navigation node | Human organization and ownership | FOIL / Wind / campaigns |
| Workspace | A selected, persisted work boundary | Wind experiment preparation |
| Item definition | Stable logical thing being developed | Campaign notebook, Airflow workflow, experiment configuration |
| Artifact revision | Specific bytes or a pinned manifest of external bytes | Notebook at commit X, case JSON hash Y, Parquet snapshot |
| Resource | Actual or proposed service/host | OCI VM, Fabric workspace, Airflow deployment |
| Binding | How an item/workspace uses a resource | Wind DAG on OCI K3s with its namespace/profile |
| Repository reference | Source ownership and observation | GitHub remote, branch, observed commit, optional clone |
| Run / receipt | Evidence of a requested/observed operation | DAG run, Lakeflow run, native validation result |
| Type descriptor | Rules for a kind of item | notebook, workflow, experiment-config |
| Provider capability descriptor | Supported representation/actions on a target | Fabric notebook source and workspace requirements |
| Domain pack | Optional company/project vocabulary and forms | FOIL experimental case pack |

A live dataset has a logical identity; a snapshot has an immutable identity. A notebook item can have several revisions and deployments. The project tree can show one resource in multiple places via bindings. No duplication of its physical definition is required.

## 2. Orthogonal facets

A notebook might be described as:

```json
{
  "id": "item.wind.analysis",
  "kind": "notebook",
  "purposes": ["sensitivity-analysis", "ml-experiment"],
  "languages": ["python"],
  "compute": {"engine": "spark", "versionConstraint": null},
  "native": {"dialect": "databricks-notebook", "representation": "source"},
  "sourceRef": "artifact.wind.analysis.source",
  "bindingRefs": ["binding.wind.analysis.dbx-dev"],
  "domainType": null
}
```

This is illustrative V2.1 metadata, not an accepted V1 manifest. Deployment provider, hosting cloud and environment are properties of the binding: Databricks can be hosted on different clouds; Airflow can run on OCI, a laptop or Fabric. Do not infer these from the programming language or filename.

`ML` is usually purpose, not a new notebook kind. ETL/ELT are workflow purposes, not providers. `manual` is a trigger mode, not an alternative to Lakeflow. DAB is a packaging/deployment mechanism, not a compute engine. An Azure DevOps pipeline is CI/CD, not an Azure Data Factory data pipeline.

Provide two synchronized navigation projections over these same entities:

- Project view: FOIL → Wind → case/campaign → notebooks/workflows/resources.
- Item view: Notebooks / Workflows / Dataflows / Streams / Apps / Artifacts; filter by provider, engine, domain or environment.

Stable IDs survive reparenting or changing a label. Paths and display labels are not database keys.

## 3. Initial type catalog

Start with a bounded catalog, not a separate class for every marketing name:

| Generic kind | Representative native types | Notes |
|---|---|---|
| `notebook` | Jupyter, Fabric Notebook, Databricks notebook | Cells/code are not the execution environment |
| `workflow` | Airflow DAG, Fabric/ADF pipeline, Lakeflow Job | Coordinates tasks and dependencies |
| `dataflow` | Lakeflow declarative pipeline, SQL/dbt model graph | Data transformation/dependency semantics |
| `streaming-flow` | Fabric Eventstream, a streaming application | Long-lived ingestion, checkpoint/backpressure semantics |
| `script` / `package` | Python module, wheel, SQL script | Preferred portable shared computational core |
| `dataset` | Table, topic, file collection | Mutable identity; refer to snapshots for reproducibility |
| `dataset-snapshot` | Parquet manifest, versioned table snapshot | Pin identity and retention, not just a live table name |
| `application` | Streamlit, React, Databricks App | Native entrypoint/runtime/provider belong in facets |
| `dashboard` / `semantic-model` | Grafana, Power BI, Databricks AI/BI | Similar presentation category, different semantics |
| `infrastructure-definition` | OpenTofu/Bicep/Compose/Kubernetes | Desired infrastructure/runtime configuration |
| `domain-config` | FOIL experiment case; another client's model | Schematized by an optional domain pack |
| `artifact-bundle` / `report` / `model` | CAD bundle, run report, ML artifact | External large bytes, versioned descriptors |

Use aliases for native names and retain `nativeType` rather than continually broadening core enums. Distinguish implementation support from type registration: an item may be visible and reference-only before any provider action is implemented.

## 4. Notebook contract

A general notebook definition records source, language(s), parameter schema, input/output contracts and intended use. A provider binding adds the runtime, environment/libraries, workspace/default lakehouse/catalog, identity references, storage mapping and native notebook identity.

Jupyter IPYNB describes cells, source, metadata and optional outputs; sharing that format does not equal sharing a kernel, libraries or storage. Fabric's native Git representation and Databricks source formats have their own metadata and conventions. [S06–S09]

Keep source outputs excluded from AI context by default. A notebook can contain tokens or business data in output/attachments, not only in source. Do not erase the user's source file to redact an export; create a sanitized projection with a clear redaction record.

Portability should be assessed at several levels: bytes parse; cells/language preserved; dependencies resolved; paths/secrets mapped; execution succeeds; outputs conform; expected semantics preserved. A syntax-valid import does not prove the final levels.

## 5. Artifact contract and integrity

Minimum immutable revision metadata:

```text
artifactId; logicalItemRef; revisionId
contentRef: repository+commit+path OR approved object+version OR local file
mediaType; byteLength; digest: algorithm+value
schemaRef: uri/version/digest when relevant
producerRef; consumerRefs; provenance/evidence references
classification; validation observations; created/observed timestamps
```

A directory/bundle needs a deterministic manifest of relative paths, sizes and file digests; hashing an arbitrary folder listing is insufficient. A Git commit plus path identifies content only if the file is actually tracked at that commit. A branch name is a moving locator, not an immutable version. Record Git LFS/object references without downloading large assets for routine context export.

**Byte hash and semantic hash are different.** Byte SHA-256 detects exact file changes. Domain-defined semantic hashes may intentionally ignore formatting, but require a named canonicalization contract. The FOIL R0 kernel uses a pinned Python JSON serialization; do not relabel this RFC 8785 or silently replace it with JavaScript JSON.stringify. Preserve its `schema_version` and digest convention in a domain adapter. No self-referential 'hash includes itself' contract.

Use null for unbound data only in proposals. Executing against an artifact requires a resolved, checked revision. Mark a changed consumer `needs-revalidation`; do not claim its previous result is invalid physics or delete it. Historical receipts remain true observations of their original inputs.

## 6. Relationships and graph rules

Typed relationships include `contains`, `uses`, `produces`, `consumes`, `runsOn`, `deployedFrom`, `observedBy`, `derivedFrom`, `supersedes`, `dependsOn` and `invokes`.

Do not enforce one global DAG rule:
- navigation containment must be acyclic;
- a conventional workflow's task dependencies must satisfy its engine rules;
- compound loops/dynamic task mapping may not be expandable statically;
- system architecture can contain feedback loops;
- lineage may include iterative generations, separated by revision/run identity.

Keep unknown/dynamic edges explicitly incomplete rather than drawing a deceptively complete graph. Mermaid is a derived view. Escape labels, disable executable links/HTML, apply a restrictive renderer policy and do not run imported diagrams as instructions.

## 7. Resource and target binding

A resource records provider identity, scope, account reference, actual/proposed state, observation time and source. A target binding records:
- definition/item and artifact revision;
- environment such as development or research-client;
- provider/native runtime/API versions;
- deployment model, namespace/workspace/catalog/paths;
- approved parameter mappings and credential references;
- access/safety/budget requirements;
- trigger ownership;
- observed native IDs and links.

One physical OCI VM can have Wind and Hydro bindings with different namespaces, Compose profiles, environment requirements and workloads. Restarting a Wind process may be scoped; rebooting the VM impacts both. Show shared-resource impact before accepting a host-level operation. Name-based filtering is not security isolation; actual user/RBAC/container/network permissions matter.

## 8. Descriptor library

Split three registries:

1. **Core types**: generic forms, relation rules, schema locations, common inspection capabilities.
2. **Provider adapters**: native formats, supported actions, prerequisites, error mapping, links, capability probes and version-specific materializers.
3. **Domain packs**: namespaced company/project schemas, terminology, field groups, templates and artifact roles.

A descriptor can declare `inspect`, `openNative`, `validateSource`, `prepareDeployment`, `requestRun`, `observeRun`, `collectLogs`, `assessMigration`. Each capability has implementation status, prerequisites, evidence/source date, effect classification and provider version constraints. Do not populate action buttons merely because a marketing feature exists.

Common action sequence: resolve item/binding → show prerequisites → create bounded operation proposal → review → execute via supported adapter/tool → observe → receipt. The same sequence can drive several providers while their implementation remains distinct.

## 9. Internal interfaces — conceptual, not an API freeze

```ts
interface ItemAdapter {
  describeCapabilities(target: TargetBinding): Promise<CapabilityReport>;
  inspect(source: SourceReference): Promise<InspectionResult>;
  prepare(request: PreparationRequest): Promise<ChangeProposal>;
  openNative(context: ResolvedContext): Promise<OpenResult>;
  observe(request: ObservationRequest): Promise<ObservationResult>;
}
```

Run/request/stop methods should be separate effectful interfaces with typed requests and approval checks, not hidden inside `inspect` or `openNative`. Pure descriptor/schema loading cannot install packages, start containers or contact arbitrary URLs.

Preserve native files as the executable authority. Generated files carry generator/version/input-hash ownership. If the user edits a generated file, flag divergence; do not overwrite it on refresh. Unknown provider metadata remains preserved and inert. No hidden bidirectional regeneration.

## 10. Extensibility without overengineering

V2.1 can ship built-in descriptors in the existing VSIX and local, reviewed JSON domain packs. No plugin marketplace, remote arbitrary-code loader, central registry service or graph database is required. New adapters can be added incrementally when a real workload justifies them. The catalog should make unsupported functionality understandable, not imply it exists.
