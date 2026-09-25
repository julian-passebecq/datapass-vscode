# Instructions for AI assistants preparing this project

Read `.datapass/project.json` and `.datapass/graph.json` first. The guide is
https://github.com/julian-passebecq/datapass-vscode/blob/main/docs/PREPARING_A_PROJECT.md

- Fabric items stay in Fabric's Git format under `fabric/`; the semantic model stays a PBIP under
  `powerbi/`. Deliver a branch or pull request; a person reviews and merges it.
- Refer to workspaces, lakehouses and subscriptions by their ID map id (`ws-sales`, `lh-sales`,
  `sub-data`), never by pasting a GUID into prose. When an id changes, change it in `identifiers`.
- Keep `toolchain` and `.vscode/extensions.json` in line: an extension the project needs is in both.
- Never write secrets, keys, tokens or connection strings anywhere; `identifiers` holds ids only.
  Connections are declared by name; the person signs in with the official CLIs.
- Do not claim anything is deployed or tested. Say which check to run in which official tool.
