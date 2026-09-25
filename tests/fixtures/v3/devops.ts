/**
 * Synthetic 0.16 DevOps project (no FOIL or client content): one repository per Git host — GitHub,
 * Azure DevOps, GitLab — each with its CI definition. The Azure DevOps repository is declared with
 * the address its Clone button copies (https://{org}@dev.azure.com/…) while its clone's origin uses
 * the SSH form: DataPass must recognise them as one repository. Shared by the unit tests, the
 * desktop fixture "v3-devops" and testlab project 6.
 */
import type { DataPassProjectManifest } from "../../../src/core/projectManifestModel";

export const DEVOPS_REMOTES = {
  web: "https://github.com/example-org/shop-web",
  webOrigin: "git@github.com:example-org/shop-web.git",
  api: "https://example-org@dev.azure.com/example-org/Shop%20Platform/_git/orders-api",
  apiOrigin: "git@ssh.dev.azure.com:v3/example-org/Shop%20Platform/orders-api",
  data: "git@gitlab.com:example-group/data/shop-data-jobs.git"
} as const;

export function manifestDevops(): DataPassProjectManifest {
  return {
    schemaVersion: 4,
    project: { id: "shop-platform", title: "Shop platform", description: "Synthetic DataPass 0.16 example: one repository per Git host, CI on each." },
    modules: { mongoku: false },
    repositories: {
      web: { label: "Web app", remote: { url: DEVOPS_REMOTES.web, branch: "main" }, description: "Front end, built by GitHub Actions" },
      api: { label: "Orders API", remote: { url: DEVOPS_REMOTES.api, branch: "main" }, description: "API, built by Azure Pipelines" },
      data: { label: "Data jobs", remote: { url: DEVOPS_REMOTES.data, branch: "main" }, description: "Nightly jobs, built by GitLab CI/CD" }
    },
    environments: [{ id: "dev", title: "Development" }, { id: "prod", title: "Production", production: true }],
    graph: ".datapass/graph.json",
    scopes: [{ id: "delivery", title: "Delivery", objective: "Every repository builds on its own host", itemRefs: ["web-ci", "api-ci", "data-ci"] }]
  };
}

export function graphDevopsJson(): Record<string, unknown> {
  return {
    format: "datapass.graph", version: "0.2",
    items: [
      { id: "web-ci", kind: "pipeline", label: "Web CI (GitHub Actions)", provider: "github-actions", artifacts: { repoRef: "web", profile: "github-actions" } },
      { id: "api-ci", kind: "pipeline", label: "API pipeline (Azure Pipelines)", provider: "azure-pipelines", artifacts: { repoRef: "api", profile: "azure-pipelines" } },
      { id: "data-ci", kind: "pipeline", label: "Data jobs pipeline (GitLab CI/CD)", provider: "gitlab-ci", artifacts: { repoRef: "data", profile: "gitlab-ci" } }
    ],
    relations: []
  };
}

/** Files of the two clones present on the machine (the GitLab repository is not cloned). */
export const DEVOPS_FILES = {
  web: {
    ".github/workflows/ci.yml": "name: ci\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
    ".github/workflows/deploy.yaml": "name: deploy\non:\n  workflow_dispatch:\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo deploy\n",
    "README.md": "# shop-web (synthetic)\n"
  },
  api: {
    "azure-pipelines.yml": "trigger:\n  - main\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: echo build\n",
    "README.md": "# orders-api (synthetic)\n"
  }
} as const;
