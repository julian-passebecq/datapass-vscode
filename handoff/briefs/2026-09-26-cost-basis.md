# Brief — cost basis in options.json (D-24)

Written and decided by ARCHI DataPass 1 (high), 2026-09-26. Source: handoff/v3/11_FOIL_MCP_REVIEW.md
D-24; FOIL review `03_STUDY_VARIANTS_AND_CONTRACT.md` §3.6.

## Question

options.json cost lines (`label`, `service`, `price`, `monthly`, `oneTime`, `currency`, free-text
`basis`, `source`, `asOf`, `note`; 0.22 aggregation in `src/core/project/costs.ts`) cannot say that
a line is a share of a capacity other options also use. A scenario that picks three options each
running on the same Fabric F-capacity sums that capacity three times. They also cannot flag an
offer that is not usable for client work (Databricks Free Edition: non-commercial, no SLA).

## Options

1. Free text only (guide tells the AI to write it in `basis`). − DataPass still triple-counts.
2. **Two optional structured fields on a cost line**: `shared` (a key naming one shared resource)
   and `use` (`"any"` default, `"learning-only"`). + additive, small, deterministic aggregation. −
   options files using them need DataPass ≥ 0.27 (unknown fields are refused by older versions).
3. A separate `sharedResources[]` block with costs referenced by id from options. + no duplicated
   figure. − a second place for money, harder for the client AI, bigger schema change.

## Decision

**Option 2.** Cost line gains:

- `shared`: string, pattern `^[a-z][a-z0-9_.-]{0,79}$` — the same key on lines of different options
  means one resource (e.g. `fabric-capacity-f8`). In any total that combines options (scenario
  table, previewed picks, the selected variant), lines with the same `shared` key count **once**:
  if their figures and currency are identical, that figure; if they differ, the resource counts as
  **unpriced** and the total says "shared resource `<key>`: figures disagree" (never pick max/min).
  An option's own subtotal still shows the line, labelled "shared (`<key>`), counted once per
  scenario".
- `use`: `"any"` (default, may be omitted) or `"learning-only"`. An option with any learning-only
  line gets a "learning only — not for client work" note in the Options table, the scenario table
  and packs; it is never excluded or hidden.
- `basis` stays free text (tier, region, assumptions). Marginal vs allocated is expressed by
  `shared` present (allocated share of a shared resource) or absent (marginal to this option).
- options.json `version` stays `"1"` (additive); the guide says "`shared` / `use` need DataPass
  ≥ 0.27". A file using them opened by an older DataPass fails validation with the unknown-field
  message, which is the existing, honest behaviour.

**Acceptance (package C1, medium):** unit tests in `tests/costs.test.ts` — three options sharing one
key counted once; same key with different figures → unpriced + message; different currencies stay
apart; shared + unpriced lines; a learning-only line flags its option and the scenario; options
without the new fields give exactly the 0.22 results (regression). Schema: both fields validated,
bad key and bad `use` refused. Options table, scenario table and packs show the labels. The
`examples/v3/doc-pipeline` options use `shared` for one storage account used by A/B/C and a
learning-only Databricks Free Edition line in one comparison. Guide 02 cost section and
PREPARING_A_PROJECT options rows updated. Owned: `schemas/datapass-options.schema.json` (cost line
only), `src/core/project/costs.ts`, the cost parts of `src/core/project/{options,optionsReport}.ts`
and of the Options webview, `examples/v3/doc-pipeline/.datapass/options.json`, docs as named, tests.
