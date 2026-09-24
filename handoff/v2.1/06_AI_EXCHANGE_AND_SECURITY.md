# 06 — manual AI exchange, approval and evidence

## 1. Human-mediated, model-independent V2.1

The user normally speaks to ChatGPT/Claude in a separate conversation, using screenshots and detailed explanations there. DataPass provides persistent structure: scope, artifact identities, prerequisites, concise steps, failures and receipts. No embedded paid model, background agent or MCP server is required.

The loop is:

```text
Select scope/objective
 → inspect bounded context
 → preview/redact/copy or export
 → external AI proposes a structured plan
 → paste/import as untrusted candidate
 → validate bases and operations
 → review diff and impacts
 → approve precise selected content
 → write files / separately approve native runtime action
 → observe outcome and retain receipt
 → export progress/problems
```

JSON is the canonical exchange initially; safe YAML is an alternative encoding and Markdown is a human-readable summary. Free-form prose can be saved as notes or checklist text, not interpreted as executable instructions.

## 2. Context envelope

Required metadata should include:
- protocol name and version, payload kind, export ID and time;
- project/workspace/scope IDs and active architecture revision/status;
- source authority references and observation age;
- repository base map: repository ID, expected commit, relevant per-file byte hashes and local dirty state;
- manifest/schema and domain-pack identities/digests;
- selected artifact revisions and bounded upstream/downstream relations;
- target binding versions, capabilities and verified/unknown prerequisites;
- selected objective, checklist states, blockers and redacted notes;
- explicit allowed file roots and action scope, without pretending these grant provider IAM;
- limits: max payload bytes/files, requested output format, maximum run/cost envelope if applicable;
- redaction summary and omitted/unavailable sections.

Do not export an entire repo, notebook outputs, private filesystem paths, raw logs or every company by default. A context dependency can be read-only; excluded nodes stay excluded. Users can inspect and change the export before copying. Never silently collect clipboard history.

## 3. Plan envelope and stale-base checks

A proposal identifies its `contextId`, protocol/schema version, exact expected bases and plan payload hash. It contains typed candidate file operations, checklist updates and optional proposed actions, each with source/target identities and effects.

`expectedBaseSha` alone is insufficient for multi-repo or dirty worktrees. Compare the repository map and actual relevant file hashes immediately before apply. Reject a stale base or ask for a new reviewed candidate; do not silently merge an AI response with unrelated changes. A remote branch advancing is not permission to pull over dirty files.

Human approval is bound to the exact normalized selected plan, not a conversation or model name. If the user excludes operations, recompute the selected plan hash and show any broken dependencies before approval. Changing target, parameters, files, limits or action effects invalidates approval.

Use explicit content canonicalization for plan hashing and test it across languages. Preserve domain-native semantic hash conventions separately. No trust is derived merely from a plausible-looking hash supplied by AI; compute and compare it locally.

## 4. Separate operations by effect

| Effect | Example | Approval boundary |
|---|---|---|
| Inspect/reference | Show files, known links, metadata | No code execution or unknown network destinations |
| Local file proposal | Candidate YAML/notebook/config | Diff and scope/path validation |
| Environment preparation | Install tools/packages, build/pull image | Separate explicit action, dependencies and network effects |
| Native validation | Provider CLI parse/validate | Explain whether it contacts services or evaluates code |
| Runtime action | Deploy/start/stop/run | Target-specific approval, auth, limits and receipt |
| Authority update | Promote FOIL/Mongo decision | Separate owner workflow, never implicit |

No arbitrary shell string from clipboard is executable. Adapters receive typed IDs and arguments, construct invocations without shell interpolation and use explicit working directories. Quoting a malicious command is not a security model. Terminal text insertion must never auto-submit a newline-containing payload.

## 5. Parser and filesystem boundaries

