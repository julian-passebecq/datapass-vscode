# Preparing a client project for DataPass — the guide

For DataPass VS Code **0.20.0** (manifest `schemaVersion: 5`, graph `0.2`). Written for two readers:
the **AI** that prepares a client project from scratch (pages in English) and **the person** who
uses it (page 3 in French).

| # | Page | For |
|---|---|---|
| 1 | [Overview and vocabulary](01_OVERVIEW.md) — what DataPass is and is not; coordination repository, sub-project, component, artifact, operation, environment, module, profile, provider, pack | both |
| 2 | [What the client's AI prepares, in order](02_WHAT_THE_AI_PREPARES.md) — AGENTS.md, project.json v5, graph.json 0.2, board, options, sheet, extensions.json, catalog, work log; minimal and full examples; mistakes DataPass refuses | the AI |
| 3 | [Ce que Julian prépare](03_CE_QUE_JULIAN_PREPARE.md) — comptes, outils, connexions, SSH, clones, réglages, espace de travail, check-list | la personne |
| 4 | [Customization](04_CUSTOMIZATION.md) — profiles, providers, domain packs, environments and the ID map, resources such as VMs (worked example with two VMs) | the AI |
| 5 | [The loops](05_THE_LOOPS.md) — DataPass-guided JSON exchange, work orders, pull requests and Check / Get updates, the Git view | both |
| 6 | [Ready-to-paste prompt for the client's AI](06_PROMPT_FOR_THE_CLIENT_AI.md) | the person |
| 7 | [Known limits and open bugs](07_KNOWN_LIMITS.md) | both |

Field-by-field reference: [../PREPARING_A_PROJECT.md](../PREPARING_A_PROJECT.md). Schemas:
[`schemas/`](../../schemas/). Complete example projects: [`examples/v3`](../../examples/v3/).

Every JSON block in these pages is checked by [`tests/guide.test.ts`](../../tests/guide.test.ts)
against the extension's own parsers and the editor schemas: examples must be accepted and agree
with each other, *refused* examples must be refused. When you add a block, put a marker comment on
the line above it (the test explains the four markers).

No client or FOIL data belongs in this public repository: client-specific preparation lives in the
client's private coordination repository.
