# Implementation Status — V2.2 (Pass 9)

Date: 2026-09-24
Branch: `claude/v2.2-contracts-and-preflight`
Version: `0.9.0`
Handoff: `handoff/V2_2_HANDOFF.md`, `handoff/v2.2/*`

This document separates three things the handoff asks us never to blur:
**implemented** (code + tests in this repo), **documented-only** (DataPass routes the user
to a native tool and does not perform the operation) and **qualified** (evidence that it
works on a real desktop, account or tenant). Nothing in this pass is desktop-, account- or
runtime-qualified.

## Verification (this pass)

| Check | Result |
|---|---|
| `npm run check` (tsc strict, `noUncheckedIndexedAccess`) | clean |
| `npm test` | 115 / 115 pass (45 pre-existing preserved) |
| `npm run build` | `dist/extension.js` 304 kB, no test-only dependencies bundled |
| Activation smoke test (bundle loaded against a stubbed `vscode` API, v2 manifest) | `activate()` succeeds; 32/32 contributed commands registered; Work tree renders scope, checklist, operations, outputs, apps, exchanges, programme |
| Contract parity with `handoff/v2.2/contracts/contract_kit.py` | 5 emitted schemas deep-equal the Python kit; 6 examples valid; all 29 negatives rejected with coded failures |
| DiagramCloud projection | validated by DiagramCloud's own `src/core/model.ts` (vendored fixture, zod 3.25.76, devDependency only) |
| JSON Schemas (`schemas/**`) | meta-valid Draft 2020-12 (Python `jsonschema`); v1/FOIL/v2 manifests accepted; v1+scopes and credential URLs rejected; both shipped packs valid; drift test keeps them equal to the TS definitions |

Not verified: real VS Code UI (only a stubbed host), Windows, VS Code for the Web,
any Fabric/Databricks/Power BI/Grafana/Mongo account, Power BI Desktop.

## Implemented

### Core (pure TypeScript, no `vscode` import, fully tested)

| Module | What it guarantees |
|---|---|
| `core/model/strictJson` | Bounded parser: duplicate keys, non-finite numbers, `__proto__`/`constructor`/`prototype`, depth > 30, oversize, invalid UTF-8 and trailing data are rejected. Now also used for `.datapass/project.json`. |
| `core/model/{ids,evidence,canonical}` | Byte hashing (never re-serialised), ID rules shared with DiagramCloud, observation kinds each carrying what they do **not** prove. `datapass-sorted-json-v1` is explicitly not JCS and not FOIL `case_hash`. |
| `core/contracts/*` | Five envelopes (`io-contract`, `app-exchange`, `authority-snapshot`, `architecture-view`, `publication-brief`) at contract `0.1-draft`, schema DSL + interpreter, semantic rules and result correlation. |
| `core/exchange/pathSafety` | Traversal, absolute, URI, UNC, `.git`, non-portable names rejected; high-risk targets (tasks, launch, MCP, devcontainer, workflows, package scripts, `.env`, bundles, `.tf`, the manifest) flagged; symlink escape check. |
| `core/exchange/appExchange` | Frozen request bytes + digest; results are `candidate` or `quarantined`, never applied; external `succeeded` is recorded as *reported*, never as runtime-observed. |
| `core/exchange/journal` | Multi-file writes revalidate every base first, back up, read back, and roll back. |
| `core/exchange/aiContext` | Four presets, byte budget, path/credential scrubbing, explicit omissions list. |
| `core/capabilities/*` | 21 operation records (provider × item type × operation × authoring mode) with sources S01–S18, preflight statuses `ready / blocked / needs-review / needs-config / unsupported / unknown`. Optional tools never block; an unprobeable desktop app is `unknown`, not absent. |
| `core/impact/facets` | Changed JSON pointers → facets; unmapped changes become `unknown` and invalidate conservatively; stale / stale-upstream fixed point; undeclared dependencies reported as such; history retained. |
| `core/domainPacks/*` | Declarative packs only (unknown keys and executable-looking text rejected); detached candidates where only `assumption`/`proposal` fields are editable. |
| `core/workspace/graph` | `.datapass/graph.json`: dangling relations and containment cycles rejected, data-flow loops allowed, pack roles bound to items. |
| `core/workspace/gitBase` | Base capture = HEAD + fingerprint of uncommitted changes; `git ls-remote` with argv, `--` guard, credential-free URLs only. |
| `core/projectManifestModel` | `schemaVersion 1 | 2`; v2 adds scopes, apps, domain packs, graph path, remote-only repositories; pure `migrateManifestToV2`. |
| `core/programme/*` | Programme views over the graph; money kinds never summed, unknown ≠ 0, targets are not commitments. |
| `core/publication/*` | Claims register (`.datapass/claims.json`); briefs select claims by audience/classification rule and never rewrite them; local approval bound to exact bytes + audience; output manifests are `received-not-approved` or `quarantined`. |
| `core/authority/*` | Mongo QuerySpec allowlist (no `$where`, `$function`, `$accumulator`, `$out`, `$merge`, `$unionWith`, pipeline `$lookup`), typed parameter binding, query hash; snapshots never present an error as empty or partial as complete. |
| `core/powerbi/pbipGraph` | PBIP → reports → semantic models, PBIR vs PBIR-legacy, `byPath` vs `byConnection`, TMDL vs `model.bim`, consumers, issues. |
| `core/diagramcloud/projection` | Explicit visibility on every element, confidential never exported, node status always `idle`, provenance and loss report in a private sidecar, publication `not-authorized`. |
| `core/work/workModel` | The Work view model: scope → next step → checklist → operation readiness → outputs → apps → exchanges → programme. |

