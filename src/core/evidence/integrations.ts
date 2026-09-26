/**
 * The evidence chain of each integration Readiness shows (D-22): the CLIs DataPass can check
 * read-only (az, databricks, fab) and the MCP servers it knows or finds registered in the
 * workspace's .vscode/mcp.json. Pure: built from the tool probes (which read the server NAMES of
 * .vscode/mcp.json, nothing else) and the read-only sign-in checks the person ran.
 *
 * Never from a credential file: not ~/.azure, not ~/.databrickscfg, not the Fabric CLI's cache, not
 * a host's MCP secrets. What a link cannot see stays `unknown`, with the reason.
 */
import { TOOL_INDEX, type ToolObservation } from "../capabilities/tools";
import { signInEvidence, SIGN_IN_CHECKS, type CheckedTool, type ConnectionProbe, type ConnectionView } from "../toolchain/connections";
import { buildChain, chainSummary, chainTone, notApplicable, observed, unknown, type EvidenceLink, type Observations } from "./chain";

export const MCP_REGISTRATION_FILE = ".vscode/mcp.json";

/**
 * MCP servers DataPass knows. Server names are the ones "Add to MCP" writes (src/core/mcp.ts,
 * fabricToolboxMcpDefinition; a test keeps them equal). The Power BI Modeling server comes from
 * its VS Code extension, which registers it with VS Code itself.
 */
export interface KnownMcpServer {
  id: string;
  label: string;
  serverName?: string;
  /** Tool id whose probe says whether it is installed (an extension). */
  toolId?: string;
  /** Why "installed" cannot be observed when there is no probe. */
  installReason?: string;
}

export const KNOWN_MCP_SERVERS: readonly KnownMcpServer[] = [
  { id: "mcp.fabric-management", label: "Fabric Management MCP server (Fabric Toolbox)", serverName: "fabric-mgmt",
    installReason: "it runs from a local Fabric Toolbox clone; DataPass does not look inside that clone" },
  { id: "mcp.semantic-model", label: "Semantic Model MCP server (Fabric Toolbox)", serverName: "semantic_model_mcp_server",
    installReason: "it runs from a local Fabric Toolbox clone; DataPass does not look inside that clone" },
  { id: "mcp.dax-performance", label: "DAX Performance Tuner MCP server (Fabric Toolbox)", serverName: "dax-performance-tuner",
    installReason: "it runs from a local Fabric Toolbox clone; DataPass does not look inside that clone" },
  { id: "mcp.powerbi-modeling", label: "Power BI Modeling MCP server", toolId: "ext.powerbi-modeling-mcp" }
];

export type IntegrationKind = "cli" | "mcp-server";

export interface IntegrationEvidence {
  id: string;
  label: string;
  kind: IntegrationKind;
  chain: EvidenceLink[];
  /** "installed / not registered", "signed in · authorized on the target unknown"… */
  summary: string;
  tone: "ok" | "warn" | "muted";
}

export interface EvidenceInput {
  tools?: ReadonlyMap<string, ToolObservation>;
  connectionProbes?: ReadonlyMap<string, ConnectionProbe>;
  connections?: readonly ConnectionView[];
}

const VERIFY_REASON = "no DataPass check ran an operation with it; an agent's \"I tested it\" is an assertion, not a check";
const CONNECTED_MCP = "a registration says what a host may start; DataPass cannot see whether a host started or reached the server";
const AUTH_MCP = "the server signs in on its own; DataPass never reads its credentials";
const AUTHZ = "DataPass has no read-only check of access to the target (workspace, subscription, model)";

function installedFromProbe(obs: ToolObservation | undefined, what: string): EvidenceLink {
  if (!obs) return unknown("installed", "tools not probed yet");
  if (obs.state === "unknown") return unknown("installed", `DataPass cannot probe ${what}`);
  return observed("installed", obs.state === "present", obs.via ? `probe: ${obs.via}` : "probe", obs.observedAt, obs.version ? `version ${obs.version}` : undefined);
}

