/**
 * The read-only sign-in checks of manifest v5 connections, run only when the person asks
 * ("Check Connections"):
 *
 *   az account show --output json          the Azure CLI's current account (tenant, subscription)
 *   databricks auth profiles --output json  each Databricks CLI profile and whether it works
 *   fab auth status                         whether the Fabric CLI is signed in, and its tenant
 *
 * Each command is fixed here; nothing from the manifest is passed as an argument. They run from
 * the home folder, never from the workspace (a repository could hold CLI configuration such as a
 * local `.azure/config`), with stdin closed so any prompt ends at once instead of waiting, and with
 * a timeout. DataPass never opens the files these CLIs keep their credentials in: it reads what the
 * CLI prints, and the parsers in core/toolchain/connections.ts keep a few fields and drop the rest.
 */
import * as os from "node:os";
import { execFile } from "node:child_process";
import { resolveWindowsCommand, windowsInvocation } from "../core/detection";
import { resolveExecutable } from "../core/exec";
import { TOOL_INDEX } from "../core/capabilities/tools";
import { parseCheck, SIGN_IN_CHECKS, type CheckedTool, type CommandResult, type ConnectionProbe } from "../core/toolchain/connections";
import * as fs from "node:fs";

export type ConnectionRunner = (command: string, args: readonly string[], timeoutMs: number) => Promise<CommandResult>;

/** `databricks auth profiles` contacts each workspace (5 s per profile, in parallel). */
export const CHECK_TIMEOUT_MS = 30_000;

const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

export const defaultConnectionRunner: ConnectionRunner = (command, args, timeoutMs) => new Promise(resolve => {
  let file: string | undefined;
  let argv = [...args];
  let verbatim = false;
  if (process.platform === "win32") {
    const resolved = resolveWindowsCommand(command, process.env, isFile);
    if (!resolved) { resolve({ ok: false, notFound: true, stdout: "", stderr: "" }); return; }
    const call = windowsInvocation(resolved, argv, process.env);
    if ("error" in call) { resolve({ ok: false, stdout: "", stderr: "" }); return; }
    ({ file, args: argv, verbatim } = call);
  } else {
    file = resolveExecutable(command);
    if (!file) { resolve({ ok: false, notFound: true, stdout: "", stderr: "" }); return; }
  }
  const child = execFile(file, argv, {
    cwd: os.homedir(),
    timeout: timeoutMs,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    maxBuffer: 1024 * 1024,
    // No colours; UTF-8 for the Fabric CLI's ✓/✗ on Windows consoles.
    env: { ...process.env, NO_COLOR: "1", PYTHONIOENCODING: "utf-8" }
  }, (error, stdout, stderr) => {
    const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string; signal?: string }) | null;
    resolve({
      ok: !e,
      code: typeof e?.code === "number" ? e.code : e ? null : 0,
      timedOut: Boolean(e?.killed && e.signal),
      stdout: String(stdout ?? ""), stderr: String(stderr ?? "")
    });
  });
  // A prompt reads end-of-file and gives up instead of waiting for an answer that never comes.
  child.stdin?.end();
});

/** Run the checks for these tools (in parallel) and keep only what the parsers extract. */
export async function runConnectionChecks(tools: readonly CheckedTool[], runner: ConnectionRunner = defaultConnectionRunner, now = () => new Date().toISOString()): Promise<Map<CheckedTool, ConnectionProbe>> {
  const results = await Promise.all(tools.map(async tool => {
    const command = TOOL_INDEX.get(tool)?.cli?.command;
    if (!command) return [tool, { tool, ranAt: now(), outcome: "failed", reason: "no command known for this tool" } as ConnectionProbe] as const;
    let r: CommandResult;
    try { r = await runner(command, SIGN_IN_CHECKS[tool].args, CHECK_TIMEOUT_MS); }
    catch { r = { ok: false, stdout: "", stderr: "" }; }
    return [tool, parseCheck(tool, r, now())] as const;
  }));
  return new Map(results);
}
