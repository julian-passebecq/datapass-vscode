/**
 * Synthetic toolkit of a hub repository (0.23): `.datapass/toolkit/tools.json` (tools the hub adds
 * or corrects, and one "Needs a newer DataPass" request) and `.datapass/toolkit/recipes/fabric.json`
 * (the Copy Job bulk edit of 08_TOOLKIT_AND_AGENTS.md section 4, a fabric-cicd deployment and PBIP
 * with Git). Shared by the public example (examples/v3/hub), the unit tests and the desktop fixture.
 */

export function hubToolsJson(): Record<string, unknown> {
  return {
    format: "datapass.toolkit", version: "1", title: "Example Org toolkit", updated: "2026-09-26",
    tools: [
      { id: "ext.fabric-studio", verified: { on: "2026-09-26", version: "2.25.2" }, maintainer: "Gerhard Brueckl",
        links: { repo: "https://github.com/gbrueckl/FabricStudio", marketplace: "https://marketplace.visualstudio.com/items?itemName=GerhardBrueckl.fabricstudio" },
        install: [{ method: "marketplace", id: "GerhardBrueckl.fabricstudio" }, { method: "extension-pack", tool: "pack.powerbi-gbrueckl" }],
        modules: ["develop", "pipelines", "cicd", "admin"], complements: ["ext.fabric", "ext.fabric-data-engineering", "cli.fab"],
        sideEffects: ["reads-remote", "writes-remote", "credential-prompt"],
        useWhen: "Edit an item definition without Git, run REST calls, manage deployment pipelines from VS Code.",
        avoidWhen: "The workspace is connected to Git: edit the files in the repository instead." },
      { id: "acc.fabric-toolbox", label: "Fabric Toolbox (Fabric CAT)", kind: "accelerator", publisher: "microsoft", status: "active", verified: { on: "2026-09-26" },
        links: { repo: "https://github.com/microsoft/fabric-toolbox" }, modules: ["monitoring", "cicd", "governance"],
        sideEffects: ["reads-remote", "writes-remote"],
        useWhen: "Monitoring and cost (FUAM, FCA), CI/CD accelerators, Semantic Model Audit, once a real tenant or capacity exists.",
        avoidWhen: "No Fabric administrator rights or no capacity yet.",
        note: "A collection by the Fabric Customer Advisory Team (monitoring, accelerators, samples, scripts, tools, and two sample MCP servers: DAX Performance Tuner and Semantic Model), supported on a best-effort basis through GitHub issues. Pick one item; it is neither one product nor Microsoft's official Fabric MCP servers (README checked 2026-09-26).",
        priceModel: "included", freeTier: "The repository's content is free to use; it runs on a Fabric capacity, billed separately.",
        pricingUrl: "https://azure.microsoft.com/pricing/details/microsoft-fabric/", checkedAt: "2026-09-26" },
      { id: "learn.fabcon-prodev", label: "FabCon Atlanta Pro Dev workshop", kind: "learning", publisher: "community", verified: { on: "2026-09-26" },
        links: { repo: "https://github.com/slammini/FabConAtlantaProDev" }, modules: ["develop", "cicd"],
        useWhen: "The first Power BI mini-project: PBIP, TMDL, PBIR, AI and DevOps labs." },
      { id: "cli.pbi-tools", label: "pbi-tools", kind: "cli", publisher: "community", status: "superseded", replacedBy: "py.fabric-cicd", verified: { on: "2026-09-26" },
        links: { home: "https://pbi.tools/" }, modules: ["cicd"],
        avoidWhen: "New projects: PBIP in Power BI Desktop, Git integration and fabric-cicd cover it. Keep it only for a legacy .pbix-only project." },
      // MCP servers (facts read on the official Microsoft Learn pages and READMEs on 2026-09-26). The format has no
      // transport / endpoint / hosts fields yet: they are in `note` and asked for in datapassRequests.
      { id: "mcp.fabric-core", label: "Fabric Core MCP Server (remote)", kind: "mcp-server", publisher: "microsoft", status: "active", verified: { on: "2026-09-26" },
        links: { docs: "https://learn.microsoft.com/en-us/rest/api/fabric/articles/mcp-servers/core-remote/overview-core-mcp-server",
          home: "https://learn.microsoft.com/en-us/rest/api/fabric/articles/mcp-servers/what-is-fabric-mcp-server" },
        modules: ["admin", "ai"], complements: ["mcp.fabric-local", "mcp.fabric-iq"], sideEffects: ["reads-remote", "writes-remote", "credential-prompt"],
        useWhen: "An agent must find, list or manage Fabric workspaces, items, folders and workspace roles with the signed-in user's permissions.",
        avoidWhen: "Querying or changing lakehouse table data (not what its tools do); a client that cannot do Streamable HTTP with Microsoft Entra OAuth; an agent allowed to call tools without approval (the tools create, delete and grant roles).",
        note: "Preview. Microsoft-hosted endpoint https://api.fabric.microsoft.com/v1/mcp/core, transport Streamable HTTP, Microsoft Entra OAuth 2.0 in the browser. Hosts documented: VS Code with GitHub Copilot (recommended), or any MCP host that supports the transport and the Entra flow. Fabric audits supported operations under the executing identity. Results go to the client and its model, which may process data outside Fabric's compliance boundary.",
        priceModel: "included", freeTier: "No separate price for the server on the official pages; it needs an active Fabric tenant and a workspace the user can access.", checkedAt: "2026-09-26" },
      { id: "mcp.fabric-local", label: "Fabric MCP Server (local)", kind: "mcp-server", publisher: "microsoft", status: "active", verified: { on: "2026-09-26" },
        links: { docs: "https://learn.microsoft.com/en-us/rest/api/fabric/articles/mcp-servers/pro-dev-local/overview-local-mcp-server",
          repo: "https://github.com/microsoft/mcp/tree/main/servers/Fabric.Mcp.Server",
          marketplace: "https://marketplace.visualstudio.com/items?itemName=fabric.vscode-fabric-mcp-server" },
        install: [{ method: "marketplace", id: "fabric.vscode-fabric-mcp-server" },
          { method: "command", command: "npx -y @microsoft/fabric-mcp@latest server start --mode all", where: "the command of a stdio server entry in the MCP host's configuration" }],
        modules: ["develop", "data", "pipelines", "ai"], complements: ["mcp.fabric-core", "cli.az"], sideEffects: ["reads-remote", "writes-remote", "credential-prompt"],
        useWhen: "Development: offline Fabric API specs, item schemas and best practices; OneLake files; item creation; Fabric Data Factory pipelines and dataflows.",
        avoidWhen: "Treating it as read-only or documentation-only: its live OneLake, item and Data Factory tools write. Azure Data Factory factories (use Azure tools). Assuming a local server keeps data local.",
        note: "Open source, runs as a local stdio subprocess started by the host. Hosts documented: VS Code with GitHub Copilot (recommended) or any MCP host with stdio. Documentation tools work offline; live tools use configured credentials (az login, or a service principal through environment variables). Local hosting does not mean the client or model processes data locally, and the server emits no Fabric audit log of its own.",
        priceModel: "included", freeTier: "Free and open source; live tools need Fabric access (a tenant and permissions on the target).", checkedAt: "2026-09-26" },
      { id: "mcp.fabric-iq", label: "Fabric IQ MCP (read-only Power BI exploration)", kind: "mcp-server", publisher: "microsoft", status: "active", verified: { on: "2026-09-26" },
        links: { docs: "https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp" },
        modules: ["data", "ai"], complements: ["mcp.fabric-core"], sideEffects: ["reads-remote", "credential-prompt"],
        useWhen: "An agent must find Power BI reports and semantic models, read their metadata and run DAX queries, without changing anything.",
        avoidWhen: "Authoring or administration (it has none); dashboards, paginated reports, apps; Power BI-only regions and sovereign clouds; service-principal or app-only authentication (not supported).",
        note: "Generally available. Remote endpoint https://fabriciq.svc.cloud.microsoft/v1/mcp/fabriciq (private links: https://api.fabric.microsoft.com/v1/mcp/fabriciq), transport Streamable HTTP, delegated Entra OAuth (Item.Read.All, Item.Execute.All, Dataset.Read.All). Host documented: GitHub Copilot CLI (/mcp show FabricIQ); other clients need Streamable HTTP and may need a single-tenant app registration. Read-only still returns rows (250 by default) into the conversation; RLS and OLS apply.",
        priceModel: "included", freeTier: "No separate price on the official page; needs a Microsoft Entra work account with access to the Power BI content, in a tenant whose home region supports all Fabric workloads.", checkedAt: "2026-09-26" },
      { id: "mcp.powerbi-authoring-hosted", label: "Power BI Authoring MCP (hosted)", kind: "mcp-server", publisher: "microsoft", status: "active", verified: { on: "2026-09-26" },
        links: { docs: "https://learn.microsoft.com/en-us/power-bi/developer/mcp/power-bi-authoring-mcp", repo: "https://github.com/microsoft/powerbi-modeling-mcp" },
        modules: ["develop", "ai"], complements: ["plugin.powerbi-authoring"], sideEffects: ["reads-remote", "writes-remote", "credential-prompt"],
        useWhen: "An agent must change a semantic model that lives in a Fabric workspace, with nothing to install.",
        avoidWhen: "Models open in Power BI Desktop or PBIP/TMDL files on disk (it cannot reach the machine: use the local server ext.powerbi-modeling-mcp); report pages, visuals or diagram layouts; the local authoring server is registered for the same agent; a client that needs dynamic OAuth client registration or opens a new session on each call.",
        note: "Preview; formerly Power BI Modeling MCP. Microsoft-hosted endpoint https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring, transport Streamable HTTP, Entra sign-in as the user; stateful (the client must return mcp-Session-Id). Needs the tenant setting 'Users can use the Power BI Model Context Protocol server endpoint (preview)' and Write permission (Build only runs DAX). Host documented: GitHub Copilot in VS Code (agent mode). Model metadata and query results reach the client's LLM provider.",
        priceModel: "included", freeTier: "No separate price on the official page; needs semantic models in a Fabric workspace and the tenant setting enabled by a Fabric administrator.", checkedAt: "2026-09-26" },
      { id: "plugin.powerbi-authoring", label: "Power BI Agentic: powerbi-authoring plugin (Skills for Fabric)", kind: "agent-plugin", publisher: "microsoft", status: "active", verified: { on: "2026-09-26" },
        links: { docs: "https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview", repo: "https://github.com/microsoft/skills-for-fabric" },
        install: [{ method: "command", command: "copilot plugin marketplace add microsoft/skills-for-fabric", where: "GitHub Copilot CLI" },
          { method: "command", command: "copilot plugin install powerbi-authoring@fabric-collection", where: "GitHub Copilot CLI" }],
        modules: ["develop", "ai"], complements: ["ext.powerbi-modeling-mcp", "app.pbi-desktop"], sideEffects: ["installs-software", "reads-remote", "writes-remote", "credential-prompt"],
        useWhen: "An agent must build or refine a semantic model and a PBIR report: semantic-model-authoring and report authoring, design and planning skills, plus the local Power BI Authoring MCP server and the Desktop bridge.",
        avoidWhen: "Expecting the MCP server to edit report layout (report work is the skills editing PBIR files); installing it into a host without checking its compatibility files first; a production model without a copy under Git.",
        note: "Microsoft's official bundle, unlike the data-goblin community plugins (plugin.power-bi-agentic-development): it registers the local Power BI Modeling/Authoring MCP server automatically (Node.js 18+). Optimised for GitHub Copilot CLI; the install scripts write compatibility files for VS Code Copilot, Claude Code, Cursor, Codex/Jules and Windsurf. A documented route to test on a disposable copy, not a qualification of your host.",
        priceModel: "included", freeTier: "The skills and the MCP server are free; the documented host is GitHub Copilot CLI, which needs a GitHub Copilot plan (price not read here).", checkedAt: "2026-09-26" },
      { id: "mcp.azure", label: "Azure MCP Server", kind: "mcp-server", publisher: "microsoft", status: "active", verified: { on: "2026-09-26" },
        links: { docs: "https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/overview",
          marketplace: "https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azure-mcp-server" },
        install: [{ method: "marketplace", id: "ms-azuretools.vscode-azure-mcp-server" },
          { method: "command", command: "npx -y @azure/mcp@latest server start", where: "the command of a server entry in .vscode/mcp.json" }],
        modules: ["admin", "data", "monitoring", "ai"], complements: ["cli.az"], sideEffects: ["reads-remote", "writes-remote", "credential-prompt"],
        useWhen: "Azure resources: storage accounts and blobs, Functions, resource groups, Log Analytics KQL, azd deployments.",
        avoidWhen: "Fabric workspaces and items (use the Fabric MCP servers); assuming Fabric MCP's Data Factory tools control an Azure Data Factory factory, or the reverse.",
        note: "A different family from the Fabric MCP servers. Local server started by the host (VS Code extension, or npx in .vscode/mcp.json); hosts documented: VS Code, Visual Studio 2022 17.14.30+ (built in), Eclipse, Cursor, Windsurf, IntelliJ, Cline. Authenticates with the Azure Identity library (az login, azd, VS Code); what it can do follows your Azure RBAC roles.",
        priceModel: "included", freeTier: "No separate price on the official page; prerequisites are a GitHub Copilot subscription and an Azure account (resources billed by Azure).", checkedAt: "2026-09-26" }
    ],
    datapassRequests: [
      { title: "Probe the Tabular Editor 3 version", why: "Recipes for semantic model audits need Tabular Editor 3 (paid editions); DataPass cannot tell whether it is installed.",
        example: "a probe for app.tabular-editor that reads the installed version", module: "governance" },
      { title: "Say an MCP server's transport, endpoint and documented hosts", module: "ai",
        why: "Choosing an MCP route depends on where the server runs (Microsoft-hosted or a local subprocess), its transport (Streamable HTTP or stdio), its authentication and which hosts Microsoft documents. The toolkit format has no field for them, so they sit in free text and cannot be compared or checked against the host in use.",
        example: "\"mcp\": { \"hosting\": \"remote\", \"transport\": \"streamable-http\", \"endpoint\": \"https://api.fabric.microsoft.com/v1/mcp/core\", \"auth\": \"entra-oauth\", \"hosts\": [\"vscode-copilot\", \"copilot-cli\"] }" },
      { title: "Mark tools whose results reach the AI model's provider", module: "ai",
        why: "A local MCP server does not keep data local: metadata, schemas and query rows go to the client and then to its LLM provider. The sideEffects list has reads-remote and writes-remote but nothing for 'sends data to the model', which is the main risk of a read-only server.",
        example: "\"sideEffects\": [\"reads-remote\", \"credential-prompt\", \"sends-to-model\"]" }
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
              { text: "Write parameter.yml: each dev id and its prod value", open: "https://github.com/microsoft/fabric-cicd" },
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
        checks: ["The .pbip opens in Power BI Desktop"], risks: ["A .pbix saved beside the .pbip hides changes from review"] },
      // Each route walks the same evidence chain: known → installed → registered → connected → authenticated → operation verified.
      { id: "mcp.fabric-sample.inspect-readonly", module: "ai", title: "Inspect a Fabric sample's metadata through an MCP server (read-only)",
        when: "The first MCP experiment: prove the read path on an approved sample (a sample semantic model or workspace) before any agent is allowed to change anything.",
        tools: ["mcp.fabric-iq", "mcp.fabric-core", "ext.powerbi-modeling-mcp", "ws.mcp"],
        routes: [
          { id: "fabric-iq", title: "Fabric IQ MCP (read-only by design)", tools: ["mcp.fabric-iq"],
            steps: [
              { text: "Known: read this entry and its verified date; open the official page and check nothing changed", tool: "mcp.fabric-iq", open: "https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp" },
              "Installed: nothing to install (Microsoft-hosted); the host must support Streamable HTTP and Entra OAuth",
              "Registered: add the FabricIQ http entry with the documented endpoint to the host's MCP configuration yourself (GitHub Copilot CLI: ~/.copilot/mcp-config.json); no Authorization header",
              { text: "Connected: in GitHub Copilot CLI, show the server and its tools", copy: "/mcp show FabricIQ" },
              "Authenticated: sign in with the Entra work account in the browser; note which account and tenant",
              "Operation verified: ask 'Find the <sample> semantic model in Microsoft Fabric. Make no changes. List the tools you called.' Expect DiscoverArtifacts, then GetSemanticModelSchema",
              "Record the evidence: host and version, account, target, tools called, date"
            ] },
          { id: "fabric-core", title: "Fabric Core MCP, list operations only", tools: ["mcp.fabric-core"],
            steps: [
              { text: "Known: read this entry and the Core server's considerations", tool: "mcp.fabric-core", open: "https://learn.microsoft.com/en-us/rest/api/fabric/articles/mcp-servers/core-remote/overview-core-mcp-server" },
              "Installed: nothing to install (remote, preview)",
              "Registered: in VS Code run MCP: Add Server, choose HTTP and give the Core endpoint; check the entry in .vscode/mcp.json",
              "Connected: MCP: List Servers shows it started; its tools are listed",
              "Authenticated: complete the browser Entra sign-in; the identity needs at least Viewer on the sample workspace",
              "Operation verified: ask 'List the items in the <sample> workspace. Make no changes.' Approve each tool call yourself and refuse any create, update, delete or role call",
              "Record the evidence: host and version, account, workspace, tools called, date"
            ], note: "The Core server also exposes tools that create, delete and grant roles: keep per-call approval on." },
          { id: "powerbi-local-readonly", title: "Power BI Authoring MCP (local) with --readonly on a PBIP copy", tools: ["ext.powerbi-modeling-mcp", "ws.mcp"],
            steps: [
              { text: "Known: read the README's read-only and security sections", tool: "ext.powerbi-modeling-mcp", open: "https://github.com/microsoft/powerbi-modeling-mcp" },
              { text: "Installed: install the VS Code extension yourself (DataPass shows whether it is present)", copy: "code --install-extension analysis-services.powerbi-modeling-mcp" },
              "Registered: start the server with the --readonly flag (writes are on by default); do not also register the hosted authoring server",
              "Connected: MCP: List Servers shows it started",
              "Authenticated: a PBIP copy on disk needs no sign-in; a Fabric workspace model asks for Entra sign-in",
              "Operation verified: 'Open semantic model from PBIP folder <copy>/<name>.SemanticModel/definition. List the tables and measures. Make no changes.' Then check git status shows no change",
              "Record the evidence: extension version, flag used, folder, tools called, date"
            ], note: "Windows only for the local server; on macOS use the hosted server against a Fabric sample." }
        ],
        checks: ["Every step of the chain has its own evidence: an entry in mcp.json alone proves only 'registered'", "The identity used is the one you expected (account and tenant)",
          "The agent's list of called tools contains only read tools", "The target was the sample or a copy, never production"],
        risks: ["A local server does not keep data local: metadata, schemas and query rows go to the client and its LLM provider",
          "Read-only still exposes confidential metadata and rows (Fabric IQ returns 250 rows by default)",
          "Fabric audit logs do not record every MCP call (the local server emits none of its own)",
          "Registering the hosted and the local Power BI authoring servers together gives the agent overlapping tools"],
        verified: { on: "2026-09-26" } }
    ]
  };
}

export function hubToolkitFiles(): Record<string, string> {
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  return { ".datapass/toolkit/tools.json": json(hubToolsJson()), ".datapass/toolkit/recipes/fabric.json": json(hubRecipesJson()) };
}