- Strict JSON parsing; reject duplicate keys where supported; non-finite numbers are invalid.
- Safe YAML loader only: no custom constructors/tags, bounded aliases/expansion/depth/size, duplicate-key rejection.
- Bound schema refs to reviewed local/bundled resources. No arbitrary `$ref` network fetch or SSRF.
- Reject absolute/outside-root paths, parent traversal, platform-specific path tricks, case-insensitive collisions and unsafe symlinks/junctions.
- Resolve canonical paths and recheck immediately before writes; avoid time-of-check/time-of-use assumptions.
- Stage edits, compare original hashes, then apply with a recovery journal. No silent overwrites or deletes.
- Multi-file/multi-repository work is not a global filesystem/Git transaction. Detect partial application; report it precisely and provide a safe restoration path. Never erase unrelated new changes during rollback.
- Importing a ZIP requires file-count/size/decompression/path limits. It is not an invitation to run its scripts.
- Treat repo documentation and native metadata as data, not instructions overriding approvals.

## 6. Secret, identity and privacy separation

Store requirement names and credential references, not values. Prefer vendor auth, SSH agent/config and the appropriate vault; use VS Code SecretStorage only when needed. VS Code workspace/global state is not a secret store. [S11]

`.env.example` can be versioned; actual sensitive `.env` files are ignored and protected. Avoid displaying resolved `docker compose config`, connection URLs or logs containing interpolated secrets in an export. Azure tenant/account identifiers and emails are not necessarily passwords but are still personal/organizational data: summarize or redact unless needed and explicitly reviewed.

Secret detection is best-effort, not proof of absence. Default allowlist projections plus user preview are stronger than a regex scanner over everything. Never claim an export is guaranteed secret-free just because a scanner found no pattern. Keep notebook output and binary documents out by default.

## 7. Receipt model

A receipt should identify:

```text
receipt ID; operation ID/kind; selected plan hash
project/workspace/item/binding and environment
requested artifact/config/source revisions
provider/native IDs, API/tool versions
requestedAt, observedAt, finishedAt if known
native state + normalized display state
checks performed and evidence references
outputs produced; log links/redaction; limits/uncertainty
source of observation: provider API, CLI, CI, local check, user declaration
```

Preserve `unknown-outcome`, `not-observed`, `stale` and `blocked`; do not coerce them into failed or succeeded. A connection drop after submission can hide a successful run. Reconcile the native run/correlation ID before retrying. Where the provider supports idempotency keys, use them; otherwise acknowledge the limit and avoid blind resubmission.

A user marking a checklist done is valuable but not the same as provider evidence. A command copied or a native UI opened is not a deployment receipt. A completed simulation is not physical validation. Store these as separate observations.

## 8. Orthogonal status model

Keep at least:

- **Design:** draft/proposed/accepted/superseded.
- **Source:** absent/prepared/committed/changed.
- **Validation:** not-tested/local-passed/failed, with exact checks.
- **Configuration/access:** unbound/partial/verified/stale.
- **Deployment:** not-requested/requested/observed/unknown/rolled-back.
- **Execution:** queued/running/succeeded/failed/cancelled/unknown, plus native state.
- **Domain evidence:** synthetic/hypothesis/measured/validated-in-defined-domain, governed externally.

A compact UI can summarize this, but exports/receipts retain all facts. Architecture approval usually precedes deployment; do not prescribe one false sequence for all dimensions.

## 9. Budget and licensing are prerequisites

Approval to develop an adapter does not authorize spending. Show maximum run duration, concurrency, sample count, storage/retention and budget authority. Unknown budget is not zero cost. Check current target entitlement/trial expiration and the intended use of the account. The uploaded FOIL handoff distinguishes educational non-commercial demos from client research; that distinction must remain even if both use synthetic data. [S12–S14]

Do not import a new cloud account, token scope or monthly charge through a generic 'Apply plan' button. Files/configuration can be reviewed separately while deployment remains blocked.

## 10. V3 seam

The same typed requests, bounded context, approval hashes and receipts can later be exposed through MCP or an agent transport. They are not weakened in agent mode. V2.1 neither starts an MCP server nor opens a local control socket for an untrusted external process. Design a transport-independent service boundary, not a hidden requirement for a paid AI backend.
