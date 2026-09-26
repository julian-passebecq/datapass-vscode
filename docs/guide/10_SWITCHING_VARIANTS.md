# 10. Switching variants (DataPass ≥ 0.25)

For the person who works on a project with several architecture variants, and for the AI that
prepares them. Complete, test-validated example:
[`examples/v3/doc-pipeline`](../../examples/v3/doc-pipeline/) (one pipeline, three ways to
orchestrate it). How to declare variants: [page 2, "Declaring variants"](02_WHAT_THE_AI_PREPARES.md).

## What it is

A project often keeps several variants of the same thing side by side: a direct script, an
event-driven Function, a Data Factory pipeline. Each is an **option** of one decision in
`.datapass/options.json`, and a named combination is a **scenario**. The **active variant** is the
one you are working on right now. DataPass remembers it **on this machine, per project** (VS Code's
global state). It never writes it in a repository and never shares it.

Everything that shows the architecture follows the active variant:

| Where | What changes |
|---|---|
| Status bar (Standard mode and above) | A versions icon, then `B — Blob event + Function · partly coded`: the name and its coding state. Click to switch |
| Project tree | *Selected architecture* and the components and files of that variant (DataPass and Advanced modes) |
| Diagram and Details | The variant's components, added and replaced ones marked, removed ones faded |
| Workbench, Options | The *Active variant* banner and selector |
| *Copy Context for My AI*, options packs, options work orders | A header line: `Active variant (this machine's working choice, not a decision): **B — …** — coding state: partly coded (…)` |

## Switching in 1–2 clicks

1. Click the active variant in the status bar (or run **DataPass: Switch the Active Variant**).
2. Pick a scenario: *Current architecture*, *Decided (to apply)* when a decision is recorded, or
   any scenario from options.json. Each one shows its coding state (coded, partly coded, not coded,
   not checked here).

Choosing a scenario in the Workbench's selector or on the diagram does the same. Nothing is
reconfigured: the declarations already say which components and files each variant uses.

## What it is not

- **Not a decision.** *Record decision* in Options is still the committed path: it writes `chosen`
  in options.json, and a pull request applies it to `graph.json`.
- **Not shared.** Another person, or another machine, has its own active variant.
- **Not a branch switch.** A variant lives in its own folder or its own repository; DataPass does not
  check out branches or tags.

## When the variant disappears

If a pull request removes the scenario (or the option) you were working on, DataPass goes back to
the current architecture and says so once. Picks that partly vanished keep the options that still
exist.

## For the AI that prepares variants

- Declare each variant as an option with its `changes` (components and their `artifacts`), and one
  scenario per variant the person will switch to, with a clear title (`A — direct script`).
- Give prices per option in their own currency, with `source` and `asOf`. DataPass never converts
  currencies.
- Do not mark anything "coded": DataPass derives the coding state from the files it finds.
- Never write the active variant anywhere. It is the person's local choice.
