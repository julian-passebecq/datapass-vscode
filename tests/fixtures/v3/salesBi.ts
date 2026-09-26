/**
 * Synthetic 0.18 project (manifest v5, not FOIL): a Fabric + Power BI sales report kept in one
 * repository — a lakehouse and a notebook in Fabric's Git format, a PBIP semantic model, a GitHub
 * Actions workflow that deploys with fabric-cicd. It declares its toolchain (with version ranges),
 * its ID map (a tenant, a subscription and a workspace with one id per environment) and its
 * connections (Azure CLI and Fabric CLI sign-ins, the workspace's Git binding, a data connection).
 * Every id is invented. Shared by the public example (examples/v3/sales-bi), the unit tests, the
 * desktop fixture "v18-toolchain" and testlab project 8.
 */
import type { DataPassProjectManifest } from "../../../src/core/projectManifestModel";

export const SALES_IDS = {
  tenant: "7f3c2a10-0d4e-4b8a-9c61-2e5f7a9b1c30",
  subDev: "a1b2c3d4-0000-4000-8000-00000000d001",
  subProd: "a1b2c3d4-0000-4000-8000-00000000f001",
  wsDev: "5e1d7c42-8a3b-4f60-9d2e-1b4c6a8e0d11",
  wsProd: "5e1d7c42-8a3b-4f60-9d2e-1b4c6a8e0f22",
  lakehouse: "c0ffee00-1111-4222-8333-444455556666",
  lakehouseProd: "c0ffee00-1111-4222-8333-44445555f777"
} as const;

export function manifestSales(): DataPassProjectManifest {
  return {
    schemaVersion: 5,
    project: { id: "sales-bi", title: "Sales BI", description: "Synthetic DataPass 0.18 example: a Fabric lakehouse, a notebook and a Power BI model, deployed with fabric-cicd." },
    environments: [{ id: "dev", title: "Development" }, { id: "prod", title: "Production", production: true }],
    graph: ".datapass/graph.json",
    scopes: [{ id: "sales", title: "Sales reporting", objective: "A daily sales report from the lakehouse", itemRefs: ["lakehouse", "load", "model", "deploy"],
      checklist: [{ id: "signin", label: "Sign in to Azure and Fabric (Connections)" }, { id: "tools", label: "Install the tools the project needs (Tools & versions)" }] }],
    identifiers: [
      { id: "tenant", label: "Entra tenant", provider: "azure", kind: "tenant", value: SALES_IDS.tenant },
      { id: "sub-data", label: "Data subscription", provider: "azure", kind: "subscription", values: { dev: SALES_IDS.subDev, prod: SALES_IDS.subProd } },
      { id: "ws-sales", label: "Sales workspace", provider: "fabric", kind: "workspace", values: { dev: SALES_IDS.wsDev, prod: SALES_IDS.wsProd } },
      { id: "lh-sales", label: "Sales lakehouse", provider: "fabric", kind: "lakehouse", values: { dev: SALES_IDS.lakehouse, prod: SALES_IDS.lakehouseProd } }
    ],
    toolchain: {
      tools: [
        { tool: "cli.fab", version: ">=1.0" },
        { tool: "cli.az", version: "^2.60" },
        { tool: "cli.git", version: ">=2.40" },
        { tool: "ext.fabric" },
        { tool: "ext.tmdl" },
        { tool: "pack.powerbi-gbrueckl", optional: true },
        { tool: "app.pbi-desktop" },
        { tool: "py.fabric-cicd", version: ">=0.1.20,<1", where: "ci" },
        { tool: "py.semantic-link-labs", where: "fabric" }
      ]
    },
    connections: [
      { id: "azure-dev", kind: "sign-in", label: "Azure CLI (dev subscription)", tool: "cli.az", identifier: "tenant", subscription: "sub-data", environment: "dev" },
      { id: "fabric", kind: "sign-in", label: "Fabric CLI", tool: "cli.fab", identifier: "tenant" },
      { id: "sales-git", kind: "git-binding", label: "Sales workspace ↔ this repository", provider: "fabric", identifier: "ws-sales", environment: "dev", folder: "fabric", branch: "dev" },
      { id: "sales-sql", kind: "cloud-connection", label: "Sales database connection", provider: "fabric", name: "conn-sales-sql", environment: "dev" }
    ]
  };
}

