import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  fabricToolboxMcpDefinition,
  mergeMcpServer,
  parseMcpConfig
} from "../src/core/mcp";

test("MCP parser preserves registered servers", () => {
  const config = parseMcpConfig({
    servers: {
      existing: { command: "node", args: ["server.js"] }
    }
  });
  assert.equal(config.servers.existing?.command, "node");
});

test("MCP merge does not delete existing servers", () => {
  const merged = mergeMcpServer(
    { servers: { existing: { command: "node" } } },
    "fabric-mgmt",
    { command: "python", args: ["server.py"] }
  );
  assert.equal(merged.servers.existing?.command, "node");
  assert.equal(merged.servers["fabric-mgmt"]?.command, "python");
});

test("Semantic model MCP uses the upstream venv/server layout", () => {
  const root = path.resolve("/tmp/fabric-toolbox");
  const result = fabricToolboxMcpDefinition("semantic-model-mcp", root, "linux");
  assert.equal(result.serverName, "semantic_model_mcp_server");
  assert.equal(result.server.command, path.join(root, "tools", "SemanticModelMCPServer", ".venv", "bin", "python"));
  assert.deepEqual(result.server.args, [path.join(root, "tools", "SemanticModelMCPServer", "server.py")]);
});

test("DAX MCP is explicitly Windows-only", () => {
  assert.throws(
    () => fabricToolboxMcpDefinition("dax-performance-mcp", "/tmp/fabric-toolbox", "linux"),
    /requires Windows/
  );
});
