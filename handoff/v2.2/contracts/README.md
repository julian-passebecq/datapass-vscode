# Executable draft contracts

`contract_kit.py` is the single source for five JSON Schema Draft 2020-12 design envelopes and six synthetic examples. It is not the production TypeScript importer, not the DataPass v1 manifest schema, not a native FOIL/Fabric schema and not a trusted authorization service.

Run with Python 3.10+ and an installed jsonschema 4.x:

```sh
python handoff/v2.2/contracts/contract_kit.py --out /tmp/datapass-v22-contracts
```

This writes these schema families plus examples and a validation report:

- `datapass.io-contract/0.1-draft`: grain, schema identity, units, time, delivery and ports.
- `datapass.app-exchange/0.1-draft`: external request/result, base/input refs and artifacts.
- `datapass.authority-snapshot/0.1-draft`: bounded query source, age, result status and omissions.
- `datapass.architecture-view/0.1-draft`: selected semantic graph for an external presentation adapter.
- `datapass.publication-brief/0.1-draft`: claims/sources/audience/outputs, explicitly not publication-authorized.

Examples use synthetic placeholders, including a non-FOIL retail project. They contain no original scientific geometry, client budgets, credentials or live endpoints. Hashes marked as fixture values do not refer to real project data. Generated schemas are intentionally produced from one executable source rather than hand-maintained copies.

## What the tests establish

Strict example structure, version rejection, finite/duplicate-key parsing, bounded import size, graph endpoint/identity checks, request/result correlation, wrong scope/base/input/request-byte rejection, snapshot status consistency and basic audience/source consistency. Native request bytes are frozen before hashing; a result carries their digest. The request cannot hash itself circularly.

## What they do not establish

Authentication, real approval authority, content redaction, signature verification, filesystem safety, provider semantics, native schema migration, atomic multi-file/repo writes, access to real artifacts, scientific correctness, cloud execution or DiagramCloud native compatibility. The test checks example evidence references, not the evidence they point to.

**Imported `approved` or `reviewed-for-generation` fields are claims, never grants.** The real host must look up or obtain a human approval for the exact digest/audience in its trusted review context. A clipboard payload cannot authorize itself. Reclassifying a confidential source by changing a label is not sanitization.

The production schema will likely split additional records such as AppDescriptor, QuerySpec, ActionApproval and native ArtifactRevision. Evolve this draft explicitly; do not force all native/provider fields into these small examples. Refer to chapters 03–07 for the required semantic and security checks beyond JSON Schema.