export function graphSalesJson(): Record<string, unknown> {
  return {
    format: "datapass.graph", version: "0.2",
    items: [
      { id: "lakehouse", kind: "storage", label: "Sales lakehouse", provider: "fabric", description: "Raw and cleaned sales tables (Delta).",
        artifacts: { profile: "fabric.item", root: "fabric/Sales.Lakehouse" } },
      { id: "load", kind: "notebook", label: "Load sales (notebook)", provider: "fabric", description: "Reads the daily CSV drop and writes the sales table.",
        artifacts: { profile: "fabric.item", root: "fabric/LoadSales.Notebook", files: ["notebook-content.py"] } },
      { id: "model", kind: "dataset", label: "Sales semantic model", provider: "powerbi", description: "Direct Lake model over the sales table.",
        artifacts: { profile: "powerbi.pbip", root: "powerbi" } },
      { id: "deploy", kind: "pipeline", label: "Deploy to prod (fabric-cicd)", provider: "github-actions", description: "Deploys the fabric/ folder to the prod workspace; parameter.yml swaps the dev ids.",
        artifacts: { profile: "github-actions", files: [{ path: "fabric/parameter.yml", role: "config", description: "fabric-cicd: dev ids replaced per environment" }] } }
    ],
    relations: [
      { id: "r1", source: "load", target: "lakehouse", relation: "produces" },
      { id: "r2", source: "model", target: "lakehouse", relation: "consumes" },
      { id: "r3", source: "lakehouse", target: "deploy", relation: "deployedFrom" }
    ]
  };
}

export const SALES_EXTENSIONS_JSON = {
  recommendations: ["fabric.vscode-fabric", "analysis-services.TMDL", "GerhardBrueckl.powerbi-vscode-extensionpack"]
};

const README = `# Sales BI — Fabric and Power BI (example)

Synthetic DataPass 0.18 example (manifest v5): one repository holding a Fabric lakehouse and notebook
in Fabric's Git format, a Power BI semantic model (PBIP) and a GitHub Actions workflow that deploys
to production with fabric-cicd. Every id is invented.

What v5 adds, and where DataPass shows it (Project view):

- **Tools & versions** — \`toolchain\` in \`.datapass/project.json\`: the Fabric CLI (\`>=1.0\`), the Azure
  CLI (\`^2.60\`), Git, the Fabric and TMDL extensions, the Power BI extension pack (optional), Power BI
  Desktop, fabric-cicd (runs in CI) and semantic-link-labs (runs in Fabric notebooks). DataPass
  compares them with this computer and shows the install command to copy; it installs nothing.
- **.vscode/extensions.json** — the same extensions as workspace recommendations; *Show Recommended
  Extensions* lists them in VS Code.
- **ID map** — \`identifiers\` with one id per environment: the workspace and subscription for dev and
  prod. Hover an id in \`fabric/parameter.yml\` to see which one it is.
- **Connections** — the Azure CLI and Fabric CLI sign-ins (*Check connections* runs \`az account
  show\` and \`fab auth status\`, read-only), the workspace's Git binding and the data connection
  (declared, not checked: DataPass opens the portal page where you verify them).
`;

const AGENTS = `# Instructions for AI assistants preparing this project

Read \`.datapass/project.json\` and \`.datapass/graph.json\` first. The guide is
https://github.com/julian-passebecq/datapass-vscode/blob/main/docs/PREPARING_A_PROJECT.md

- Fabric items stay in Fabric's Git format under \`fabric/\`; the semantic model stays a PBIP under
  \`powerbi/\`. Deliver a branch or pull request; a person reviews and merges it.
- Refer to workspaces, lakehouses and subscriptions by their ID map id (\`ws-sales\`, \`lh-sales\`,
  \`sub-data\`), never by pasting a GUID into prose. When an id changes, change it in \`identifiers\`.
- Keep \`toolchain\` and \`.vscode/extensions.json\` in line: an extension the project needs is in both.
- Never write secrets, keys, tokens or connection strings anywhere; \`identifiers\` holds ids only.
  Connections are declared by name; the person signs in with the official CLIs.
- Do not claim anything is deployed or tested. Say which check to run in which official tool.
`;

