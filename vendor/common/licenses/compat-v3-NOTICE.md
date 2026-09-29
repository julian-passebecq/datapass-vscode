# Internal candidate — redistribution gate

The new adapter code is Common first-party MIT code. `src/authority/reader.ts` is a reproducible tree-shaken capture of the DataPass V3 readers and semantic rules at commit `99c670867acd33ab46af49148315655a75d08a55`. The exact source paths, hashes, transformations and generated schemas are recorded in `authority/provenance.json`.

That DataPass revision declares UNLICENSED in package.json and has no root LICENSE file. The Common MIT decision does not automatically relicense donor code. This package is private and must not be published or redistributed outside the authorized internal candidate workflow until donor ownership/licensing is confirmed. Packaging this internal candidate does not transfer V3 schema ownership. The generated reader is necessary to preserve existing semantic rules and diagnostic behavior that the generated JSON schemas alone do not express.

The existing managed schemas, examples, toolkit and product consumers remain unchanged. Build-time tools read an explicitly supplied donor checkout at the pinned commit; delivered runtime code never reads a checkout or performs IO.
