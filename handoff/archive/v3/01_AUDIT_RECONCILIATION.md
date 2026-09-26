# V3 — the 2026-09-25 audit, finding by finding

Source: `DATAPASS_AUDIT_ET_HANDOFF_CLAUDE_2026-09-25.zip` (GPT), anchored on 0.12.0 / `91a0850`,
which was also the HEAD of `main` when this pass started (no other open PR or worktree). Each finding
was re-read in the source before changing anything. "Test" names the regression test that fails on
0.12.0.

| ID | Audit claim | Verified in source | Fix in 0.13.0 | Test |
|---|---|---|---|---|
| F01 | A declared DAB path makes validate "ready" without looking at the disk | `projectFacts` returned the declared string (`facts.ts`) | File-backed facts (bundle root, deploy config, PBIP, IaC root, Grafana watch path) are satisfied only when observed; "declared but not found" blocks with the declared value named; "could not check" is *unknown*. V3 components use their own observed files | `tests/trust.test.ts` F01, `tests/capabilities.test.ts` F01 |
| F02 | First workspace folder is the project; siblings not inventoried | `workspaceFolders[0]` in loader, manifest reader, adapters, actions | `projectRoot()`: the folder holding `.datapass/project.json` (choice remembered when several). Repositories resolved by declared path, located clone, open workspace folder or sibling folder **whose Git origin matches** | desktop `v3: the project folder, repositories and expected files are observed on disk` |
| F03 | Changing an untracked file does not change the base | `git status` + `git diff HEAD` only | Untracked files hashed as blob ids (`git hash-object`), `git diff --binary`; a capture that cannot cover everything is `partial` and includes a nonce so it never equals another | `trust.test.ts` F03 (fake Git and a real temporary repository) |
| F04 | A dev review satisfies prod | key `capability:review` (`session.ts`) | Key `operation:review#targetDigest` where the digest covers operation, environment, declared target names, facts and the component's file digest | `capabilities.test.ts` F04, `project.test.ts` reviews |
| F05 | `"token": "…"` survives `scrub` | regex required `token=` or `token:` | JSON-quoted keys, Azure `AccountKey`/`SharedAccessKey`, `?code=`/`sig=`, `Bearer`, PEM, more token shapes. Contexts stay allowlisted and previewed | `trust.test.ts` F05 |
| F06 | Runtime accepts `flows`, `platforms.bigquery`; the schema rejects them | imperative validator ignored unknown keys | Unknown fields are read from `schemas/datapass-project.schema.json` itself (`schemaKeys.ts`); corpus test compares runtime and Ajv; the schema now also forbids `resources` in v1 like the runtime did | `tests/manifestV3.test.ts` |
| F07 | Hydro result overwrites Wind result | dedup on project + capability | `qualificationKey` = project, scope, operation, target digest; component results show "stale" when files or target changed | `trust.test.ts` F07, `project.test.ts` results |
| F08 | ADF pipelines belong to the Fabric module | `module: "fabric"` in inventory, `fabric` providers included `adf` | New `azure` module (Data Factory, Functions, Storage, Cosmos DB) and `databases` module (MongoDB Atlas, PostgreSQL/Neon) | `inventory.test.ts`, `modules.test.ts` |
| F09 | `function_app.py` not recognised | no classifier | `host.json` v2 → Functions app asset; `azure-functions.python` profile; IaC roots | `inventory.test.ts` |
| F10 | `repoRef` and paths not cross-checked | `parseGraph` checks shape only | Cross-document problems: undeclared repositories, scope items not in the graph, undeclared environments, unknown operations and providers, operation/provider mismatch, missing component folder, committed `local.settings.json` | `project.test.ts` F10 |
| F11 | Graph and operations not linked | capabilities per scope only | Operations per component and environment (`graph 0.2 items[].operations`), with the component's files as requirements; profile operations when none are declared | `project.test.ts` |
| F12 | Refresh does not get GitHub changes | no fetch/pull command | Check for updates (`git fetch`), Get updates (`git merge --ff-only @{u}` after listing commits); refused on divergence or tracked local changes; never push, stash or rebase | desktop AI-push flow and refusal flow |
| F13 | AI context without a preparation pack | presets only | Preparation pack per component/sub-project: question, repositories and revisions, repository-relative files and states, blockers per operation, rules for the answer | `project.test.ts`, desktop pack flow |
| F14 | Interface tested, accounts not qualified | true | Unchanged: account qualification is a separate step with Julian | — |
| F15 | Workspace Trust and remote hosts | no `untrustedWorkspaces` declaration | `capabilities.untrustedWorkspaces: limited`; in Restricted Mode no Git runs (state "not inspected"), updates and cloning refused. Remote-SSH/WSL qualification remains | `work.test.ts` package check |
| F16 | No multi-project catalog | true | `datapass.catalog` (hub repository or `datapass.catalogs` setting) + recent projects in *Switch Project* | `project.test.ts` catalog |
| F17 | FOIL DAB needs the old FOIL VSIX to generate its jobs | confirmed: `databricks.yml` only syncs `.foil-lab/build/**`; `docs/LIVE_TEST.md` compiles and applies the campaign with the FOIL Lab of `databricks-vscode-foil` (branch `foil-lab-mvp`, `compileCampaign.ts`, `bundleIntegration.ts`) | Graph 0.2 `artifacts.generated` with a named producer: DataPass shows "to generate", blocks validate/deploy, never pretends. Keeping or extracting the producer is FOIL's decision | `project.test.ts` generation |

## Found during this pass

**Windows executable search.** `gitRunner` called `execFile("git", …, { cwd: repo })`. On Windows,
libuv searches the child's working directory before PATH, so a `git.exe` inside an opened folder (or
a declared repository) would have run on every refresh, trusted or not. Git and CLI probes now use
absolute paths resolved from absolute PATH entries only (`src/core/exec.ts`), and Git runs with
`core.fsmonitor=false`. Test: `trust.test.ts` F15b.

## Not taken from the audit as written

- The proposed separate top-level `artifactSets`, `operationBindings` and `flows` arrays were folded
  into the graph item (`artifacts`, `operations`) and the existing scopes: fewer cross-references
  for an AI to keep consistent, same information.
- "An extension cannot contribute to the secondary side bar" was true until VS Code 1.105; since
  1.106 `viewsContainers.secondarySidebar` exists, so the Details view lives there natively. The
  engine requirement moved to `^1.106.0`.
- Neon's extension ID (`databricks.neon-local-connect`), the Azure view container (`azure`), the
  Databricks (`databricksBar`) and MongoDB (`mongoDB`) containers and the ADF Studio URL were
  re-verified on the Marketplace and in the extensions' manifests on 2026-09-25.
