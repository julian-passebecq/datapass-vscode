# Verification report — documentation/fixture pass

Date: 2026-09-24.

## Checks performed locally

- Three new item design examples validate against the supplied draft JSON schema.
- Facet and identity checks pass: notebook versus purpose/provider, separate Airflow hosting profiles, optional FOIL domain metadata with no parameter values or truth promotion.
- Five deliberately invalid variants are rejected: wrong contract version, unknown shell field, disabled example marker, combined type path, falsely qualified action state.
- Duplicate JSON keys are rejected by the fixture loader.
- The uploaded R0 archive has 76 file entries; all 75 manifest-listed file sizes/digests match.
- Nine R0 case JSONs validate against their supplied native experiment schema.
- The replay contains 540 distinct event IDs with no mismatch against its cases' native semantic hashes.

## Not performed / not claimed

No extension runtime refactor, new VSIX, desktop smoke, provider API call, cloud provisioning, native DAG deployment, physical calculation validation, CAD regeneration or browser interaction test. The upstream R0 report says 51 tests passed; that full suite was not rerun in this pass.

The fixture validator is not the future production import security suite. Airflow discovery, YAML/path handling, receipts, native provider interoperability and all negative scenarios in 08 still require implementation and testing.

Only design documents, examples and their small offline validator are added by this handoff. Existing runtime code and historical handoff files are preserved.