const PARAMETER_YML = `# fabric-cicd: replace the dev ids with each environment's (https://microsoft.github.io/fabric-cicd/)
find_replace:
  - find_value: "${SALES_IDS.wsDev}"      # ws-sales (dev)
    replace_value:
      prod: "${SALES_IDS.wsProd}"          # ws-sales (prod)
  - find_value: "${SALES_IDS.lakehouse}"   # lh-sales (dev)
    replace_value:
      prod: "${SALES_IDS.lakehouseProd}"   # lh-sales (prod)
`;

const DEPLOY_YML = `name: deploy-prod
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: prod
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install "fabric-cicd>=0.1.20,<1"
      # Sign-in uses the repository's federated credential (azure/login); no secret is stored here.
      - run: python -c "print('fabric-cicd deploy of fabric/ to the prod workspace (synthetic example)')"
`;

/** 0.23: a board whose cards name the hub's toolkit recipes (examples/v3/hub/.datapass/toolkit). */
export function boardSalesJson(): Record<string, unknown> {
  return {
    format: "datapass.board", version: "1", title: "Sales BI work", updated: "2026-09-26",
    columns: [{ id: "todo", title: "To do" }, { id: "doing", title: "In progress", limit: 3 }, { id: "done", title: "Done", done: true }],
    items: [
      { id: "lowercase-copyjob", type: "task", title: "Lower-case the Copy Job's destination tables and columns", status: "todo", priority: "P2",
        components: ["load"], environment: "dev", recipe: "fabric.item-definition.bulk-edit", route: "git" },
      { id: "first-prod-deploy", type: "task", title: "First deployment to prod with fabric-cicd", status: "doing", priority: "P1",
        components: ["deploy"], files: [{ path: "fabric/parameter.yml" }], environment: "prod", recipe: "fabric.deploy.fabric-cicd" },
      { id: "model-in-git", type: "task", title: "Keep the semantic model in Git (PBIP)", status: "done", components: ["model"], recipe: "powerbi.pbip-git" }
    ]
  };
}

/** Files of the repository (relative path → content). */
export function filesSales(): Record<string, string> {
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  return {
    ".datapass/project.json": json(manifestSales()),
    ".datapass/graph.json": json(graphSalesJson()),
    ".datapass/board.json": json(boardSalesJson()),
    ".vscode/extensions.json": json(SALES_EXTENSIONS_JSON),
    "README.md": README,
    "AGENTS.md": AGENTS,
    "fabric/Sales.Lakehouse/.platform": json({ metadata: { type: "Lakehouse", displayName: "Sales" }, config: { version: "2.0", logicalId: "00000000-0000-0000-0000-000000000001" } }),
    "fabric/LoadSales.Notebook/.platform": json({ metadata: { type: "Notebook", displayName: "LoadSales" }, config: { version: "2.0", logicalId: "00000000-0000-0000-0000-000000000002" } }),
    "fabric/LoadSales.Notebook/notebook-content.py": `# Fabric notebook source\n# METADATA ********************\n# META {"dependencies": {"lakehouse": {"default_lakehouse": "${SALES_IDS.lakehouse}", "default_lakehouse_workspace_id": "${SALES_IDS.wsDev}"}}}\n\n# CELL ********************\ndf = spark.read.option("header", True).csv("Files/drop/sales.csv")\ndf.write.mode("overwrite").saveAsTable("sales")\n`,
    "fabric/parameter.yml": PARAMETER_YML,
    "powerbi/Sales.pbip": json({ version: "1.0", artifacts: [{ report: { path: "Sales.Report" } }], settings: { enableAutoRecovery: true } }),
    ".github/workflows/deploy.yml": DEPLOY_YML
  };
}
