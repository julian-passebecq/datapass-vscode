import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolProbe } from "./types";

export interface CliSpec {
  id: string;
  label: string;
  command: string;
  args?: string[];
}

export interface ProbeResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export type ProbeRunner = (command: string, args: string[], timeoutMs: number) => Promise<ProbeResult>;

export interface WindowsCommand { path: string; kind: "exe" | "script" }

/**
 * Resolve a bare command the way cmd.exe would (PATH × PATHEXT). Node's execFile only finds
 * `.exe` files on its own, so CLIs installed as `.cmd` shims (Azure CLI, npm-installed tools)
 * would otherwise look absent.
 */
export function resolveWindowsCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  isFile: (p: string) => boolean
): WindowsCommand | undefined {
  const exts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map(e => e.trim().toLowerCase()).filter(e => /^\.[a-z0-9]+$/.test(e));
  const kind = (p: string): WindowsCommand["kind"] | undefined => {
    const ext = path.win32.extname(p).toLowerCase();
    return ext === ".exe" || ext === ".com" ? "exe" : ext === ".cmd" || ext === ".bat" ? "script" : undefined;
  };
  const candidates = (base: string) => (path.win32.extname(base) ? [base] : exts.map(e => base + e));
  const dirs = /[\\/]/.test(command) ? [""] : (env.PATH ?? env.Path ?? "").split(";").map(d => d.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of candidates(dir ? path.win32.join(dir, command) : command)) {
      const k = kind(candidate);
      if (k && isFile(candidate)) return { path: candidate, kind: k };
    }
  }
  return undefined;
}

/** Arguments that cmd.exe cannot reinterpret (no metacharacters, quotes, `%` or `!`). */
const CMD_SAFE_ARG = /^[A-Za-z0-9_.:/=-]+$/;

/**
 * Build the execFile call for a Windows command. `.cmd`/`.bat` shims need cmd.exe, so they are
 * only run with arguments that cmd cannot reinterpret; anything else is refused, not quoted.
 */
export function windowsInvocation(resolved: WindowsCommand, args: string[], env: NodeJS.ProcessEnv):
  { file: string; args: string[]; verbatim: boolean } | { error: string } {
  if (resolved.kind === "exe") return { file: resolved.path, args, verbatim: false };
  if (/["%!^&|<>]/.test(resolved.path)) return { error: `refusing to run ${resolved.path} through cmd.exe: unsafe characters in its path` };
  const unsafe = args.find(a => !CMD_SAFE_ARG.test(a));
  if (unsafe !== undefined) return { error: `refusing to pass ${JSON.stringify(unsafe)} to a .cmd shim through cmd.exe` };
  return { file: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `""${resolved.path}" ${args.join(" ")}"`], verbatim: true };
}

function isFileSync(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

export const defaultProbeRunner: ProbeRunner = async (command, args, timeoutMs) => {
  let file = command;
  let argv = args;
  let verbatim = false;
  if (process.platform === "win32") {
    const resolved = resolveWindowsCommand(command, process.env, isFileSync);
    if (!resolved) return { ok: false, error: `${command} was not found on PATH` };
    const call = windowsInvocation(resolved, args, process.env);
    if ("error" in call) return { ok: false, error: call.error };
    ({ file, args: argv, verbatim } = call);
  }
  return runProbe(file, argv, timeoutMs, verbatim);
};

const runProbe = (command: string, args: string[], timeoutMs: number, verbatim: boolean): Promise<ProbeResult> =>
  new Promise(resolve => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: verbatim }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: String(error.message || error) });
        return;
      }
      const output = String(stdout || stderr || "").trim();
      resolve({ ok: true, output });
    });
  });

export async function detectCli(
  spec: CliSpec,
  runner: ProbeRunner = defaultProbeRunner,
  timeoutMs = 1800
): Promise<ToolProbe> {
  const result = await runner(spec.command, spec.args ?? ["--version"], timeoutMs);
  return {
    id: spec.id,
    label: spec.label,
    available: result.ok,
    version: result.ok ? firstLine(result.output) : undefined,
    detail: result.ok ? undefined : result.error
  };
}

export async function detectManyCli(specs: CliSpec[], runner: ProbeRunner = defaultProbeRunner): Promise<ToolProbe[]> {
  return Promise.all(specs.map(spec => detectCli(spec, runner)));
}

function firstLine(value?: string): string | undefined {
  if (!value) return undefined;
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  return line || undefined;
}
