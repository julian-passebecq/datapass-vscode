# DataPass roadmap — V1 (fast, stable, usable), V2 (80 %), V3 (100 %)

Owner: ARCHI DataPass 1 (high), 2026-09-26, on main after 0.24.0 (0.25.0 and 0.26 in flight).
Julian's brief: "a detailed plan of everything we must code; V1 fast and stable, V2 intermediate with
80 % of the features, V3 100 % and longer; if a usable V1 can come fast, go." This file is the single
answer; `handoff/PLAN.md` tracks the packages in flight; design decisions stay in `handoff/v3/10_`
(D-01…D-18) and `11_` (D-19…D-28).

## 0. Diagnosis in five lines

1. **Features are not the gap.** 0.13 → 0.25 shipped the whole V3 model: bridge repository, manifest v5,
   graph, options/variants, sheet, board, readiness, toolchain/ID map/connections, Git module, AI
   exchange, work orders, Claude & Codex panel, modes, context from any file, format checks, file
   versions, toolkit catalogue. 352 commands, 9 views, 418 unit + 325 desktop tests.
2. **Nobody has used it end to end on a real project yet.** FOIL's bridge is still in review (PR #5/#6),
   and no Azure/Fabric/Databricks account run has happened (V1 gate 16).
3. **Starting is hard:** no "open this client project" path (clone bridge + every native repository +
   workspace in one go), no walkthrough; 352 palette entries.
4. **Honesty gaps are being closed** (0.25 selected-variant wording, 0.26 MCP writer, D-22 evidence).
5. **So V1 = make the existing product easy to start, stable and qualified on one real flow**, not
   add surfaces. V2 fills the 80 % that real use will ask for. V3 is the long tail and automation.

## 1. V1 — "usable on FOIL and one plain client project" → 1.0.0

Target: **2–3 days of parallel coders + Julian's ~2 h of checks.** Definition of done: Julian opens
FOIL from its bridge URL in a few clicks, lands in Standard mode on the architecture, switches
A/B/C, opens files from several repositories, copies context to the FOIL AI, gets its PR back with
*Get updates*, runs the native test of the selected component, and sees honest states everywhere;
the same on the public `doc-pipeline` example; no crash or silent failure in the testlabs.

### 1.1 Already shipped and kept as is (V1 surface)

Bridge + native multi-root Explorer + company workspace · Architecture panel and Details · Git view
(Needs you, worktrees, PRs, CI, Fetch all, Get updates fast-forward) · AI exchange (copy / validated
import / backup / restore) · Copy Context for My AI from any file · format checks → Problems · file
versions · options, scenarios, variants, selected variant (preview) · readiness, toolchain, ID map,
connections (az / fab / databricks read-only checks) · toolkit catalogue · modes (Standard default) ·
work orders (opt-in) · Claude & Codex panel.

### 1.2 In flight (finish, no new scope)

| Id | What | State |
|---|---|---|
| 0.25.0 | selected variant (preview), "files present" badges, preview / test / activate wording, repository layout contract | release by TAMPON 9 |
| AI-4a | pilot stage 1 without Azure sign-in (pilot folder, requests/responses, Pilot tab, stubs) | TAMPON 11 |
| M1 | lossless MCP settings writer, HTTP servers, `ws.mcp` = "registration file present" | TAMPON 14 |
| K1 | toolkit: Fabric Core/local/IQ MCP, Power BI Authoring MCP + Microsoft `powerbi-authoring`, Azure MCP | TAMPON 15 |
| X1 | Mongoku removed from visible scope (old configs still load) | TAMPON 16, merges last |
| C1 | options cost lines: `shared` counted once, `use: learning-only` | TAMPON 19 |
| 0.26.0 | release of the above | TAMPON 20 |

### 1.3 New V1 packages (all independent of Julian's accounts)

