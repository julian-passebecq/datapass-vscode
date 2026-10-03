import { ID_PATTERN } from "../model/ids";

export const DIAGRAMCLOUD_DEEP_LINK_ROUTE = {
  schema_version: 1 as const,
  route_id: "diagramcloud.project-view-node/1",
  owner_app: "diagramcloud",
  version: 1 as const,
  relative_template: "?project={project}&view={view?}&node={node?}"
};

export interface DiagramCloudDeepLinkTarget {
  project: string;
  view?: string;
  node?: string;
}

function stableId(value: string | undefined, label: string, required = false): string | undefined {
  if (!value) {
    if (required) throw new Error(`${label} is required`);
    return undefined;
  }
  if (!ID_PATTERN.test(value)) throw new Error(`${label} must be a DiagramCloud stable ID`);
  return value;
}

/**
 * Resolve the registered DiagramCloud route against a configured deployment base.
 * Only stable IDs travel in the URL. Existing query/hash content is discarded.
 */
export function resolveDiagramCloudDeepLink(base: string, target: DiagramCloudDeepLinkTarget): string {
  let url: URL;
  try { url = new URL(base); } catch { throw new Error("DiagramCloud base URL is invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("DiagramCloud base URL must be http(s) without embedded credentials");
  }
  const project = stableId(target.project, "project", true)!;
  const view = stableId(target.view, "view");
  const node = stableId(target.node, "node");
  url.search = "";
  url.hash = "";
  url.searchParams.set("project", project);
  if (view) url.searchParams.set("view", view);
  if (node) url.searchParams.set("node", node);
  return url.toString();
}
