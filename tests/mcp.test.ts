import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  fabricToolboxMcpDefinition,
  mergeMcpServer,
  parseMcpConfig,
  planMcpFileEdit
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

// 0.26 M1: lossless .vscode/mcp.json edits (FOIL review R1, 06_CODE_REVIEW.md §6.1–6.4).

const withInputs = {
  inputs: [{ id: "tenant", type: "promptString", description: "Tenant identifier" }],
  servers: {
    existing: {
      type: "stdio", command: "node", args: ["example.js"],
      env: { TENANT_ID: "${input:tenant}" }, envFile: "${workspaceFolder}/.env", cwd: "/example/non-secret", sandbox: { mode: "strict" }
    }
  }
};

test("MCP-01: merging keeps inputs and every field of unrelated servers (env, type, cwd, envFile, unknown keys)", () => {
  const before = JSON.stringify(withInputs);
  const merged = mergeMcpServer(parseMcpConfig(withInputs), "new", { command: "node", args: ["other.js"] });
  assert.deepEqual(merged.inputs, withInputs.inputs);
  assert.deepEqual(merged.servers.existing, withInputs.servers.existing);
  assert.equal(merged.servers.new?.command, "node");
  assert.equal(JSON.stringify(withInputs), before, "input not mutated");
});

test("MCP-01: the planned file text keeps unrelated content byte-for-byte in meaning", () => {
  const current = JSON.stringify({ ...withInputs, extra: { keep: true } }, null, "\t") + "\n";
  const edit = planMcpFileEdit(current, "fabric-mgmt", { command: "python", args: ["server.py"] });
  const next = JSON.parse(edit.text);
  assert.equal(edit.replaces, false);
  assert.deepEqual(next.inputs, withInputs.inputs);
  assert.deepEqual(next.extra, { keep: true });
  assert.deepEqual(next.servers.existing, withInputs.servers.existing);
  assert.deepEqual(Object.keys(next), ["inputs", "servers", "extra"], "top-level key order kept");
  assert.match(edit.text, /\n\t"inputs"/, "existing indentation reused");
});

test("MCP-02: a remote http server is accepted, kept, and can be added", () => {
  const remote = { servers: { fabric: { type: "http", url: "https://api.fabric.microsoft.com/v1/mcp/core", headers: { "X-Trace": "1" } } } };
  const config = parseMcpConfig(remote);
  assert.deepEqual(config.servers.fabric, remote.servers.fabric);
  const merged = mergeMcpServer(config, "local", { command: "node" });
  assert.deepEqual(merged.servers.fabric, remote.servers.fabric);
  const added = mergeMcpServer({ servers: {} }, "remote", { type: "http", url: "https://example.test/mcp" });
  assert.equal((added.servers.remote as { url: string }).url, "https://example.test/mcp");
  assert.throws(() => parseMcpConfig({ servers: { bad: { type: "http" } } }), /must define url/);
});

test("MCP-03: the top-level mcpServers dialect is refused, not read as empty", () => {
  assert.throws(() => parseMcpConfig({ mcpServers: { other: { command: "node" } } }), /mcpServers/);
  assert.throws(() => planMcpFileEdit('{ "mcpServers": { "other": { "command": "node" } } }', "x", { command: "node" }), /mcpServers/);
});

test("MCP-04: a file with comments or trailing commas is refused safely", () => {
  assert.throws(() => planMcpFileEdit('{\n// existing comment\n"servers": {}\n}', "x", { command: "node" }), /not plain JSON/);
  assert.throws(() => planMcpFileEdit('{ "servers": { "a": { "command": "node" }, } }', "x", { command: "node" }), /not plain JSON/);
});

test("MCP: unknown server type is refused rather than rewritten", () => {
  assert.throws(() => parseMcpConfig({ servers: { odd: { type: "websocket", url: "ws://x" } } }), /does not know/);
});

test("MCP control: a new file, a replaced entry, CRLF and BOM", () => {
  const fresh = planMcpFileEdit(undefined, "s", { command: "node" });
  assert.deepEqual(JSON.parse(fresh.text), { servers: { s: { command: "node" } } });
  const crlf = '{\r\n  "servers": {\r\n    "s": { "command": "old" }\r\n  }\r\n}\r\n';
  const replaced = planMcpFileEdit("\uFEFF" + crlf, "s", { command: "new" });
  assert.equal(replaced.replaces, true);
  assert.equal((replaced.previous as { command: string }).command, "old");
  assert.ok(!/[^\r]\n/.test(replaced.text), "CRLF line endings kept");
  assert.ok(replaced.text.startsWith("﻿"), "BOM kept");
  assert.equal(JSON.parse(replaced.text.slice(1)).servers.s.command, "new");
  assert.ok(!planMcpFileEdit(crlf, "s", { command: "new" }).text.startsWith("﻿"), "no BOM added");
  // The command decodes with ignoreBOM, so the BOM reaches the planner.
  const bytes = new TextEncoder().encode("﻿" + crlf);
  assert.ok(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).startsWith("﻿"));
});

test("MCP control: invalid argument types are still refused", () => {
  assert.throws(() => parseMcpConfig({ servers: { bad: { command: "node", args: [7] } } }), /string array/);
  assert.throws(() => parseMcpConfig({ servers: { bad: {} } }), /must define command/);
});
