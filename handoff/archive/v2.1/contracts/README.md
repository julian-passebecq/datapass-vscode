# Design contracts, not runtime manifests

`portable-item.schema.json` is a deliberately small, strict **design fixture** showing the separation between kind, purpose, native representation, source and target profiles. It does not replace `schemas/datapass-project.schema.json` and does not authorize an action.

The examples require `exampleOnly: true`, use unbound/proposed source references and mark every target action `not-qualified`. Paths are illustrative, not claimed existing files. The FOIL example omits all scientific/commercial parameter values.

The namespace extension object is preserved data, not executable configuration. Production implementations need pack-specific schemas, approved action registries and all semantic/security checks described in 02/06. This fixture schema intentionally does not implement filesystem scope security, secret detection, DAG validation or a provider API.

Implement additional production contracts for artifact revisions, target bindings, context envelopes, proposed operations, approval receipts, execution observations and portability assessments after reviewing the corresponding documents. Do not mistake a partially permissive metadata object for a completed security policy.

Run the offline fixture check from the repo with a Python environment containing `jsonschema >= 4.18`:

```bash
python handoff/v2.1/validation/validate_examples.py
```

No network access, package installation, native DAG execution or cloud deployment occurs in that script. It validates only the design subset and selected invariants.
