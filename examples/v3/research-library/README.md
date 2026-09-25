# Research library — coordination repository (example)

Synthetic DataPass V3 example: the coordination repository of a small document pipeline spread over
several repositories. Open this folder in VS Code with DataPass installed.

- `.datapass/project.json` — repositories (one cloned next to this one, one elsewhere, one planned),
  environments, sub-projects.
- `.datapass/graph.json` — components, the files each expects in which repository, operations per
  environment, links between steps.
- `AGENTS.md` — what an AI assistant must respect when it prepares files for this project.

Flow of the "Papers pipeline" sub-project:

```text
PDF archive (Blob) → Data Factory pipeline ⇢ PDF extraction (Azure Function) → Cosmos staging
                                                         → human review → published knowledge (MongoDB Atlas)
```

The repositories (github.com/example-org/…) do not exist: DataPass shows them as not cloned or
planned, which is exactly what the example is for.
