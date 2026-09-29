# ADOPT-D / ADOPT-E audit — Codex IaC fixture + bridge, C4 tool catalog (2026-09-30)

Coder ADOPTDE (Opus medium, GO by PM DataPass 13, rules V3.7). Audit only, nothing merged into product code. Refs checked at: Common main `28815d4`, Cloud main `9ac9506`, bridge main `e5f3e9b`, wind-lab main `2465a22`.

## ADOPT-D-1 — IACFIX0: `wind-lab-fabric-iac` `fixture/iacfix0-synthetic-lab` (`008dc8c`, 2 commits, 38 files)
**Already on main (Common).** IACCORPUS copied it into `conformance-fixtures/iac/wind-lab-fabric-iac/` with a commit pin (`MANIFEST.json`: commit `008dc8c`, inventory sha `43d9…1321`). Byte check (git blob ids) of all 41 source files: **36 are identical, 0 differ**, 5 are deliberately excluded (`scripts/generate_fixture.py`, `scripts/check_integrity.py`, `AGENTS.md`, `.gitignore`, `.gitattributes`; documented in MANIFEST). Consumers on main: `iac-hcl` (hcl + emit tests, `expected/source-bindings.json`, `fixtures/adverse/hcl`), `iac-model` (IAC0/IAC3, source bindings, adverse local backend), `iac-readiness` (IAC-001…013 vs `expected/findings.json`). IAC-EMIT (`53d02f5`) emits `datapass.iac-declarations/1` from this corpus.

**Missing / worth adopting (oracles present but no consumer):**
- `expected/lineage.json` (3 notebook edges, bronze→silver→gold) — no test anywhere. This is the IAC6 "definition path → notebook → dataset" link. Worth adopting as a lineage-core conformance test.
- `evidence/tst.plan.json`, `evidence/prd.plan.json`, `evidence/static-scan.sarif.json`, `evidence/plans.provenance.json`, `fixtures/adverse/imports/*` (deep plan, stale binding, unsupported plan) — no consumer in Common or Cloud. Cloud `packages/iac-extension` imports plan/SARIF only from `fixtures/foil-synthetic` (checkov/tfsec). These are the IAC5 import oracles (create/update/replace/unknown, stale binding, secret-shaped values).
- `items/medallion.DataPipeline/*` and `examples/pipelines/*` — present, consumed only as readiness inputs; no pipeline→notebook edge test.

**Drop:** the generator and integrity scripts (Python, executable, not needed: the corpus is pinned by blob hash). Merging wind-lab MR !1 into wind-lab `main` is optional housekeeping (the pin is by commit, not by branch); PM decision, no code impact.

**Frozen-contract conflicts:** `expected/lineage.json` is an oracle, not a lineage-graph/1 document: its edge kinds (`data-value`, `join-influence`, `aggregate`) are not in `LINEAGE_EDGE_KINDS` (reads/writes/derives/…), and its `origin: "hand-authored-fixture-oracle"` is not a lineage `origin` value. A test must **map** it (data-value/aggregate → `derives` with detail; join-influence → `derives` flagged influence, or `reads` — PM to pick), never widen lineage-graph/1. Data origin stays `dataClass: synthetic-L0` per ARCH_DECISIONS "Origin vocabulary".

## ADOPT-D-2 — IACBRIDGE: `codex-datapass-bridge` `iac/wind-lab-bridge` (`51523c8`, 2 commits, 8 files, +111/−3)
No branch named IACBRIDGE exists in any DataPass repo (searched remote heads of the 17 repos under D:PROJdatapass); the IACBRIDGE packet (dataprojects `handoff/IAC_IMPLEMENTATION.md`) is implemented by this branch. Nothing of it is on bridge main.

Content: `docs/IAC_SOURCE_PIN.json` (commit `008dc8c`, manifest + inventory sha, 4 source hashes: core/main.tf, main/main.tf, 2 notebooks — same commit as the Common corpus pin), `docs/IAC.md`, 4 new source items + main→core dependency + 2 `uses` edges in `.datapass/graph.json` (0.2) / `project.json` (v5), README/AGENTS lines, and a new `.gitlab-ci.yml` metadata validator.

