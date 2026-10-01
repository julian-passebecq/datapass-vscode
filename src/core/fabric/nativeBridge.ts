/**
 * FABINT1: what DataPass can use from the official Microsoft Fabric VS Code extension, as plain
 * capability facts (CAPROUTE1b may consume them). No `vscode` import: the caller passes an
 * extension lookup, so unit tests stub it.
 *
 * Investigation (2026-09-30, fabric.vscode-fabric 0.39.18, typings @microsoft/vscode-fabric-api
 * 0.35.6, apiVersion "0.7"): the extension exports `IFabricExtensionManager`. Its services
 * (workspaceManager, artifactManager.openArtifact, apiClient) are handed out only through
 * `addExtension()`, which throws "is not allowed" for any identity outside a hard-coded Microsoft
 * satellite allow-list (extension/src/extensionManager/FabricExtensionManager.ts). No public
 * command opens an item. So workspace context, item identity and "open native artifact" are NOT
 * supported for DataPass; registering under another identity would be spoofing and is never done.
 * What remains supported: detection, version, and revealing the view container the extension's
 * own manifest contributes. Everything else falls back to static analysis plus a portal link.
 *
 * DataPass never activates the Fabric extension, never calls addExtension, never reads its
 * storage or tokens, and never calls Fabric REST.
 */

export const FABRIC_CORE_EXTENSION_ID = "fabric.vscode-fabric";
/** The API contract version the investigation was made against (major.minor is what the core compares). */
export const FABRIC_API_VERSION_CHECKED = "0.7";
export const FABRIC_PORTAL_URL = "https://app.fabric.microsoft.com/";

/** The part of a VS Code `Extension` the bridge reads. */
export interface ExtensionLike {
  isActive: boolean;
  packageJSON?: { version?: unknown; contributes?: { viewsContainers?: Record<string, Array<{ id?: unknown }>> } };
  /** Read only when the extension is already active; never triggers activation. */
  exports?: unknown;
}
export type ExtensionLookup = (id: string) => ExtensionLike | undefined;

export type FabricNativeOperation = "detect" | "revealWorkspaceView" | "workspaceContext" | "itemIdentity" | "openNativeArtifact";

export interface FabricOperationFact {
  operation: FabricNativeOperation;
  supported: boolean;
  /** Why not, or which route, in one line. */
  reason: string;
}

export interface FabricNativeBridgeFacts {
  extensionId: string;
  installed: boolean;
  active: boolean;
  version?: string;
  /** Whether the running extension exposes the manager shape the investigation found; undefined until it is active. */
  exportsRecognized?: boolean;
  /** Always false today: the service API is closed to non-Microsoft extensions. */
  bridgeAvailable: boolean;
  operations: FabricOperationFact[];
  /** What DataPass offers instead of the native services. */
  fallback: { staticAnalysis: true; portalUrl: string };
}

const CLOSED = `the official API gives these services only to allow-listed Microsoft satellites (apiVersion ${FABRIC_API_VERSION_CHECKED})`;

export function fabricNativeBridgeFacts(lookup: ExtensionLookup, opts: { workspaceId?: string } = {}): FabricNativeBridgeFacts {
  let ext: ExtensionLike | undefined;
  try { ext = lookup(FABRIC_CORE_EXTENSION_ID); } catch { ext = undefined; }
  const installed = Boolean(ext);
  const version = typeof ext?.packageJSON?.version === "string" ? ext.packageJSON.version : undefined;
  const viewContainer = installed ? fabricViewContainerId(ext!) : undefined;
  const portalUrl = fabricPortalUrl(opts.workspaceId);
  const notInstalled = "Microsoft Fabric extension not installed";
  return {
    extensionId: FABRIC_CORE_EXTENSION_ID,
    installed,
    active: Boolean(ext?.isActive),
    version,
    exportsRecognized: ext?.isActive ? isFabricManager(ext.exports) : undefined,
    bridgeAvailable: false,
    operations: [
      { operation: "detect", supported: true, reason: installed ? `installed${version ? ` ${version}` : ""}` : notInstalled },
      {
        operation: "revealWorkspaceView",
        supported: Boolean(viewContainer),
        reason: viewContainer ? `view container "${viewContainer}" from the extension's manifest` : installed ? "the extension's manifest contributes no view container" : notInstalled
      },
      { operation: "workspaceContext", supported: false, reason: installed ? CLOSED : notInstalled },
      { operation: "itemIdentity", supported: false, reason: installed ? `${CLOSED}; it has no folder-to-item call either` : notInstalled },
      { operation: "openNativeArtifact", supported: false, reason: installed ? `${CLOSED}; no documented command opens an item. Fallback: ${portalUrl}` : `${notInstalled}. Fallback: ${portalUrl}` }
    ],
    fallback: { staticAnalysis: true, portalUrl }
  };
}

/** The first view container the Fabric extension's own package.json contributes (activity bar or panel). */
export function fabricViewContainerId(ext: ExtensionLike): string | undefined {
  const containers = ext.packageJSON?.contributes?.viewsContainers;
  if (!containers || typeof containers !== "object") return undefined;
  for (const place of ["activitybar", "panel"]) {
    const list = containers[place];
    if (!Array.isArray(list)) continue;
    const id = list.find(c => typeof c?.id === "string" && c.id.length > 0)?.id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** One card line: what the official extension gives DataPass here, and the fallback. */
export function nativeBridgeDetail(facts: FabricNativeBridgeFacts): string {
  if (!facts.installed) return `Native Fabric bridge: ${facts.extensionId} not installed; static analysis works without it, items open in the portal.`;
  const usable = facts.operations.filter(o => o.supported && o.operation !== "detect").map(o => o.operation);
  return `Native Fabric bridge: ${facts.extensionId}${facts.version ? ` ${facts.version}` : ""} detected${usable.length ? ` (${usable.join(", ")})` : ""}; its item API is limited to Microsoft satellites, so items open in the portal.`;
}

/** Duck-typed check of the exported `IFabricExtensionManager`; never calls it. */
export function isFabricManager(exports: unknown): boolean {
  return typeof exports === "object" && exports !== null && typeof (exports as { addExtension?: unknown }).addExtension === "function";
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Portal link: the workspace page when a verified workspace GUID is declared, the Fabric home otherwise. */
export function fabricPortalUrl(workspaceId?: string): string {
  const id = workspaceId?.trim();
  return id && GUID.test(id) ? `${FABRIC_PORTAL_URL}groups/${id.toLowerCase()}/list` : FABRIC_PORTAL_URL;
}