### VS Code layer

- **Work view** (`datapass.work`, native tree, above Galaxy): selected scope and objective,
  next step, checklist (Done / Blocked / Problem / Skipped + note, labelled user-reported),
  operations with preflight status, affected outputs, apps (local / remote-only, last
  observed remote revision), exchanges, Programme views, problems.
- **Commands** (all in `src/work/commands.ts`): select scope, set checklist state, show
  preflight (with session-only review confirmations and the permitted action), create app
  request, import app result (clipboard or file, artifacts hash-checked), observe app remote
  revision, create parameter candidate (+ impact), analyze impact, prepare brief, approve
  brief for generation, import output manifest, import authority snapshot (checked against
  reviewed QuerySpecs in `.datapass/queries/`), export DiagramCloud projection (preview of
  omissions before saving), inspect Power BI project, copy AI context (preview of bytes,
  sections, omissions before copying), upgrade manifest to v2 (journaled, v1 backup),
  initialize project graph, validate any DataPass JSON file.
- Private session data lives in `.datapass/local/`, which writes its own `.gitignore`.
  Checklist states, exchange history, approvals and observations are in VS Code
  `workspaceState`; review confirmations are per window session only.
- **Editor validation** for `.datapass/project.json` (v1 + v2), `graph.json`, `claims.json`
  and pack files; contract schemas emitted to `schemas/contracts/` (`npm run schemas`).

### Adapter corrections

- Fabric: detects **Fabric Data Engineering** (`SynapseVSCode.synapse`, web
  `SynapseVSCode.vscode-synapse-remote`) and Jupyter; Fabric Studio, OneLake explorer and
  workspace MCP are optional and no longer lower the card status.
- Power BI: Copilot CLI optional; TMDL/PBIR markers are information, not prerequisites;
  detects the Microsoft TMDL extension (`analysis-services.TMDL`, alias `CPIM.TMDL-language-support`); card summary comes from
  the PBIP structure scan.
- Infrastructure: Container Tools (`ms-azuretools.vscode-containers`, legacy
  `ms-azuretools.vscode-docker`); Terraform and Kubernetes tooling optional next to OpenTofu.

## Documented-only (DataPass routes; the native tool acts)

Notebook local-sync and remote-VFS editing, Fabric item and Eventstream deployment (activation
review required), Airflow Git sync, Databricks notebook connect, TMDL/PBIR editing and
Power BI Desktop, Grafana Git sync (dashboards and folders only) and datasource configuration,
Mongo playground. Each record says so in its preflight evidence note.

## Corrections to the handoff

- The Microsoft TMDL extension is listed on the Marketplace as `analysis-services.TMDL`.
  Microsoft docs link `CPIM.TMDL-language-support`; DataPass detects both (Marketplace ID first).
- Fabric Data Engineering needs the Jupyter extension and a JDK for local runs; it is the
  Fabric product, not Azure Synapse Analytics, despite the publisher name.
