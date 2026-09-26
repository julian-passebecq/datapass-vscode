# 10. Previewing variants: the selected variant (DataPass ≥ 0.25)

For the person who works on a project with several architecture variants, and for the AI that
prepares them. Complete, test-validated example:
[`examples/v3/doc-pipeline`](../../examples/v3/doc-pipeline/) (one pipeline, three ways to
orchestrate it). How to declare variants: [page 2, "Declaring variants"](02_WHAT_THE_AI_PREPARES.md).

## Three verbs: preview, test, activate

| Verb | What it is | Where |
|---|---|---|
| **Preview** | Choose A, B or C: the tree, Details, the diagram and the packs for your AI show that variant. Nothing else changes | DataPass: the **selected variant** (this page) |
| **Test** | A native check of that variant on a declared environment, approved separately, reported with the scenario, its configuration and the commit | The official tools; DataPass shows the route (Readiness, work orders) |
| **Activate** | Make a variant the live route: switch the trigger owner, drain what is in flight, verify | Operational, **outside DataPass**. DataPass never activates a variant and does not observe the live route |

## What the selected variant is

A project often keeps several variants of the same thing side by side: a direct script, an
event-driven Function, a Data Factory pipeline. Each is an **option** of one decision in
`.datapass/options.json`, and a named combination is a **scenario**. The **selected variant** is the
one you are previewing right now. DataPass remembers it **on this machine, per project** (VS Code's
global state). It never writes it in a repository and never shares it.

Everything that shows the architecture follows the selected variant:

| Where | What changes |
|---|---|
| Status bar (Standard mode and above) | A versions icon, then `Variant: B — Blob event + Function · preview`. Click to switch |
| Project tree | *Selected architecture* and the components and files of that variant (DataPass and Advanced modes) |
| Diagram and Details | The variant's components, added and replaced ones marked, removed ones faded |
| Workbench, Options | The *Selected variant* banner and selector |
| *Copy Context for My AI*, options packs, options work orders | A header line: `Selected variant (preview on this machine — not a decision, not a deployment): **B — …** · files: some files present (…). Live route: not observed by DataPass.` |

## Files present, not "done"

Next to each option and scenario DataPass shows what it finds on disk:

| Badge | Meaning |
|---|---|
| files present | every required file of its components is here |
| some files present | some are here, some are missing |
| no files | no file yet, no files declared, or only planned repositories |
| not checked here | the files cannot be seen on this machine |

The files are **present on disk; not built, tested or deployed**. A variant with its files present
may still fail its test, and is not live until someone activates it.

## Switching in 1–2 clicks

1. Click the variant in the status bar (or run **DataPass: Switch the Selected Variant**).
2. Pick a scenario: *Current architecture*, *Decided (to apply)* when a decision is recorded, or
   any scenario from options.json. Each one shows what DataPass found on disk.

Choosing a scenario in the Workbench's selector or on the diagram does the same. Nothing is
reconfigured: the declarations already say which components and files each variant uses.

## What it is not

- **Not a decision.** *Record decision* in Options is still the committed path: it writes `chosen`
  in options.json, and a pull request applies it to `graph.json`.
- **Not a deployment.** Previewing B does not start, stop or re-route anything. The live route is
  whatever was activated in the environment; DataPass does not observe it.
- **Not shared.** Another person, or another machine, has its own selected variant.
- **Not a branch switch.** A variant lives in its own folder or its own repository; DataPass does not
  check out branches or tags.

## When the variant disappears

If a pull request removes the scenario (or the option) you were previewing, DataPass goes back to
the current architecture and says so once. Picks that partly vanished keep the options that still
exist.

## For the AI that prepares variants

- Declare each variant as an option with its `changes` (components and their `artifacts`), and one
  scenario per variant the person will switch to, with a clear title (`A — direct script`).
- Give prices per option in their own currency, with `source` and `asOf`. DataPass never converts
  currencies.
- Do not mark anything "coded" or "ready": DataPass derives what is on disk from the files it finds.
- Read the *Selected variant* line of a pack as the person's preview, never as the running
  architecture. Ask how the variant is tested and activated; do not assume it is live.
- Never write the selected variant anywhere. It is the person's local choice.
