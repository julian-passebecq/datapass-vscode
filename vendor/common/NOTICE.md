# Internal Common candidates

These committed tarballs allow clean-checkout builds without unpublished registry packages or local checkout paths. `manifest.json` pins source revisions and SHA256 digests. Build verifies every tarball before bundling. npm's lockfile additionally binds installed contents and exact transitive dependencies.

This is an internal DataPass candidate, not a public release. Common compat-v3 includes pinned DataPass donor code declared UNLICENSED; its private package NOTICE remains authoritative. New Common adapter/core code is MIT. The product remains UNLICENSED. No publication or relicensing is implied.

The delivered extension bundles runtime code; tarballs are build inputs excluded from the VSIX. Headless Common packages do not acquire files or execute client code. The separate Node host owns bounded acquisition and the bundled static parser; it does not execute the selected source SQL. Complete bundled dependency licences and the compat donor notice are in licenses/.
