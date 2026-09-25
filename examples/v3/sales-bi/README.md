# Sales BI — Fabric and Power BI (example)

Synthetic DataPass 0.18 example (manifest v5): one repository holding a Fabric lakehouse and notebook
in Fabric's Git format, a Power BI semantic model (PBIP) and a GitHub Actions workflow that deploys
to production with fabric-cicd. Every id is invented.

What v5 adds, and where DataPass shows it (Project view):

- **Tools & versions** — `toolchain` in `.datapass/project.json`: the Fabric CLI (`>=1.0`), the Azure
  CLI (`^2.60`), Git, the Fabric and TMDL extensions, the Power BI extension pack (optional), Power BI
  Desktop, fabric-cicd (runs in CI) and semantic-link-labs (runs in Fabric notebooks). DataPass
  compares them with this computer and shows the install command to copy; it installs nothing.
- **.vscode/extensions.json** — the same extensions as workspace recommendations; *Show Recommended
  Extensions* lists them in VS Code.
- **ID map** — `identifiers` with one id per environment: the workspace and subscription for dev and
  prod. Hover an id in `fabric/parameter.yml` to see which one it is.
- **Connections** — the Azure CLI and Fabric CLI sign-ins (*Check connections* runs `az account
  show` and `fab auth status`, read-only), the workspace's Git binding and the data connection
  (declared, not checked: DataPass opens the portal page where you verify them).
