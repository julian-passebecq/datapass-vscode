/**
 * QATMP: VS Code's main process exits before its children (extension host, shared process, pty host,
 * file watcher, GPU/utility processes), which keep writing logs and caches into the run root for a moment.
 * qa:ui records the tree before closing VS Code and waits for every process in it to be gone, so the
 * run root can be removed without racing a writer.
 */
import { execFileSync } from "node:child_process";

export interface ProcessRow { pid: number; ppid: number }

/** Every process of the machine with its parent, or [] when the listing is unavailable. */
export function listProcesses(): ProcessRow[] {
  try {
    const text = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"], { encoding: "utf8", windowsHide: true, timeout: 30_000 })
      : execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 30_000 });
    return parseProcessRows(text);
  } catch { return []; }
}

export function parseProcessRows(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return rows;
}

/** The root and all its descendants in the table (root first). */
export function processTree(root: number, rows: ProcessRow[]): number[] {
  const children = new Map<number, number[]>();
  for (const r of rows) if (r.pid !== r.ppid) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r.pid]);
  const out: number[] = [root];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const c of children.get(out[i]!) ?? []) if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * Wait until none of `pids` is alive; after `timeoutMs`, kill the survivors and wait `graceMs` more.
 * Returns the pids that were still alive at the timeout (and were killed).
 */
export async function waitForExit(pids: number[], { timeoutMs = 15_000, graceMs = 5_000, pollMs = 100 } = {}): Promise<number[]> {
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + timeoutMs;
  let alive = pids.filter(isAlive);
  while (alive.length && Date.now() < deadline) { await sleep(pollMs); alive = alive.filter(isAlive); }
  if (!alive.length) return [];
  const killed = alive;
  for (const pid of killed) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  const grace = Date.now() + graceMs;
  while (alive.length && Date.now() < grace) { await sleep(pollMs); alive = alive.filter(isAlive); }
  return killed;
}