| Id | Package | What exactly to code | Size · effort | Owned files | Acceptance |
|---|---|---|---|---|---|
| **V1-ON** | **Open a client project** | Command *DataPass: Open a Client Project…* (also on the welcome page): paste the bridge's Git URL (GitHub, Azure DevOps, GitLab; https or SSH) → pick a parent folder → clone the bridge → read its manifest → list declared native repositories with their role → clone the missing ones (checkbox list, default all non-planned), locate existing clones instead of recloning (same remote identity) → write the company workspace file (0.17) → open it; Standard mode lands on the Architecture panel. Idempotent (re-run = "all present"). Never clones a planned repository; stops on the first auth failure with the host's own message and a *Retry*. Plus a VS Code **walkthrough** "Get started with DataPass" (5 steps: open a client project, the architecture, a file → context for my AI, Get updates, switch mode). | M · medium | new `src/work/openClientProject.ts`, `src/core/project/cloneplan.ts`, `resources/walkthrough/**`, its package.json entries | Unit: clone plan from a manifest (planned skipped, existing clone located by remote identity incl. SSH/https equivalence, Azure DevOps forms); desktop flow on a local "GitHub on disk" fixture with 3 repositories: one command → workspace with 3 roots open, Architecture shown; second run clones nothing |
| **V1-P1** | **Stamped packs and orders** (D-23) | Every pack and work order records selected variant, environment and bridge HEAD; the AI view marks a copied pack stale when any of them changes; launching an order stamped for another variant asks first | S–M · medium | `src/core/exchange/stamp.ts`, stamp lines in the pack builders, the order `stamp` field (schema additive), the AI-view stale badge | Unit: stamp content; stale after variant / HEAD change; order launch confirmation. Desktop: switch A→B, pack shows stale |
| **V1-STAB** | **Stabilisation sweep** | Run, as a user would, every testlab (4, 5, 6, 7, 7a, 8, 9, and 10 when it exists) and the full desktop suite on a clean profile with the latest VSIX; list every error, dead button, wrong label, unhandled rejection in the extension host log, stale doc; fix the small ones in place, file the big ones as V1 packages to the ARCHI | M–L · medium (high if > 10 bugs) | fixes in place, each small; a report `handoff/v1/STABILISATION.md` | Report with every testlab step PASS/FAIL; zero unhandled errors in the extension host log for the testlab flows; fixes merged |
| **V1-PERF** | **Activation and refresh budget** | Measure activation time and first refresh on a FOIL-sized fixture (8 repositories, 5,000 files, graph 60 components); lazy-load the heavy modules (webviews, toolkit, work orders) behind their views; budget: activation < 500 ms, first project refresh < 3 s on this PC; no refresh storm on `git fetch` | M · medium | activation paths in `src/extension.ts` (lazy imports only), a perf fixture and `scripts/perf.ts` | Numbers before/after in the PR; a CI job that fails above 2× the budget |
| **V1-T10** | **Testlab 10 = acceptance journeys** (D-28) | `D:\PROJ\datapass-testlab\10-parcours-client\`: plain client project works with DataPass disabled; open from bridge (V1-ON); preview A/B/C with the right packs; missing clone, unverified remote, dirty file, unsupported tool, variant with files never run; MCP card with unknown states | M · medium | testlab folder, `04_NEXT_PASSES.md` B7 | setup twice clean; coder runs every non-visual step; Julian's visual steps in todo.md |
| **V1-DOC** | **Docs you can read** | (a) `docs/DEMARRER.md` in French, one page: install, open a client project, the daily loop, the four modes, where things are; (b) consolidate the handoff forest: `handoff/CURRENT.md` (what DataPass is now, links to 10/11/ROADMAP/PLAN), move V1/V2.1/V2.2 handoffs and superseded V3 docs to `handoff/archive/`, shorten `CLAUDE.md` to the boundaries + pointers; (c) README top section for 1.0 | M · medium (docs-writer) | those files | Links checked; CLAUDE.md < 60 lines; nothing deleted, only moved with redirects |
| **V1-PAL** | **Command palette diet** (revises D-03's palette rule) | Commands that need a context argument (a card, a component, a file, an order) and fail from the palette get `commandPalette: when false`; the palette keeps ~60 top-level commands, grouped by a consistent prefix ("DataPass: Git…", "DataPass: AI…", "DataPass: Project…"); menus unchanged; presets still never hide safety commands. UI wording "bridge repository" everywhere (J4) | S–M · medium | package.json `menus.commandPalette` and titles only | A test lists palette-visible commands (snapshot, reviewed); each hidden one has a context menu or view entry; merges **last** before 1.0.0-rc |
| **V1-FOIL-A** | **FOIL PDF route A runs from DataPass** (client side + one DataPass hook if missing) | After the bridge PRs and a native test task in foil-study (contract-agnostic: whatever native revision is current, FOIL 0.2 at 2026-09-27; see common NATIVE_CONTRACTS_AND_CI.md): the Details of `study-core` offers *Test* = the native `pytest` task of foil-study (a VS Code task run on click, D-19 "test"); the result is shown with commit and time; nothing deployed | S · medium | foil-study tasks.json (native repo, no DataPass file), DataPass only if a route is missing | Julian clicks Test on the study component and sees the result with its commit |
| **QA-0…QA-3, HUB-1** | **Codex test mode ("auto" mode)** (Julian, 2026-09-26) | Codex, the external tester, uses the released VSIX as one of our clients would. It walks the client journeys listed in the client's auto repository, on the fake client "Codex Wind Lab", and reports into the audit repository. DataPass provides the formats, the `qa:prepare` helper (isolated VS Code with the VSIX installed) and a "Codex tests" section that hands a `qa-run` order to Codex. The hub and common repositories are seeded. Design: [v3/12_CODEX_TEST_MODE.md](v3/12_CODEX_TEST_MODE.md) §8 | M total · medium | see 12 §8 | see 12 §8 |
| **1.0.0-rc** | Release candidate | bump, CHANGELOG, status, VSIX installed, todo.md checklist for Julian | S · medium | release files | full suites green |

### 1.4 Julian's part of V1 (≈ 2 h, in `todo.md`)

1. Review and merge FOIL bridge PRs #5 then #6; answer Q2 (Azure names) and Q3 (the two VMs) in #6 (20 min).
2. Review foil-study PR julian-passebecq/foil-study#1 (S1: core + route A, 38 tests, CI green) and its 3 flagged choices (pypdf version outside `result_id`; derived paths keyed by `extraction_run_id`; `blob_ref` rejected until a Blob implementation) (15 min).
3. Machine: `az`, `func`, `az login`, Reader on the dev resource group, Storage Blob Data Reader (20 min).
4. Testlab 9 visual steps + Claude & Codex panel (40 min); testlab 10 visual steps (20 min).
5. 1.0.0-rc: open FOIL with *Open a Client Project*, run the loop once (20 min) → say "1.0".

### 1.5 V1 order (parallel lanes)

- Lane A (now): V1-ON · V1-DOC · V1-T10 (T10 uses ON when it lands).
- Lane B (after AI-4a merges): V1-P1.
- Lane C (after 0.26.0): V1-STAB, then V1-PERF.
- Lane D (client, after Julian's reviews): V1-FOIL-A.
- Last: V1-PAL → 1.0.0-rc → Julian's check → 1.0.0.

## 2. V2 — "80 %": what real use will ask for (1.1 → 1.4)

Grouped by theme; each item is a package of S–M unless marked L. Order inside V2 follows what FOIL
needs first.

### 2.1 Evidence and trust (1.1)
- **E1 integration evidence chain** (D-22): known → installed → registered → connected → authenticated →
  authorized target → operation verified, per tool and MCP server, in Readiness and Details; `unknown`
  by default. M.
- **Receipts with separated outcomes**: CLI exit / CI green / deployed / runtime success / scientific
  validity as distinct fields; agent claims labelled as claims; check plan rows NOT_RUN / UNKNOWN /
  FAIL / STALE; result reuse keyed by input identity (plan 10 §3 V2). M–L.
- **Coordinated change sets shown**: native PR ↔ bridge PR linked, "prepared vs landed". M.
- **AI-4b pilot qualification** with Julian's read-only sign-in; then **R5** one MCP-assisted read-only
  pilot on an approved Fabric sample. S + S (Julian present).

### 2.2 Model limits from guide 07 (1.2)
- Resources with an environment and a role key (dev/prod VM of one role). M.
- Graph `vm` target cross-checked against `resources[]`. S.
- Unknown `toolchain` ids fail validation (with suggestion) instead of passing (limit 7.2 #7). S.
- FOIL-specific settings (`datapass.foil.*`) moved behind the FOIL domain pack or retired (limit #10). S.
- Planned repositories may hold a pilot `path` (limit #11). S.
- Identifier values checked where a read-only CLI can (resource group, workspace id). M.

### 2.3 Variants and architecture (1.2–1.3)
- Variants on another branch or tag (file refs with a Git `ref`, opened read-only) — J5, graph schema change. M–L.
- Side-by-side variant diff of the same component's files. M.
- Company-level global view (all projects of a company on one diagram). M.
- Bridge recommends a mode and surfaces (manifest v6 `presentation`) — J3; presets from the hub. M.

### 2.4 Checks and tools (1.3)
- Python syntax check through a vetted parser (no execution); notebook format checks. M.
- Native check runner: *Test* per component = a VS Code task declared in the native repository or the
  toolkit recipe, run on click, receipt recorded (generalises V1-FOIL-A). M.
- Pilot stage 2 (validate / plan: `bundle validate` for YAML bundles, `tofu plan`) with per-target review. L.

### 2.5 Environments and platforms (1.3–1.4)
- Restricted Mode, Remote-SSH and WSL desktop qualification. M.
- VM card (D-27): declared vs observed, IaC root, SSH alias, links. M.
- French UI via `vscode.l10n` (package.nls.fr.json + webview strings). L.
- Distribution: VSIX attached to a GitHub release by CI on tag; *Check for DataPass updates*. S (publishing needs Julian's yes).

### 2.6 Client side (FOIL, not DataPass code)
- foil-study adapter B (Blob event + Function), then C (ADF, async accepted/poll pattern). Client AI + coder.

## 3. V3 — "100 %": long tail and automation (2.x)

- Pilot stage 3: deploy to `dev` with per-target review, never prod (09 §3.3). L, max effort design.
- Read-only DataPass context MCP server (D-21 M2), only after a measured need. M.
- Recipes exported as agent skills (Claude / Codex / Copilot). M.
- DiagramCloud semantic mapping and freshness (D-26); scenario/sheet export (optional module). M.
- Grafana VM monitoring links and states (optional module). S–M.
- FOIL producer routes (generate campaign jobs through the FOIL fork), diagram editing. L, depends on FOIL.
- Hub-shipped cost refresh (toolkit prices dated, linked to cost lines by tool id). M.
- Team features (several people on one bridge: who works on which variant), if ever needed. L.

## 4. What we change or improve in DataPass (cross-cutting)

| Area | Change | When |
|---|---|---|
| Starting | *Open a Client Project* + walkthrough | V1-ON |
| Palette | 352 → ~60 visible commands, consistent prefixes | V1-PAL |
| Wording | "bridge repository" in the UI; "selected variant · preview"; "files present"; "registration file present" | 0.25, M1, V1-PAL |
| Honesty | evidence chain, receipts with separate outcomes | V2 1.1 |
| Performance | activation and refresh budget, lazy modules | V1-PERF |
| Docs | one French start page; handoff forest archived; short CLAUDE.md | V1-DOC |
| FOIL leftovers | `datapass.foil.*` settings out of the generic extension | V2 1.2 |
| Scope | Mongoku out (X1); DiagramCloud and Grafana optional modules only | 0.26 / V3 |
| Tests | testlab 10 as the acceptance journey; perf CI job | V1-T10, V1-PERF |

## 4b. Julian's ideas (2026-09-27) and where they land

Recorded by the PM so they live in the repository, not only in session memory. Milestones refer to `handoff/PLAN.md` (M4 = 1.0.0, M5 = product vision session, M6 = global UI pass).

| Idea | Target |
|---|---|
| Architecture diagram readable at a glance: provider colours and icons (Azure blue, Fabric green, Power BI yellow, Databricks orange-red, Python), file-type colours aligned with VS Code's file icons | V1-UI-POLISH (1.0.0 if it passes qa:ui) |
| Three reading levels per block, each in the legend: left band = DataPass state, top edge = capability state (V1-HONEST: validated / planned / unverified / failed), bottom line = client step state (validated / to redo / never run) only when a real source exists | V1-UI-POLISH |
| "Stay modular": every indicator and the legend can be switched on/off, legend position configurable | V1-UI-POLISH (settings); presets wired into `resources/experience/presets.json` in M6 / V2 |
| Block shapes inspired by cloud tools (Data Factory, Fabric): storage, processing, orchestration | V1-UI-POLISH if simple, otherwise M6 |
| Apply all of the above to the whole of DataPass (a UI close to VS Code and the real world) | M6 global UI pass, prepared with GPT 6 Pro and discussed in M5 |
| Codex Computer Use keeps an exploratory "like a human" pass that gives a UX opinion (impractical, confusing, slow); Playwright (`qa:ui`) carries the functional gate | V1-AUTO-2 (UX opinion section in the qa report) |
| Product vision session after 1.0.0: what was vague or contradictory, what the client AI work surfaced, short / mid / long-term vision | M5 |
| Client AI's informal opinion (low weight, not a review): the internal model is ahead of the user experience; show real capability states; a fluid open → understand → choose variant → see changes → test → activate loop | Input to M5; capability states in V1-HONEST. Private copy in the tech-lead repository (`45-external-feedback/`) |
| Git and Project in separate columns (today Git is hidden under Project) — from Julian's 1.0.0 check (18:30) | M6 global UI pass |
| An entry dashboard that shows everything at once, with the architecture diagram | M6 global UI pass |
| Clicking a feature in the diagram highlights its folders in the tree: keep it and extend it | M6 global UI pass |
| The commit diff view is hard to discover: make it visible | M6 global UI pass |
| Airflow DAG in the right panel, static — V3-AIRFLOW: opening a DAG file draws its tasks and dependencies in the secondary side bar, read from the text (never run), click ↔ code both ways | V3 wave 1 (V3-AIRFLOW) |

## Idées de Julian — 2026-10-01 13:45 (relayé par ASSISTANT DATAPASS 5 ; détail : effort-board/julian-idea-guided-tours-2026-10-01.md addendum 4)
1. **Parcours guidé aussi en navigation normale** : la liste des étapes à suivre avec de petits checks, dans la nouvelle barre étapes (sidebar/mini-map), pas seulement pédagogie/entretien. → **V5, STEPBAR1** (go/V5-STEPBAR1.md, après TOUR2 !244 + NAVBAR1 !211).
2. **Sortir les checks de l'arbre projet** : illisibles, ils dénaturent l'arbre qui doit rester au plus près de git. → **V5, STEPBAR1** (réglage `datapass.tree.showChecks`, défaut off, une version).
3. **« Super charged git mode » en V5 ?** Oui, comme module (TL-4) : GITMR1 statut multi-repo, GITMR2 historique cross-repo + Sankey, GITMR3 dérive des pins + impact, NAVCHG1 résumé de changement, NAVHIST1 historique/diff, PINDRIFT1. → **V5**.
4. **Vérification d'exhaustivité V5** (ne rien oublier d'utile) → audit PM 29 13:55 (go/V5-COMPLETENESS-2026-10-01.md).

## Idées de Julian — 2026-10-01 12:10 (pédagogie + visites guidées, relayé par ASSISTANT DATAPASS 4 ; détail : effort-board/julian-idea-guided-tours-2026-10-01.md)
1. **Fiches pédagogiques d'une page** dans le catalogue (style « PySpark Interview Series » : question, bloc de code, sortie, tableau comparatif, points clés) pour les notions data-engineering du projet ; elles renforcent le « pourquoi ceci plutôt que cela ». → **V5**.
2. **Partie « Pédagogie »** : les points clés du projet et comment le lire avec les yeux d'un recruteur (Spark SQL, etc.), le projet disséqué de façon ordonnée pour préparer un entretien. → **V5**.
3. **Visite guidée** dans le Navigator et la mini-carte : une liste ordonnée de vues (1, 2, 3…) ; cliquer ou défiler ouvre une vue déjà créée avec un encadré « ce qu'il faut comprendre ici » ; étapes et sous-étapes. → **V5 (cœur)**. Elle s'appuie sur NAVTOUR1, NAVCAT1 (vues personnalisées) et NAVMAP1.
4. **Visites générées par le pont IA** (« je veux comprendre la partie BI ») : l'IA propose un parcours d'écrans, revu puis enregistré comme visite (marqué AI-proposed). → **V5**.
5. **Écrans sur mesure enregistrés + visite partageable en lecture seule** pour montrer le projet à un supérieur en cliquant seulement la barre de navigation. → **V5**.
6. Relire ses remarques précédentes et la note de nuit du pont IA sur les vues et les flèches gauche/droite/haut/bas. → à intégrer par le TECH LEAD GLOBAL.
Cadrage : V5 livre le maximum ; V6 = un peu de polish + nouveaux clients. Décision d'architecture (TECH LEAD) : visite = liste ordonnée de vues enregistrées + panneau d'explication, parcours générés par le pont, visite partageable en lecture seule.
**Tri TECH LEAD GLOBAL (12:40)** : 1 → PEDA1 (fiches d'une page **citant le code du projet**, sinon c'est un cours générique) ; 2 → PEDA2 (lecture « recruteur », réponses longues via l'échange IA, marquées) ; 3 et 5 → TOURSPI1 (schéma de visite dans Common, lu aussi par Studio et l'export) + TOUR2 (mode guidé, étapes/sous-étapes, encadré, visite partageable) ; 4 → TOURAI1 (parcours proposé par le pont, validé contre les Locations réelles : une Location inconnue devient un trou) ; 6 → fait : une visite n'est qu'un chemin enregistré dans la grille ↑/↓ (niveau) × ←/→ (vue). Détail : `handoff/V5-PLAN.md`, décisions TL-11 dans ARCH_DECISIONS.

## Idées de Julian — 2026-10-01 11:46 (5 captures d'écran, relayées par ASSISTANT DATAPASS 4)
1. **Visual Explainer** : plans, architecture et statuts rendus en pages HTML visuelles (diagrammes, tableaux, checklists) au lieu de plans en markdown. → **Process, tout de suite** : V5-PLAN et les statuts pour Julian en Artifact HTML à côté du fichier .md versionné. **Produit, V5** : une vue « explainer » de l'architecture d'un projet dans le Navigator/Studio (triage par le TECH LEAD GLOBAL).
2. **Architecte de garde** (modèle des sous-agents Codex) : un architecte en effort élevé, appelé seulement à 3 moments (avant un gros plan, quand une erreur se répète, avant de déclarer finie une longue tâche) ; il conseille, n'écrit jamais de code ; les workers restent en medium ; une seule règle AGENTS.md. → **Process, tout de suite** : le PM TECH LEAD GLOBAL tient ce rôle pour DataPass à partir du 1 Oct. Règle à proposer pour Claude Control V4. **Produit, V5 (à trier)** : proposer ce modèle dans l'échange IA de DataPass.

## Idées de Julian — 2026-10-01 02:10 (enchaînement V4 → V5, relayé par ASSISTANT DATAPASS 3)
- Si V4 est fini avant son réveil (~08:00–11:00) et qu'il reste du quota : démarrer V5 tout de suite, sans l'attendre. Le PM planifie V5 depuis ce ROADMAP et PLAN (V5 déjà noté : détachement dbt, supergit multi-repo, SQLRooms/Studio, FastAPI OTel). Cible : V5.
- Les questions produit V5 ne bloquent pas : elles vont dans go/JULIAN-questions-reveil.md pour son réveil ; le PM prend la recommandation par défaut en attendant.
- Limite dure : jeudi 1 Oct 14:00 (reset hebdo 12:00 UTC) ; finir le quota avant est OK, aucune stagnation d'ici là.

## Idées de Julian — 2026-10-01 (navigation / UX, Studio, réponses § 28 et § 31)

Source : `D:\PROJ\datapass\handoff\JULIAN_UX_NAV_AND_STUDIO_2026-10-01.md`. Plan : PLAN.md § V4-NAV (PM 24). Critique du PM en une phrase par idée.

| Idée | Cible | Critique |
|---|---|---|
| § 28 : dbt canonique, puis notebook Fabric « détachable » (réponse 1b) | V5 (après MAT1 + DBTRUN1) | Bon choix : le détachement est un simple changement d'autorité tracé par un tampon ; l'exécuter sur Spark Fabric est faisable, c'est le flux Fabric normal de l'utilisateur, DataPass n'exécute rien. |
| § 31 : cycle de vie = système de navigation, pas des onglets ; pas d'étapes dans l'arbre de gauche | V4-NAV (AC-N1, étape affichée dans Context par NAVCTX2) | Juste : l'arbre VS Code est une liste de fichiers/composants, y mettre des étapes l'aurait cassé. |
| Profondeur ↑/↓ (projet → sous-projet → artefact → étape → opération) + vues ←/→ | NAVSPI1, NAVSVC1, NAVLOC1, NAVKEYS1 | Le cœur de valeur ; faisable car les échelles existent déjà (view-spi, VIS5 cloud, Hop). Risque : le niveau « opération » n'existe que là où les analyseurs donnent des positions (SQL, PySpark). |
| Vues prédéfinies par type d'artefact × niveau, modifiables, sauvables, réinitialisables ; grammaire factorisée | NAVSPI1 (catalogue JSON), NAVCAT1, NAVREN1–4 | Très utile et modulaire ; on garde deux moteurs de rendu (standalone, cloud) mais un seul catalogue. |
| Panneau droit fin permanent : home, flèches, icônes rapides, liste des vues | NAVBAR1 (barre latérale secondaire, déjà utilisée) | Faisable tel quel ; « permanent » = affiché par défaut et mémorisé, VS Code garde la main sur la largeur. |
| Mini-carte « vous êtes ici » entourée en rouge, variantes haut-bas / gauche-droite, ou arbre des granularités | NAVMAP1 | Utile pour l'orientation ; la mini-carte doit rester petite sinon elle doublonne l'architecture. |
| Zone du bas : résumé, étape du process, pourquoi, alternatives, patterns, que faire sur Fabric (IDs, paramètres) | NAVCTX1, NAVCTX2, NAVFAB1 | La partie la plus différenciante pour un client ; le contenu vient des faits, des rationales et du catalogue, avec des trous explicites plutôt que du texte inventé. |
| Fichiers d'explication écrits par l'IA pour le client | NAVAIX1 | Acceptable s'ils restent marqués « proposé par l'IA » et périmés quand le code change ; sinon ils deviennent de la fausse documentation. |
| Clic sur une boîte du DAG → détail de l'opération + code coloré à droite | NAVCODE1 (+ NAVHOST1) | Déjà fait par Hop pour les étapes ; on le généralise. |
| Git diff / retour dans l'historique à gauche pour l'artefact courant | NAVHIST1 | Utile et simple (lecture seule, jamais de checkout). |
| Spark : métriques théoriques shuffle / skew / coût avant exécution | NAVSPARK1 + NAVPERF1 | Faisable en structurel (frontières de shuffle, stratégie de jointure) ; le skew et le coût restent des trous ou du relatif tant qu'on n'a pas de volumétrie : on ne donnera jamais un chiffre en euros inventé. |
| SQL : partitions, index, vitesse de requête | NAVSQL1 + NAVPERF1 | Partitions/index/forme de requête : oui. Vitesse : **pas faisable en statique**, remplacée par « élagage de partition possible oui/non » ; la vitesse observée reste dans Observe. |
| Lignage et flux de données partout (où, quand, comment, par quel process) | NAVLIN1 | Les ~80 % communs ; le meilleur rapport valeur/effort de la liste. |
| Vue type Power Query (tables, étapes, couleurs cohérentes avec la mini-carte) | NAVREN4 (V4) | Bon marché car Hop extrait déjà les étapes ; l'échantillon de données par l'IA reste V5. |
| Spark job vs notebook comme alternative d'architecture | NAVPERF1 (carte EXEC1c) | Important pour plusieurs clients ; dépend de EXEC1c, sinon trou explicite. |
| « Git d'un projet cloud » : multi-fournisseurs, variantes activables avant push | investigate (après V4-NAV) | Vision juste mais large ; les variantes existent déjà (0.25), le lien avec la navigation se fera par des vues du catalogue. |
| Data X-Ray via un bouton sur les extensions OneLake / Fabric (Microsoft, Gerhard) | XRAYOL1 (V4, petit) | Faisable : menus sur leurs vues par identifiant (objet cliqué non garanti) et fichiers de leurs FileSystemProvider ouverts via `workspace.fs` ; l'API Fabric de Microsoft reste réservée (AC-D8). |
| Module Git « supercharged » multi-dépôts (Sankey n'était qu'un exemple) | V5 | Utile mais pas nécessaire à la navigation ; l'historique par artefact (NAVHIST1) couvre le besoin immédiat. |
| FastAPI expose des métriques OpenTelemetry | V5 (lecteur Observe en replay) | Faisable plus tard (import OTLP/Prometheus comme les autres lecteurs replay) ; peu de valeur tant qu'aucun client n'a d'API FastAPI en prod. |
| SQLRooms / DuckCon : Studio hors VS Code re-plateformé, adaptateur Factory → web app | V5 (Factory/Studio) | Pertinent pour Studio/Mosaic, pas pour DataPass VS Code ; brouillon GPT `datapass.studio.workspace/1` (datapass-studio!6) non qualifié. « Hop » reste notre langage visuel, pas Apache Hop. |
| Premier client FOIL éolien ; client « vanilla » = remplaçant perso Deepnote/Jupyter/Streamlit (web) | investigate (Studio) | Bonne cible de démo ; le client vanilla relève de Studio, pas de l'extension. |

### Ajouts de 02:00 (1 Oct) — idées et références visuelles (décrites, aucune image dans le dépôt)

| Idée | Cible | Critique |
|---|---|---|
| Navigator à droite ou à gauche, déplaçable | NAVBAR1 (réglage `datapass.navigator.location` + commande) | Juste : VS Code permet déjà de glisser les vues ; le réglage rend le choix explicite et mémorisé. |
| Vue « Prochaines étapes » par étape du cycle de vie / emplacement | NAVTODO1 | Très utile pour un client ; ne liste que ce que les faits connaissent déjà (readiness, contrôles, preuves manquantes, trous), sinon ce serait une to-do inventée. |
| Tableau de bord du projet façon tableau CI/PR (référence : tableau de bord Caddy + compagnon mobile) | NAVHOME1 ; mobile : V5 | Bon point d'entrée ; aucun nouvel appel distant, le statut CI est celui déjà en cache ou « inconnu ». Le compagnon mobile n'a pas sa place dans une extension VS Code. |
| Résumé de changement façon revue dbt Cloud (résumé, hypothèses, attentes, DAG des modèles modifiés, diff côte à côte) | NAVCHG1 | Le DAG d'impact est le vrai gain ; les « hypothèses/attentes » ne viennent que de fichiers proposés par l'IA via l'échange, jamais d'un appel caché. |
| Diagramme ERD (tables, colonnes, clés) | NAVERD1 | Attendu pour SQL/Warehouse/modèle sémantique ; limite : les clés ne sont pas toujours déclarées, les jointures déduites seront en pointillé « théorique ». |
| Fiches de principes data engineering (médaillon, lignage, idempotence, contrôles qualité, SCD, partitionnement) ; référence : affiche du flux staging → processed → curated | NAVPRIN1 | Pédagogique et différenciant ; chaque fiche montre où le projet applique ou enfreint le principe, sinon ce ne serait qu'un cours générique. |
| Page d'accueil + walkthrough (guide + tutoriel) pour chaque VSIX | NAVINTRO1a/b/c (standalone, Cloud, Data X-Ray) | Nécessaire pour l'adoption ; le hub n'est pas une extension, et le modèle commun évite trois styles différents. |
| Nouvelles VSIX séparées « dashboard », « supergit Sankey », « méga-lignage » | Non (§ 31) : NAVHOME1, NAVLIN1 ; module Git multi-dépôts en V5 | Une VSIX par idée fragmenterait le cycle de vie unique ; on ne séparera que si l'empaquetage l'impose. |
| Visites guidées sur la carte d'architecture (zones = systèmes, boîtes = fonctions/tables/fichiers, panneau de visite numéroté par parcours, boutons de parcours, « aller à une boîte ») — référence : tweet de Robin Ebers | NAVTOUR1 | Fort pour l'onboarding et les démos client, mais la valeur dépend des faits : des visites écrites à la main pourrissent, donc elles sont d'abord générées depuis le lignage et l'exécution. |
| OmicsLake : instantané/restauration + lignage + provenance de l'acteur par état validé, métadonnées DuckDB | investigate (V5) ; § 34 origines des preuves | Recoupe nos origines de preuve ; la restauration d'états de données dépasse une extension qui n'exécute rien. |
| Arbre de trace avec nœuds pass / clipped / pruned / replay | V5 (lecteur Observe en replay) ; style réutilisable dans NAVLIN1 | Bonne grammaire visuelle pour le replay Observe ; sans trace observée, rien à afficher en statique. |
| Espace de travail d'agents (Elastic : missions, tâches, preuves, panneau d'autorité/permissions) | V5 (agents optionnels) | Le panneau d'autorité rejoint nos approbations typées ; les agents restent un travail ultérieur optionnel (frontières du dépôt). |
| « Cerveau d'entreprise » Gorgias (skills, graphe, recherche hybride, signaler les manques → boucle de PR nocturne) | investigate (V5) ; les manques alimentent NAVTODO1 | L'idée utile est « signaler les manques » ; la boucle automatique de PR contredit l'échange IA manuel, elle reste hors V4. |
| SQLRooms (arbre de données + feuilles : tableau de bord, pivot, notebook, SQL, app) | V5 (Studio), déjà noté | Confirme la cible Studio ; rien à ajouter dans VS Code maintenant. |

## Idées de Julian — 2026-09-30 (correction d'architecture V4)

- Brief complet : [JULIAN_V4_ARCH_CORRECTION_2026-09-30.md](JULIAN_V4_ARCH_CORRECTION_2026-09-30.md). Cycle Understand → Design → IaC/Git → Deploy → Observe → Optimize ; ExecutionUnit ; routeur de capacités par opération ; provenance des outils ; Observe = réalité (état déployé, runtime, monitoring) ; boucle théorique ↔ mesuré ; ne jamais cloner un outil natif. Cible : V4 (PLAN § V4-ARCHCORR, vagues N1–N3, E2E-AC à la RC).
- Nuit du 30 sept : consommer le quota sans économie, coder sans arrêt, réserves (PM, coordinateur, codeurs) prêtes avant minuit.

## Idées de Julian — 2026-09-28 (retour rc.1)

From Julian's check of 1.1.0-rc.1 (screenshots relayed by the PM). Praise first: DataPass Hop "makes much more sense" — keep that direction.

| Idée | Target | Status |
|---|---|---|
| The tree lenses are hard to find: the buttons only show while hovering the view title, some fall into "…", and from VS Code's Explorer nothing points to them | 1.1.0 | V1.1.x-POLISH-3: a first tree row "Showing: <lens> ▾" (click to switch), a status-bar item "DataPass tree: <lens>" that works from any view (opens the DataPass side bar and the lens picker), a one-time hint when a project opens while the Explorer shows |
| The right rail cannot really be collapsed | 1.1.0 | V1.1.x-POLISH-3: the rail folds down to VS Code's minimum side-bar width (170 px) and Expand gives ~470 px back. Not possible from an extension: a thinner rail, reading or restoring an exact width (see `src/core/windows/railFold.ts`) |
| Two "Git" sections open at once (Git lens + separate Git view), "why same icons?" | 1.1.0 | V1.1.x-POLISH-3: the separate Git view hides while the Git lens shows; commands unchanged |
| The rail's DAG button showed "Not an Airflow DAG" for the file in the editor and unfolded the whole panel stack | 1.1.0 | V1.1.x-POLISH-3: the button finds the project's DAG files statically (one: opened; several: picked; none: said plainly) and unfolds the DAG view alone |
| "Je tombe toujours sur IA": every rail button showed the AI view first | 1.1.0 | V1.1.x-POLISH-3: each rail button unfolds its own view alone (Details, AI, DAG); Expand brings the full panel |
| A thin icon bar on the **left** as well; keep the thin one on the right, or optionally replace the right rail with a top button that opens the AI menu — all configurable (modular) | V4 | idea |
| Full rail redesign (what each button opens, order, placement) | V4 | idea |
| Airflow DAG tasks with shapes and icons per operator type (sensor, branch, transfer, compute…) instead of identical rectangles, possibly a horizontal layout — configurable | V4 | idea |
| Choose where the Airflow DAG view lives: its own editor tab, the bottom panel or the right rail (a built-in "placement" option, part of the modular layout) | V4 | idea |
| Remaining rc.1 remarks: the DataPass activity-bar icon disappeared and is too discreet; code zoom and the theme setting are hard to find; a Home button that restores the project layout | 1.1.0 | V1.1.x-POLISH-4: "Show DataPass in the Activity Bar" + a bolder icon (pinning it back stays a right-click: no API); A− / size / A+ in the status bar, on the Home page and on Alt+- / Alt+=; "Appearance…" (theme, overlay, colours, tree icons, diagram style, code size); a Home button (status bar, tree and rail title bars) restoring the layout named "Home" plus the Home page, tree and rail |
| Preset window layouts per project step, opened from a task in Home | V4 | idea |
| The Airflow DAG view works but is "pas très pratique": improve its UX | V4 | idea |
| **Standing test gate:** before any test session Julian runs, deliver a guided tutorial with screenshots showing where everything is (theme, zoom, Home, lenses…) and every shortcut; for V4, once V4 ships and before his test | every test session; V4 before Julian's test | rule |

## Décisions de Julian — 2026-09-28 (V4)

1. **V4 starts now**, without waiting for a final 1.1.0: 1.1.0-rc.1 stays the working version and fixes land along the way.
2. **First V4 product: DataPass V4 = understanding a real project** (file roles, milestones, lineage, findings, SQL then PySpark analyzers), extending DataPass Hop.
3. ~~Codex is the V4 tech lead~~ → **the PM is the architect** (Julian, 30 Sept: no more Codex; its feedback was already received).

## 4c. Julian's decisions (2026-09-27, after 1.0)

Recorded by the PM. No new package starts before GPT 6 Pro's answer on the V3 architecture.

1. **No monitoring.** DataPass shows only a project page of links (Grafana and similar stay outside DataPass).
2. **AI pilot = validate / plan only.** No deployment through DataPass; this replaces stage 3 in `v3/09`.
3. **Next horizon = V3.** Its architecture was requested from GPT 6 Pro (tech-lead repository, `00-report/2026-09-27-v3-request.md`).
4. **Understanding views.** Clicking the diagram opens a separate sub-task view; any file can be explained, the explanation generated as JSON and rendered with a Hop-like grammar.

## 5. What we do not build (unchanged)

No MCP gateway or cloud proxy, no own agent shell, no scheduler, no knowledge database or price
scraper, no virtual mega-repository or custom file browser, no compiler per provider, no DataPass
files in native repositories, no second FOIL backlog, no Mongoku integration, no scientific
calculation in TypeScript, no automatic install, sign-in or deploy.
