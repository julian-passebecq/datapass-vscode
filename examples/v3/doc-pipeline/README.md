# Document pipeline (example)

A public, generic DataPass example for **switchable variants** (guide page
[10 — Switching variants](../../../docs/guide/10_SWITCHING_VARIANTS.md)).

PDFs arrive in a storage container and a shared script (`processing/process.py`) turns each one into
a JSON result. What *starts* the processing has three variants, declared as the options of one
decision in `.datapass/options.json` and as three scenarios:

| Variant | What starts the processing | Coding state here |
|---|---|---|
| A — direct script | `orchestration/direct/run.py`, by hand or on a schedule | coded (the current architecture in `graph.json`) |
| B — Blob event + Function | a blob-triggered Azure Function in `orchestration/blob-function/` | partly coded (`host.json` is missing) |
| C — Data Factory | a pipeline in a planned `factory` repository | not coded |

Open the folder in VS Code with DataPass and click the **active variant** item in the status bar:
switch A → B → C. The Project tree, Details, the diagram and *Copy Context for My AI* follow; nothing
is written in the repository. *Record decision* in Options is what commits a choice.

For brevity the code sits beside `.datapass/` here. A real project keeps its code in native
repositories and the bridge holds only links and DataPass files.
