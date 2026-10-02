# V5 acceptance run

One command checks the V5 features the way you would use them, in a real VS Code window, on made-up projects:

```
npm run build
npm run qa:v5                 # rows of part a; --rows 01,05 for some rows, --part b for the other half
```

- **What it opens:** fresh VS Code windows (light theme, 1440×900, a profile of their own: your own VS Code is not touched) on the synthetic fixtures in `tests/fixtures/v5/` (`shop`, `shop-bare`) and a three-repo set built on the fly (`ingest`, `transform`, `bi`, plus a local fake Common). No client data, no remote.
- **What it checks:** each row of `go/V5-ACCEPTANCE.md`, as listed in `qa/v5/acceptance.json`: the normal path and the "hole" case (a missing fact must show as a hole, never as a made-up value). On every journey it also checks that DataPass makes no network call except to localhost, only starts `git` with read-only commands, and writes nothing outside `.datapass/` that you did not do yourself.
- **What you get:** `qa/v5/report.json` (one line per row: `green`, `red`, `missing`, `cut` or `deferred`) and the screenshots `qa/v5/shots/v5-NN-*.png` used by the V5 tutorial.

## Row statuses

| Status | Meaning |
|---|---|
| green | every step and every boundary check passed |
| red | a step failed or a boundary check found something (the report says which) |
| missing | the feature is not in this build yet; the report names the command/setting and the MR that brings it |
| cut | the package left V5 (cut order TL-10) |
| deferred | the row belongs to the other half of the run (V5E2E1b) |

V5 is accepted only when every row is green or cut.

## Test stand-ins

- `qa/v5/harness/spy`: a test-only extension loaded beside DataPass that records its network and process calls.
- `qa/v5/harness/data-xray-stub`: answers the Data X-Ray sample command with a plain CSV reader, so the Power-Query sample row runs without installing Data X-Ray.

Neither is packaged in the VSIX (`qa/**` is excluded).