- The draft Python kit compares `base` with dict equality; the TS port uses order-insensitive
  JSON equality, which gives the same result for the examples and is stricter about types.

## Waiting on FOIL (the FOIL pack stays `draft-awaiting-owner-declaration`)

1. Native case schema reference and the JSON pointers for each facet (economics, geometry,
   kinematics, pose, generator, presentation).
2. Declared dependencies per output (which facets LCOE, CAD, drawings, reports consume).
3. Python and JS hash test vectors for `case_hash`, so DataPass can *compare* without
   claiming equivalence.
4. Agreement on the candidate envelope and on Design Lab request/result and output
   manifests.

## Next passes

1. Manual qualification on Windows desktop VS Code with the Fabric, Databricks and TMDL
   extensions installed; record results as `desktop-qualified` per capability.
2. Galaxy cards show operation readiness from the capability registry.
3. Reviewed FOIL pack once the declarations above arrive; qualification against a real case.
4. Account qualification (Fabric workspace browse/capture, Databricks bundle validate) with
   evidence captured as observations.

---

## Previous pass (8, v0.8.0)

Date: 2026-09-23
Branch: `codex/pass8-galaxy-health-ux`
Version: `0.8.0`

### Implemented

#### Health-first Galaxy

The Galaxy is now organized as a control plane rather than a vertical diagnostic dump.

The top of the view shows:

- overall environment state: `healthy`, `attention` or `setup`;
- platform readiness count;
- detected-tool count;
- project-binding count;
- actionable attention count.

No arbitrary numeric health score is used.

#### Attention queue

DataPass now derives a compact attention queue from project and platform state.

It surfaces:

- invalid or missing project context;
- missing project repository bindings;
- platform detection errors;
- missing platform tooling.

When a safe non-mutating action exists, the queue exposes it directly.

#### Platform grouping

Platform cards are grouped into:

**Data platforms**
- Microsoft Fabric
- Databricks
- Power BI

**Engineering & runtime**
- Observability / Grafana
- Infrastructure

Unknown future adapters fall into an `Other` group automatically.

#### Compact platform cards

Each platform is now a collapsible card.

The closed state shows:

- platform name;
- status;
- summary.

The expanded state exposes:

- detected tools;
- detailed notes;
- actions;
- Fabric/Power BI catalogs.

Missing/error platforms open automatically.

#### Galaxy filters

The UI now supports:

- All
- Ready
- Partial
- Attention

Filter choice and expanded-platform state persist through the VS Code webview state API.

#### Project presentation

Project bindings remain visible, but long local filesystem values are shortened in the visible UI while the complete value remains available as hover text.

#### Status bar

The VS Code status bar now uses the same Galaxy health model.

It distinguishes:

- healthy;
- attention required;
- initial setup.

The tooltip includes detected tool, project binding and attention counts.

#### Sanitized handoff snapshot

The existing environment snapshot now includes safe health metadata:

- overall state;
- platform status counts;
- tool counts;
- binding counts;
- attention severity + labels.

It still omits:

- local paths;
- project binding values;
- generated command payloads;
- action details;
- tool/platform detail strings;
- credentials/secrets.

### Verification

CI remains the merge gate:

1. dependency installation;
2. strict TypeScript typecheck;
3. unit tests;
4. production build;
5. VSIX packaging;
6. artifact upload.

New tests cover:

- Galaxy health aggregation;
- missing binding / invalid manifest attention;
- safe action selection;
- health metadata in sanitized snapshots;
- omission of attention detail/action internals.

### Deliberately unchanged

Pass 8 does not add any new cloud mutation capability.

Existing review-first boundaries remain:

- Fabric deployment is copied/scaffolded, not silently executed;
- Power BI agentic plugins are copy-only;
- Databricks mutation remains explicit;
- infrastructure mutation remains user-triggered.

### Next likely pass

After installing the v0.8.0 VSIX in desktop VS Code:

1. adjust card density/grouping from real sidebar ergonomics;
2. add project-specific quick actions only where the desktop flow demonstrates real value;
3. bind the verified FOIL Fabric workspace;
4. validate one MCP server and one PBIP/TMDL/PBIR project;
5. only then consider controlled execution buttons for already-proven workflows.
