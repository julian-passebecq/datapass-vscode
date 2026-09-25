# Shop platform — coordination repository (example)

Synthetic DataPass 0.16 example: one repository per Git host, each built by its own CI.

| Repository | Host | Declared address | CI |
|---|---|---|---|
| `web` | GitHub | `https://github.com/example-org/shop-web` | GitHub Actions (`.github/workflows/*.yml` or `.yaml`) |
| `api` | Azure DevOps | `https://example-org@dev.azure.com/example-org/Shop%20Platform/_git/orders-api` (what "Clone" copies) | Azure Pipelines (`azure-pipelines.yml`) |
| `data` | GitLab | `git@gitlab.com:example-group/data/shop-data-jobs.git` | GitLab CI/CD (`.gitlab-ci.yml`) |

A clone of `api` made with its SSH address (`git@ssh.dev.azure.com:v3/example-org/Shop%20Platform/orders-api`)
is the same repository for DataPass. Each repository offers its pages (repository, pull requests,
pipelines, boards or issues) and each pipeline its runs; DataPass shows the address and opens it in
the browser, never calls the host's API.

The repositories (example-org, example-group) do not exist: the pages open on "not found", which is
fine for trying the example.
