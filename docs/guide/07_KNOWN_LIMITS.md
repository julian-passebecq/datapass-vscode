# 7. Known limits and open bugs (re-read of 0.12 → 0.20, 2026-09-25)

While writing this guide, the docs, the JSON Schemas and the code were compared. Small mismatches
were fixed in the same pull request; the rest is listed here so an AI does not rely on behaviour
that does not exist.

## 7.1 Fixed with this guide

| What | Fix |
|---|---|
| `PREPARING_A_PROJECT.md` §2 was titled "manifest v5" but its example said `schemaVersion: 3`. | Example is v5, with `project.type` (validated). |
| `README.md` still called the current manifest v4. | Says v5 (v3 and v4 still accepted). |
| §6 said only project/graph/catalog are validated as you type. | Lists every file with an editor schema (options, sheet, board, work-log, claims, packs, work orders). |
| `resources[]` / `bindings[]` (VMs, container hosts) were not documented in the contract. | Pointer in §2, full walkthrough in [04 §4.5](04_CUSTOMIZATION.md#45-resources-such-as-vms--worked-example-with-two-vms). |
| `platforms.oracle.sshHost` accepted anything (`opc@130.61.0.10` passed and was then silently ignored). | Runtime and editor schema now require an SSH alias (or empty), like `resources[].ssh.host`. |
| `V3_HANDOFF.md` and `IMPLEMENTATION_STATUS.md` still called 0.20.0 "this pass, branch `claude/work-orders-ai2`"; the handoff described the manifest as v3. | 0.20.0 marked merged (PR #30); manifest v5 named. |

## 7.2 Open — limits of the model

1. **Resources and bindings have no environment.** A dev VM and a prod VM for the same role are
   two resources (and two graph operations with their `environment`). Nothing links them as "the
   same role".
2. **The graph's `vm` target is not cross-checked with `resources[]`.** A graph operation
   `infra.remote.ssh` with `sshHost: "x"` is accepted even when no resource declares the alias `x`.
   Keep both equal by hand.
3. **No reachability check for VMs.** DataPass never connects over SSH itself; it only opens
   Remote - SSH on the alias. "Ready" for a VM means "declared and the extension is installed".
4. **Sign-in checks cover `cli.az`, `cli.fab` and `cli.databricks` only.** Other `sign-in`
   connections, every `git-binding` and every `cloud-connection` (MongoDB Atlas, a Fabric
   connection…) are "declared, not checked"; only Fabric has a portal page derived automatically —
   give the others a `portal` https address.
5. **Identifier values are syntax-checked, not verified.** A wrong subscription id is only caught
   by *Check connections* (az compares tenant and subscription); a wrong resource group or
   workspace id is never caught.
6. **Cross-file references warn, they do not block.** A board card, sheet dataset or option naming
   an unknown component, environment or decision appears in *Problems in project files*; the file
   still loads.
7. **Unknown tool ids are accepted** (shown as "unknown to DataPass" with a suggestion). A typo in
   `toolchain` therefore does not fail validation — check the Tools & versions list.
8. **Work orders on a work project need two switches**: the machine setting
   `datapass.ai.workOrders.enabled` and `modules.workOrders: true`. Either one missing = no order,
   by design.
9. **`project.type` can be overridden per machine** (`datapass.ai.projectTypes` wins). Two people
   can see different defaults for the same project.
10. **FOIL-specific settings remain in the generic extension**: `datapass.foil.controlRoot`,
    `datapass.foil.databricksRoot`, `datapass.foil.oracleSshHost` (from the V1 FOIL profile). Other
    clients ignore them; a later pass should move them behind the FOIL domain pack or retire them.
11. **Planned repositories cannot hold a local path.** "A folder of this repository during the
    pilot" is declared as a repository with `path` (not `planned`), and moved to a `remote` later.
12. **DataPass 0.14–0.17 refuse a v5 manifest.** A person still on those versions needs a v4 file
    (no `toolchain`, `connections`, identifier `values`/`kind`).

## 7.3 Open — to qualify with real accounts (unchanged since V1 gate 16)

Databricks validate/deploy, Fabric browse, Azure Functions run-local/deploy, ADF Studio, VM over
SSH, and the Claude/Codex desktop-app hand-off have unit and desktop tests but have not been run
end to end on a real client account. The first client project is that qualification.

## Trust limits (0.22)

- **Costs.** Declared costs are added per currency and never converted; monthly and one-time
  amounts stay apart. A total with an option or line that has no figure says "partial: n of m
  priced": it is not the full cost. An unknown cost is never 0.
- **File identity.** Files up to a byte budget are hashed (SHA-256). Larger files, or files past the
  budget, are identified by size and modification time only; the component's digest is then
  "weak" and a recorded result is shown as stale rather than matched (two different contents can
  share size and time).
- **Git tracking.** When Git cannot say whether a file that must not be committed is tracked
  (Restricted Mode, an error, output cut short), DataPass says "could not check Git tracking"; it
  never reads that as clean.
- **Repository identity.** A declared repository whose clone has no origin, or whose origin could
  not be read, is "unverified": its files are shown, but Get updates and work orders refuse it
  until the right clone is located or the origin is read again (Retry).
- **Bounded inspection.** At most 16 file reads run at once and at most 2,000 expected files are
  inspected per refresh; anything left out is reported as "inspection incomplete (n skipped)" in
  Problems in project files.
- **Coordinated change sets** (native PR plus bridge PR) are described in the guide; DataPass does
  not yet show them linked in its views (planned for V2).
