# 03 — input/output contracts and external application exchange

## Why another contract is necessary

V2.1 identifies an artifact and its producer/consumers. V2.2 adds the meaning of the boundary: what a consumer expects, how it can validate the input, what it produces, and what remains unknown. A SHA-256 proves byte identity, not semantic compatibility, authorship, accuracy or publication rights.

Use five interoperable concepts rather than company-specific adapters for everything:

1. **Item**: stable logical identity, e.g. experiment, notebook, data product or app.
2. **Port**: named input/output with a data contract, cardinality and transport mode.
3. **Artifact revision**: immutable representation with locator, size, byte hash, native/schema version, producer and lineage.
4. **Request/result**: bounded external work request and its correlated response.
5. **Observation/receipt**: what was actually checked/executed, when, by which tool and against which exact revisions.

## Data contract fields

A production DataContract should include stable ID/version; schema locator/hash; producer and consumer roles; record grain; key/uniqueness/nullability; units; currency and base year when applicable; time zone and event/simulation/ingestion time; classification and evidence basis; compatibility policy; quality assertions; retention/replay expectations; and owner/authority reference.

Transport is a separate binding: file/Parquet, HTTP, MQTT, Event Hubs, SQL table, Delta table or Mongo snapshot. One logical contract can have different physical encodings. Describe conversion and loss explicitly. A pipeline joining inputs must reference exact input contracts, not infer compatibility from similar column names.

For streaming, specify event ID, source sequence, schema version, clock semantics, lateness, duplicates, dead-letter handling, replay starting point and retention. For a campaign, prefer a fixed snapshot and manifest; a live table can change during an experiment. For a BI model, include measure semantics and permitted aggregation, not just column types.

### Examples of contracted boundaries

| Producer | Output | Consumer | Required checks |
|---|---|---|---|
| External Streamlit Design Lab | Candidate/configuration bundle | DataPass or Oracle campaign | Base revision, schema, byte/case hashes, classification, accepted inputs |
| Oracle simulation | Telemetry and Parquet snapshot | Fabric RTI and batch | Event identity, time basis, retries/dedup, source/schema hashes |
| Fabric preparation | Fixed analytical input | Databricks campaign | Schema/grain, immutable snapshot, format/path and entitlement |
| Databricks | Result + receipt + model artifacts | Power BI, Streamlit, optional Neon | Run/input/kernel lineage, completion evidence, metric semantics |
| Mongo authority | Bounded study/decision snapshot | Programme/AI context | Namespace, source revision/asOf, projection, redaction and completeness |
| Programme | Publication brief and approved assets | External AI/slide or website tool | Audience approval, claims/sources, restrictions, asset rights and hashes |
| React website | Build/deployment report | Programme | Commit, build artifact, provider deployment, review/publication status |

## Streamlit and React remain external

AppDescriptor should record appType, repoRef, optional localRoot, source/entrypoint, environment/lockfile refs, input/output ports, native schema versions, hosting binding, observed deployed revision, owner and management mode. React source, static export and API server are separate representations/runtimes when appropriate.

A `remote-only` Git repo is valid. Display tracked branch and observed commit without cloning it. Cloning, fetching, checking out, installing dependencies and running an app are separate user-approved actions. Never pull/merge over a dirty worktree. A browser-deployed site is not proof that the local code is the deployed revision.

DataPass can offer schema-driven request forms: choose objective, case or dataset, desired outputs, permitted scope and constraints. It should not embed the whole Streamlit lab or become a React page builder. Detailed discussion/screenshots remain in external ChatGPT/Claude.

### Manual exchange flow

Select scope → inspect required inputs → create bounded request → preview/redact → copy/export → external AI/app works → import result as untrusted candidate → correlate to the exact request → verify artifact bytes and schemas → show differences/impact → selectively accept references/files → optionally perform a separately approved native action.

The request declares expected input refs, schema versions, base revisions, requested operation and output contract. The response declares request ID/digest, actual inputs, produced artifacts, errors/warnings, external execution receipt and verification limits. A result can be partial or failed without destroying the request or prior accepted state.

An AI saying 'done' is a reported claim, not a runtime observation. Track `reportedBy`, `verifiedBy`, `checkedAt`, verification method and limits. External results need not grant the extension permission to execute or publish anything.

## Digest rules: avoid circular and cross-language ambiguity

Use a byte hash for the exact immutable exported request; keep that hash detached from those bytes. In the executable design kit a request has `requestHash: null`; its exported bytes are frozen, and the result carries the SHA-256 of those bytes. Do not parse and reserialize the request before comparing its byte digest.

FOIL's existing `case_hash` is a different native identifier. Preserve its declared Python canonicalization (`sort_keys=True`, compact separators, ensure_ascii=False, finite values). Do not call it RFC 8785/JCS and do not replace it with JSON.stringify. Keep fixtures for 1 versus 1.0, negative zero, exponents, Unicode and omitted/null fields. Any new canonicalization requires a named algorithm/version and explicit migration.

A hash computed by an untrusted producer is not a signature. Verify against authorized source records when trust matters. Never infer scientific approval from digest equality.

## Candidate contracts and partial invalidation

Do not expand the frozen `foil.experiment/1.0-rc1` reference schema in place. A candidate envelope points at an immutable base, includes a reviewed patch and requested derived outputs, and is validated before a new case revision is accepted. Preserve both the native schema identity and DataPass exchange version.

Track dependency facets rather than invalidating solely by whole-document hash:

| Changed facet | Usually invalidated | Usually retained, if dependency declarations prove independence |
|---|---|---|
| Unit budget/discount assumptions | LCOE, economic report, affected business brief | Geometry CAD and unchanged drawings |
| Geometry | CAD, drawings, geometry-dependent simulation/results | Unrelated external studies |
| Kinematics/pose/yaw | Pose-dependent CAD/drawings and relevant simulations | Independent budgets |
| Kernel or dataset | Dependent calculations and campaign results | Exact input artifacts/history |
| Camera/layout only | Presentation render | Scientific case/calculation identity |
| Unknown/custom field | Conservative downstream stale state | Nothing is assumed independent automatically |

Each derived artifact records the exact dependency revision/facet digests it used. Old results are still valid historical outputs of old inputs; they become stale relative to the newly selected revision, not retroactively failed. Never delete old receipts on a parameter edit. Do not trust an AI's assertion that a consumer is unaffected; use the declared dependency contract and its tests.

## Small files and explicit authority

Keep project pointers, architecture semantics, provider bindings, artifact indexes, contracts and private exchange history separable. Do not put all client data in a giant `.datapass/project.json`. Private local notes and temporary export previews need retention/clear controls; only explicitly accepted durable records go to Git. Large binary artifacts stay in authorized object storage or owning repos, with locators and hashes.

The executable schemas in contracts/ are design fixtures, not a complete production DataPass manifest or a native FOIL/Fabric schema. Implement migrations and provider validation deliberately.
