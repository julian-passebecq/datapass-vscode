// V5E2E1 QA harness (never packaged): records what DataPass does at its boundaries during an
// acceptance journey, and runs a command by id when the runner asks. Loaded with
// --extensionDevelopmentPath beside DataPass by scripts/qa/v5.ts only.
//  - network: http/https request|get, net/tls connect, fetch — attributed to DataPass by stack;
//  - spawn:   child_process spawn/execFile/exec/fork (+Sync) — attributed the same way;
//  - bridge:  <DATAPASS_QA_BRIDGE>/req-<n>.json → executeCommand → res-<n>.json.
// Events go to DATAPASS_QA_SPY_LOG as JSON lines. Nothing leaves the machine.
"use strict";
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const LOG = process.env.DATAPASS_QA_SPY_LOG;
const ROOT = (process.env.DATAPASS_QA_EXT_ROOT || "").replace(/\\/g, "/").toLowerCase();
const BRIDGE = process.env.DATAPASS_QA_BRIDGE;

function log(event) {
  if (!LOG) return;
  try { fs.appendFileSync(LOG, JSON.stringify({ at: Date.now(), ...event }) + "\n"); } catch { /* best effort */ }
}
function fromDataPass() {
  if (!ROOT) return false;
  const stack = (new Error().stack || "").replace(/\\/g, "/").toLowerCase();
  // The downloaded VS Code and its built-in extensions can live under ROOT too.
  // Attribute only shipped DataPass bundles, not every caller inside the checkout.
  return stack.split("\n").some(l => l.includes(`${ROOT}/dist/`));
}
function wrap(mod, name, describe) {
  const original = mod[name];
  if (typeof original !== "function") return;
  mod[name] = function (...args) {
    if (fromDataPass()) { try { log(describe(...args)); } catch { /* never break the call */ } }
    return original.apply(this, args);
  };
}
function target(a, b) {
  if (typeof a === "string") { try { return new URL(a).host; } catch { return a; } }
  if (a instanceof URL) return a.host;
  const o = (a && typeof a === "object") ? a : (b && typeof b === "object" ? b : {});
  return `${o.hostname || o.host || "?"}${o.port ? `:${o.port}` : ""}`;
}
for (const name of ["http", "https"]) {
  const m = require(name);
  wrap(m, "request", (a, b) => ({ kind: "net", via: `${name}.request`, target: target(a, b) }));
  wrap(m, "get", (a, b) => ({ kind: "net", via: `${name}.get`, target: target(a, b) }));
}
for (const [name, fns] of [["net", ["connect", "createConnection"]], ["tls", ["connect"]]]) {
  const m = require(name);
  for (const f of fns) wrap(m, f, (a, b) => ({ kind: "net", via: `${name}.${f}`, target: typeof a === "number" ? `${typeof b === "string" ? b : "localhost"}:${a}` : target(a) }));
}
if (typeof globalThis.fetch === "function") {
  const original = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    if (fromDataPass()) log({ kind: "net", via: "fetch", target: target(typeof input === "string" || input instanceof URL ? input : input && input.url) });
    return original.call(this, input, init);
  };
}
const cp = require("child_process");
const argsOf = (a) => (Array.isArray(a) ? a.map(String) : []);
for (const f of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) wrap(cp, f, (file, args) => ({ kind: "spawn", file: String(file), args: argsOf(args) }));
for (const f of ["exec", "execSync"]) wrap(cp, f, (command) => { const parts = String(command).trim().split(/\s+/); return { kind: "spawn", file: parts[0] || "", args: parts.slice(1), shell: true }; });

function activate(context) {
  log({ kind: "harness", detail: "spy active", pid: process.pid });
  if (!BRIDGE) return;
  fs.mkdirSync(BRIDGE, { recursive: true });
  const busy = new Set();
  const poll = setInterval(() => {
    let names = [];
    try { names = fs.readdirSync(BRIDGE).filter(n => /^req-\d+\.json$/.test(n)); } catch { return; }
    for (const n of names) {
      if (busy.has(n)) continue;
      busy.add(n);
      const file = path.join(BRIDGE, n);
      const out = path.join(BRIDGE, n.replace("req-", "res-"));
      let req;
      try { req = JSON.parse(fs.readFileSync(file, "utf8")); fs.unlinkSync(file); } catch { busy.delete(n); continue; }
      const done = (res) => { try { fs.writeFileSync(out, JSON.stringify(res)); } catch { /* runner times out */ } busy.delete(n); };
      if (req.op === "commands") { vscode.commands.getCommands(true).then(c => done({ ok: true, value: c.filter(x => x.startsWith("datapass.")) }), e => done({ ok: false, error: String(e) })); continue; }
      if (req.op === "active") { const e = vscode.extensions.getExtension("julian-passebecq.datapass-vscode"); done({ ok: true, value: !!(e && e.isActive) }); continue; }
      // Commands that open a picker resolve only when it closes: answer at once, the UI steps follow.
      let settled = false;
      Promise.resolve(vscode.commands.executeCommand(req.id, ...(req.args || []))).then(
        v => { if (!settled) { settled = true; done({ ok: true, value: v === undefined ? null : safe(v) }); } },
        e => { if (!settled) { settled = true; done({ ok: false, error: String(e && e.message || e) }); } });
      setTimeout(() => { if (!settled) { settled = true; done({ ok: true, pending: true }); } }, 1500);
    }
  }, 250);
  context.subscriptions.push({ dispose: () => clearInterval(poll) });
}
function safe(v) { try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); } }
module.exports = { activate, deactivate() {} };
