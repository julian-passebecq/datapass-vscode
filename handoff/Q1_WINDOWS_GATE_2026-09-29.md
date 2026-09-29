# Q1 — Windows desktop acceptance becomes required

Candidate base: `b046aebcff60407c77967a22ccf3bd4054454c65`, preserving the accepted Claude history and the three CI-cache exclusions in `.vscodeignore`. The unrelated untracked PM handoff is preserved, not staged.

The old failure taxonomy is historical. Current GitLab pipeline **2891705323**, commit `76a22f09e4ee17c38421f241ce8a40ac99f51c95`, desktop job **16796032764** succeeded on local Windows runner **56844575** in 772.1 seconds. Its trace records **20 fixture launches, 421 passing checks, no failed fixture and no final DataPass extension-host error lines**. The runtime path identifies VS Code **1.139.1**. No duplicate baseline suite was launched for Q1.

That actual passing result supports making `desktop_acceptance` required (`allow_failure: false`, including the manually triggered web-pipeline rule). There is no evidence warranting a product or fixture assertion change. GitLab success alone previously did not require this job; now a failure blocks pipeline acceptance. A manually configured web job still needs to be explicitly started before qualification is complete.

Both desktop and installed-VSIX QA resolvers now honor an exact `DATAPASS_TEST_VSCODE_VERSION` pin before any ambient executable or per-user installation. CI sets `1.139.1`, the demonstrated baseline. Invalid non-exact pins fail before download. Local behavior without the pin remains unchanged. The desktop evidence report records the requested version; installed-VSIX QA already records actual VS Code version/commit.

The baseline's verify/package job **16796032762** passed 732 checks with four existing skips; demo job **16796032763** passed ten checks. Its VSIX included CI cache files, so it is **not a release artifact**. Commit b046aeb only added exclusions for `.ci-tools`, `.ci-venv` and `.cache`; it did not change product source. The Q1 candidate pipeline must produce and exercise the newly packaged VSIX. Its exact-head checks, artifact digest and installed UI outcome are separate from the reused baseline desktop evidence.

The package job inspects the actual VSIX ZIP without extracting it, rejects any `.ci-tools`, `.ci-venv` or `.cache` entries and records its size, entry count and SHA256 sidecar as artifacts. This checks the diagnosed packaging regression rather than assuming source ignore rules were honored.

No old assertions were deleted, no retry policy was added, no main merge/migration sign-off is claimed, and no provider work was performed. This Windows service-host evidence is limited to the actual isolated desktop and UI harnesses, not a claim about every user's interactive desktop environment.
