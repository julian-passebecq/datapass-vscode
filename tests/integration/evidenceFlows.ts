/**
 * 0.27 E1 (D-22) desktop flow, fixture v25-doc-pipeline: Readiness shows the evidence chain of the
 * Azure CLI and the Fabric Management MCP server, each link observed (source, time) or unknown with
 * a reason; a CLI is never "registered", an MCP server is never "connected" from a file.
 */
import * as assert from "node:assert/strict";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";

const ONLY = ["v25-doc-pipeline"];

export function registerEvidenceFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  test("0.27 E1 evidence chain: az and the Fabric MCP server in Readiness and the Workbench, unknown with reasons", async () => {
    const r = await waitFor("readiness with evidence", () => api().readiness()?.evidence.length ? api().readiness() : undefined, 20_000);
    const az = r.evidence.find(e => e.id === "cli.az");
    const fabric = r.evidence.find(e => e.id === "mcp.fabric-management");
    assert.ok(az && fabric, "az and the Fabric MCP server are listed");
    assert.equal(az.chain.length, 7);
    assert.equal(az.chain.find(l => l.link === "registered")!.state, "not-applicable");
    for (const id of ["authorized", "verified"]) assert.equal(az.chain.find(l => l.link === id)!.state, "unknown", `az ${id}`);
    // No sign-in declared in the example: authenticated stays unknown and says why.
    const auth = az.chain.find(l => l.link === "authenticated")!;
    assert.ok(auth.state === "unknown" && /no sign-in declared/.test(auth.reason), JSON.stringify(auth));
    for (const id of ["installed", "connected", "authenticated", "authorized", "verified"]) {
      const l = fabric.chain.find(x => x.link === id)!;
      assert.ok(l.state === "unknown" && l.reason.length > 10, `fabric ${id}: ${JSON.stringify(l)}`);
    }
    const reg = fabric.chain.find(l => l.link === "registered")!;
    assert.ok(reg.state === "observed" ? reg.source === ".vscode/mcp.json" && !reg.holds : reg.state === "unknown", JSON.stringify(reg));
    const wb = api().workbenchState().readiness;
    assert.ok(wb?.evidence.some(e => e.id === "mcp.fabric-management" && e.links.every(l => l.text.length > 0)), "the Workbench carries the chain");
    record("evidence.docPipeline", r.evidence.map(e => ({ id: e.id, summary: e.summary, links: e.chain.map(l => `${l.link}:${l.state}`) })));
  }, ONLY);
}
