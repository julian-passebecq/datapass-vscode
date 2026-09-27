/**
 * Synthetic project links for project A (research library): invented example-org addresses, no FOIL
 * or client content. Shared by the unit tests, the public example and the desktop fixture.
 */
export function linksAJson(): Record<string, unknown> {
  return {
    format: "datapass.links",
    version: 1,
    title: "Research library — useful pages",
    groups: [
      {
        id: "workspaces", title: "Workspaces",
        links: [
          { label: "Databricks workspace (dev)", url: "https://adb-1234567890123456.7.azuredatabricks.net/?o=1234567890123456", kind: "workspace", environment: "dev", description: "Notebooks and jobs of the simulation lab." },
          { label: "Data Factory Studio (dev)", url: "https://adf.azure.com/en/home?factory=%2Fsubscriptions%2F00000000-0000-0000-0000-000000000000%2FresourceGroups%2Frg-research-dev%2Fproviders%2FMicrosoft.DataFactory%2Ffactories%2Fadf-research-dev", kind: "workspace", environment: "dev" }
        ]
      },
      {
        id: "dashboards", title: "Dashboards",
        links: [
          { label: "Extraction coverage report", url: "https://app.powerbi.com/groups/me/reports/00000000-0000-0000-0000-000000000001", kind: "dashboard", environment: "prod" },
          { label: "Local review app", url: "http://localhost:8501/", kind: "dashboard", description: "The review app when it runs on this computer (streamlit run)." }
        ]
      },
      {
        id: "project", title: "Project",
        links: [
          { label: "Resource group (dev)", url: "https://portal.azure.com/#@example.org/resource/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-research-dev/overview", kind: "portal", environment: "dev" },
          { label: "Pipeline repository", url: "https://github.com/example-org/research-pipeline", kind: "repository" },
          { label: "Runbook", url: "https://github.com/example-org/research-library/blob/main/README.md", kind: "docs" }
        ]
      }
    ]
  };
}
