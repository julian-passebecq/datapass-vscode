export interface FabricPreflightWorkflowInput {
  workspaceName: string;
  deploymentConfigPath?: string;
}

export function renderFabricPreflightWorkflow(input: FabricPreflightWorkflowInput): string {
  const workspace = clean(input.workspaceName, "Fabric workspace");
  const configPath = clean(input.deploymentConfigPath || ".deploy/fabric.yml", "Fabric deployment config");
  const target = /\.workspace$/i.test(workspace) ? workspace : `${workspace}.Workspace`;

  return [
    "name: Fabric preflight",
    "",
    "on:",
    "  workflow_dispatch:",
    "",
    "permissions:",
    "  id-token: write",
    "  contents: read",
    "",
    "jobs:",
    "  preflight:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-python@v5",
    "        with:",
    "          python-version: '3.12'",
    "      - run: pip install ms-fabric-cli",
    "      - uses: azure/login@v2",
    "        with:",
    "          client-id: ${{ secrets.AZURE_CLIENT_ID }}",
    "          tenant-id: ${{ secrets.AZURE_TENANT_ID }}",
    "          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}",
    "      - name: Bind Fabric CLI to Azure CLI session",
    "        run: fab auth login --azure-cli",
    "      - name: Fabric authentication status",
    "        run: fab auth status",
    "      - name: Verify project workspace",
    `        run: fab get ${shellSingleQuote(target)}`,
    "      - name: List project workspace items",
    `        run: fab ls ${shellSingleQuote(target)} -l`,
    "      - name: Verify deployment config exists",
    `        run: test -f ${shellSingleQuote(configPath)}`,
    ""
  ].join("\n");
}

function clean(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (/\r|\n|\0/.test(trimmed)) throw new Error(`${label} contains unsupported control characters.`);
  return trimmed;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
