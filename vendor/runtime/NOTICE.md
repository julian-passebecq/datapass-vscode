# Internal Windows static parser payload

This archive pins CPython 3.13.15 (PSF licence) and SQLGlot 30.19.0 (MIT). Their complete licence texts are included beside this notice and inside the runtime. The production controller and static syntax worker come from the pinned Common analysis-host-node candidate recorded in pin.json.

Build checks the archive and manifest digests, accepts only the manifest's files, checks every extracted size and digest, and prepares dist/runtime. No download or installation occurs during extension activation. The archive itself is excluded from the internal Windows VSIX.

The source manifest is preserved by its digest in both manifest.json and pin.json. This production subset omits only datapass_worker.py, the qualification-only fixture worker. Production controller/analyzer bytes remain identical. No containment evidence files, qualification fixtures, or test results are included.

This candidate supports only the host package's explicitly qualified Windows/runtime contexts. A packaged runtime does not by itself prove local containment availability; every invocation performs the host's prerequisite checks and reports unavailable on failure.
