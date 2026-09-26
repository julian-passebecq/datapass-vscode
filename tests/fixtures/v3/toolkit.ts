/**
 * Synthetic toolkit of a hub repository (0.21): `.datapass/toolkit/tools.json` (tools the hub adds
 * or corrects, and one "Needs a newer DataPass" request) and `.datapass/toolkit/recipes/fabric.json`
 * (the Copy Job bulk edit of 08_TOOLKIT_AND_AGENTS.md section 4, a fabric-cicd deployment and PBIP
 * with Git). Shared by the public example (examples/v3/hub), the unit tests and the desktop fixture.
 */

export function hubToolsJson(): Record<string, unknown> {
  return {
    format: "datapass.toolkit", version: "1", title: "Example Org toolkit", updated: "2026-09-26",
    requires: { datapass: ">=0.21.0" },
    tools: [
      { id: "ext.fabric-studio", verified: { on: "2026-09-25", version: "2.25.2" }, maintainer: "Gerhard Brueckl",
        links: { repo: "https://github.com/gbrueckl/FabricStudio", marketplace: "https://marketplace.visualstudio.com/items?itemName=GerhardBrueckl.fabricstudio" },
        install: [{ method: "marketplace", id: "GerhardBrueckl.fabricstudio" }, { method: "extension-pack", tool: "pack.powerbi-gbrueckl" }],
        modules: ["develop", "pipelines", "cicd", "admin"], complements: ["ext.fabric", "ext.fabric-data-engineering", "cli.fab"],
        sideEffects: ["reads-remote", "writes-remote", "credential-prompt"],
        useWhen: "Edit an item definition without Git, run REST calls, manage deployment pipelines from VS Code.",
        avoidWhen: "The workspace is connected to Git: edit the files in the repository instead." },
      { id: "acc.fabric-toolbox", label: "Fabric Toolbox (Fabric CAT)", kind: "accelerator", publisher: "microsoft", status: "active",
        links: { repo: "https://github.com/microsoft/fabric-toolbox" }, modules: ["monitoring", "cicd", "governance"],
        sideEffects: ["reads-remote", "writes-remote"],
        useWhen: "Monitoring and cost (FUAM, FCA), CI/CD accelerators, Semantic Model Audit, once a real tenant or capacity exists.",
        avoidWhen: "No Fabric administrator rights or no capacity yet.",
        priceModel: "included", freeTier: "The repository's content is free to use; it runs on a Fabric capacity, billed separately.",
        pricingUrl: "https://azure.microsoft.com/pricing/details/microsoft-fabric/", checkedAt: "2026-09-26" },
      { id: "learn.fabcon-prodev", label: "FabCon Atlanta Pro Dev workshop", kind: "learning", publisher: "community",
        links: { repo: "https://github.com/slammini/FabConAtlantaProDev" }, modules: ["develop", "cicd"],
        useWhen: "The first Power BI mini-project: PBIP, TMDL, PBIR, AI and DevOps labs." },
      { id: "cli.pbi-tools", label: "pbi-tools", kind: "cli", publisher: "community", status: "superseded", replacedBy: "py.fabric-cicd",
        links: { home: "https://pbi.tools/" }, modules: ["cicd"],
        avoidWhen: "New projects: PBIP in Power BI Desktop, Git integration and fabric-cicd cover it. Keep it only for a legacy .pbix-only project." }
    ],
    datapassRequests: [
      { title: "Probe the Tabular Editor 3 version", why: "Recipes for semantic model audits need Tabular Editor 3 (paid editions); DataPass cannot tell whether it is installed.",
        example: "a probe for app.tabular-editor that reads the installed version", module: "governance" }
    ]
  };
}

export function hubRecipesJson(): Record<string, unknown> {
  return {
    format: "datapass.toolkit", version: "1", title: "Fabric and Power BI recipes", updated: "2026-09-26",
    recipes: [
      { id: "fabric.item-definition.bulk-edit", module: "pipelines", title: "Bulk-edit a Fabric item definition (Copy Job, pipeline…)",
        when: "Many repetitive changes in one item's JSON (for example lower-casing every destination table and column of a Copy Job).",
        routes: [
          { id: "git", title: "Git integration (official)", if: { fact: "fabric.gitBinding" }, tools: ["cli.git"],
            steps: ["Get updates", "Ask the AI to edit the files (pack)", "Review the diff", "Commit", "Update all in the workspace"] },
          { id: "fab", title: "Fabric CLI", tools: ["cli.fab"],
            steps: [
              { text: "Export a backup and a working copy", copy: "fab export <ws>.Workspace/<item>.CopyJob -o <folder>" },
              "Edit the JSON",
              { text: "Import it back", copy: "fab import <ws>.Workspace/<item>.CopyJob -i <folder>/<item>.CopyJob" }
            ], note: "The import creates or modifies the item and drops its sensitivity label." },
          { id: "fabric-studio", title: "Fabric Studio (community)", tools: ["ext.fabric-studio"], steps: ["Open the item under fabric://", "Edit", "Publish"] }
        ],
        checks: ["A backup exists", "One environment at a time", "The item opens and runs in the portal"],
        risks: ["Publishing or importing replaces the definition in the workspace immediately", "fab import drops the sensitivity label"],
        practice: "testlab: copy-job-bulk-edit", verified: { on: "2026-09-25" } },
      { id: "fabric.deploy.fabric-cicd", module: "cicd", title: "Deploy a Fabric Git folder from dev to prod with fabric-cicd",
        when: "The items live in the repository (Fabric Git format) and production must receive the same items with its own ids.",
        tools: ["py.fabric-cicd", "cli.git"],
        routes: [
          { id: "ci", title: "In the CI pipeline", tools: ["py.fabric-cicd"],
            steps: [
              "List the ids that differ per environment in the ID map (identifiers with values per environment)",
              { text: "Write parameter.yml: each dev id and its prod value", open: "https://microsoft.github.io/fabric-cicd/" },
              { text: "Pin the library in the pipeline", copy: "pip install \"fabric-cicd>=0.1.20,<1\"" },
              "Run the pipeline for prod after the pull request is merged",
              "Check the items in the prod workspace"
            ] }
        ],
        checks: ["parameter.yml names every dev id the items contain", "The pipeline signs in with a federated credential, no secret in the repository"],
        risks: ["A dev id left in an item points production at dev data"], practice: "testlab: fabric-cicd-dev-prod" },
      { id: "powerbi.pbip-git", module: "develop", title: "Keep a Power BI model and report in Git (PBIP)",
        tools: ["app.pbi-desktop", "ext.tmdl", "cli.git"],
        routes: [
          { id: "desktop", title: "Power BI Desktop and VS Code", tools: ["app.pbi-desktop", "ext.tmdl"],
            steps: ["Save the report as a Power BI project (.pbip) in the repository", "Edit measures in TMDL in VS Code, or in Desktop", "Review the diff", "Commit and open a pull request"] }
        ],
        checks: ["The .pbip opens in Power BI Desktop"], risks: ["A .pbix saved beside the .pbip hides changes from review"] }
    ]
  };
}

export function hubToolkitFiles(): Record<string, string> {
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  return { ".datapass/toolkit/tools.json": json(hubToolsJson()), ".datapass/toolkit/recipes/fabric.json": json(hubRecipesJson()) };
}
