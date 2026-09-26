# Document pipeline (example)

A public, generic DataPass example for **variants you preview and switch** (guide page
[10 — Switching variants](../../../docs/guide/10_SWITCHING_VARIANTS.md)).

PDFs arrive in a storage container and a shared script (`processing/process.py`) turns each one into
a JSON result. What *starts* the processing has three variants, declared as the options of one
decision in `.datapass/options.json` and as three scenarios:

| Variant | What starts the processing | Files on disk here |
|---|---|---|
| A — direct script | `orchestration/direct/run.py`, by hand or on a schedule | files present (the current architecture in `graph.json`) |
| B — Blob event + Function | a blob-triggered Azure Function in `orchestration/blob-function/` | some files present (`host.json` is missing) |
| C — Data Factory | a pipeline in a planned `factory` repository | no files |

Open the folder in VS Code with DataPass and click the **selected variant** in the status bar:
switch A → B → C. The Project tree, Details, the diagram and *Copy Context for My AI* follow; nothing
is written in the repository. That is a **preview**. **Testing** a variant is a native check on a
declared environment, approved separately; **activating** one (making it the live route: switch the
trigger owner, drain, verify) is operational and happens outside DataPass. *Record decision* in
Options is what commits a choice. "Files present" means present on disk, not built, tested or
deployed.

For brevity the code sits beside `.datapass/` here. A real project keeps its code in native
repositories and the bridge holds only links and DataPass files.