**Worth adopting:** `IAC_SOURCE_PIN.json`, `docs/IAC.md`, the graph/project additions (they stay inside the published v5 / 0.2 schemas; Codex validated them against Common `b14dc91`). Low risk: bridge is a synthetic demo client, public-safe content.

**Drop / change:** the CI job downloads schemas at run time from `raw.githubusercontent.com` (network fetch in CI, GitHub as source while GitLab is the authority) and builds a venv + `pip install jsonschema` per run. Replace with a check against Common's schemas vendored at the pinned commit, or drop the job (the bridge has no code). The README link to the wind-lab MR goes stale once merged.

**Conflicts:** none with lineage-graph/1 or analysis-protocol (legacy manifest only). Naming: the pin uses `origin: "fixture"` (ADR data origin) next to `dataClass` — fine for a sidecar, but must not be copied into lineage `origin` (see above).

## ADOPT-E — C4 `tool-catalog`: Common `v4/common-tool-catalog` (`3a9d01f`, not on main)
The branch sits on the ADOPT-A stack (`00bfeaf`); the C4 part is 2 commits (`4272653`, `3a9d01f`): `packages/tool-catalog/**` (7 files), `ownership/catalog-migration.json`, `ownership/contracts.json` (tool-catalog `reserved` → `implemented-alpha`, dep semantic-core), `package-lock.json`. 11 files, +1624.

**Already on main:** only the reserved slot in `ownership/contracts.json`. `arch-catalog` (ARCHCAT1) is a different thing (architecture decisions, not tools) — no overlap. Cloud still ships its own `src/catalog.ts` (required by `src/extension.cjs`); its bytes on Cloud main **equal the migration's pinned sha** `5578ff…ee4b` (no drift since `ca55a7f`).

**Worth adopting:** `datapass.tool-catalog/1` schema + validator (unique sources, https-only inert doc URLs, alias collision, exact-version compatibility, "supported needs evidence", handoffs guidance-only unless evidenced) and `createCatalog` lookup (unknown by default); `catalog-migration.json` (25 Cloud tools, all `identity-preserved`, extraction by AST, no eval); 4 tests. Every semantic-core API it imports (`schema`, `documentSchema`, `checked`, `reject`, `unwrap`, `canonicalJson`, `validate`) exists on main. Replay onto main: only `package-lock.json` conflicts (regenerate).

**Drop / change:** `data/cloud-tools.json` and `src/cloud-seed.ts` carry the same 25 entries twice (608 + 610 lines) — keep one (generate the TS from the JSON, or load the JSON). README says "Cloud migration data, verified native handoffs and IaC inventory remain to be implemented": Cloud is **not** switched to the catalog; that switch is a separate Cloud package.

**Conflicts:** none with lineage-graph/1 or analysis-protocol (separate schema id, headless, no process/network API). Watch: `effect`/`support` enums duplicate nothing in analysis-protocol today; if CheckResult later cites catalog evidence, analysis-protocol stays the owner (ARCH_DECISIONS "Schema owner").

## Proposed packages (PM rules)
1. **ADOPT-E1 — tool-catalog into Common** (6 M): new `v4/adopt-tool-catalog` from main, replay `4272653`+`3a9d01f` (C4 paths only), regenerate lockfile, dedupe seed (single source), run tool-catalog tests + packed-consumer check. Cloud switch-over deferred to a later Cloud package (≈ 8 M, when a screen needs versioned tool support).
2. **IAC-ORACLES — wire the unused wind-lab oracles** (8 M, Common + Cloud): (a) lineage-core conformance test mapping `expected/lineage.json` to lineage-graph/1 edges without widening the enum (Common, 3 M); (b) Cloud iac-extension import tests over `evidence/*.plan.json`, SARIF and `fixtures/adverse/imports/*`, reading the Common corpus copy by pinned path (Cloud, 5 M). Can split into two coders.
3. **ADOPT-D2 — bridge IaC metadata** (2 M, codex-datapass-bridge): cherry-pick `IAC_SOURCE_PIN.json`, `docs/IAC.md`, `.datapass/*` and README/AGENTS lines; replace the CI job's GitHub runtime download with pinned vendored schemas or omit CI. Kept as a proposal, not a draft MR: it touches CI on a repo whose main is still GitHub-era, so the PM should decide the CI choice first.