function cliEvidence(tool: CheckedTool, input: EvidenceInput): IntegrationEvidence {
  const def = TOOL_INDEX.get(tool)!;
  const obs: Observations = {
    known: observed("known", true, "DataPass tool registry"),
    installed: installedFromProbe(input.tools?.get(tool), def.label),
    registered: notApplicable("registered", "a CLI runs directly; it is not registered in a host"),
    connected: notApplicable("connected", "a CLI opens no standing connection"),
    authenticated: signInEvidence(tool, input.connectionProbes?.get(tool), input.connections?.filter(c => c.tool === tool)),
    authorized: unknown("authorized", `${AUTHZ}; ${SIGN_IN_CHECKS[tool].text} only says who is signed in`),
    verified: unknown("verified", VERIFY_REASON)
  };
  return finish(tool, def.label, "cli", buildChain(obs));
}

function registration(name: string | undefined, ws: ToolObservation | undefined): EvidenceLink {
  if (!name) return unknown("registered", "its extension registers the server with VS Code itself; DataPass cannot see VS Code's server list");
  if (!ws) return unknown("registered", `${MCP_REGISTRATION_FILE} not checked yet`);
  if (ws.state === "unknown") return unknown("registered", `${MCP_REGISTRATION_FILE} could not be checked`);
  if (ws.state === "absent") return observed("registered", false, MCP_REGISTRATION_FILE, ws.observedAt, `no ${MCP_REGISTRATION_FILE} in this workspace (other hosts are not read)`);
  if (!ws.entries) return unknown("registered", `${MCP_REGISTRATION_FILE} is not plain JSON; DataPass cannot read its server names`);
  return ws.entries.includes(name)
    ? observed("registered", true, MCP_REGISTRATION_FILE, ws.observedAt, `server "${name}" in this workspace`)
    : observed("registered", false, MCP_REGISTRATION_FILE, ws.observedAt, `no server "${name}" in this workspace (other hosts are not read)`);
}

function mcpChain(known: EvidenceLink, installed: EvidenceLink, registered: EvidenceLink): EvidenceLink[] {
  return buildChain({
    known, installed, registered,
    connected: unknown("connected", CONNECTED_MCP),
    authenticated: unknown("authenticated", AUTH_MCP),
    authorized: unknown("authorized", AUTHZ),
    verified: unknown("verified", VERIFY_REASON)
  });
}

function finish(id: string, label: string, kind: IntegrationKind, chain: EvidenceLink[]): IntegrationEvidence {
  return { id, label, kind, chain, summary: chainSummary(chain), tone: chainTone(chain) };
}

/** The CLIs with a read-only sign-in check, the known MCP servers, then servers only the workspace names. */
export function buildIntegrationEvidence(input: EvidenceInput): IntegrationEvidence[] {
  const ws = input.tools?.get("ws.mcp");
  const out: IntegrationEvidence[] = (Object.keys(SIGN_IN_CHECKS) as CheckedTool[]).map(t => cliEvidence(t, input));
  for (const s of KNOWN_MCP_SERVERS) {
    const installed = s.toolId ? installedFromProbe(input.tools?.get(s.toolId), s.label) : unknown("installed", s.installReason ?? "DataPass has no probe for it");
    out.push(finish(s.id, s.label, "mcp-server", mcpChain(observed("known", true, "DataPass tool registry"), installed, registration(s.serverName, ws))));
  }
  const knownNames = new Set(KNOWN_MCP_SERVERS.map(s => s.serverName).filter(Boolean));
  for (const name of (ws?.state === "present" ? ws.entries ?? [] : []).filter(n => !knownNames.has(n)).slice(0, 20)) {
    out.push(finish(`mcp:${name}`, `MCP server "${name}"`, "mcp-server", mcpChain(
      observed("known", false, "DataPass tool registry"),
      unknown("installed", "DataPass does not know what this server runs"),
      registration(name, ws))));
  }
  return out;
}
