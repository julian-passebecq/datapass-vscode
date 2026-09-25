/**
 * Work orders (pass AI-2): how an order is handed to an agent (handoff/v3/09 §5, Julian's answer Q5
 * in §13.1). Pure: the extension turns a plan into a terminal or an app hand-off.
 *
 *   claude-code · desktop (default)  copy the marker prompt, open the Claude app (claude://), and say
 *                                    which folder to pick in a new Code session
 *   codex · desktop                  the same with the ChatGPT app's Codex (codex://)
 *   claude-code · terminal           a VS Code terminal whose process *is* `claude` (arguments as an
 *                                    array, no shell), with the session id DataPass chose
 *   codex · terminal                 `codex` in a terminal, when a Codex CLI is configured or on PATH
 *
 * A `.cmd` shim would make cmd.exe parse the arguments. Then the terminal runs cmd.exe with a line
 * built only from double-quoted tokens of a strict character set; if one token fails, DataPass
 * offers to copy the command instead.
 */
import { markerLine, type WorkOrder } from "./format";

export type AgentChoice = "claude-desktop" | "claude-terminal" | "codex-desktop" | "codex-terminal";
export const AGENT_CHOICES: readonly AgentChoice[] = ["claude-desktop", "claude-terminal", "codex-desktop", "codex-terminal"];
export const CHOICE_LABELS: Readonly<Record<AgentChoice, string>> = {
  "claude-desktop": "Claude app",
  "claude-terminal": "Claude Code · terminal",
  "codex-desktop": "Codex app (ChatGPT)",
  "codex-terminal": "Codex CLI · terminal"
};
export const choiceOf = (tool: WorkOrder["agent"]["tool"], surface: WorkOrder["agent"]["surface"]): AgentChoice =>
  `${tool === "claude-code" ? "claude" : "codex"}-${surface}` as AgentChoice;
export const toolOf = (c: AgentChoice): { tool: WorkOrder["agent"]["tool"]; surface: WorkOrder["agent"]["surface"] } =>
  ({ tool: c.startsWith("claude") ? "claude-code" : "codex", surface: c.endsWith("desktop") ? "desktop" : "terminal" });

/**
 * Deep links the desktop apps register (package manifests: protocols "claude" and "codex").
 * `claude://code/new` is the Claude app's own "new Code session" route; the Codex app is only
 * brought to the front (no documented route opens a new local task with a prompt).
 */
export const APP_URI: Readonly<Record<"claude" | "codex", string>> = { claude: "claude://code/new", codex: "codex:" };

/** Tokens allowed on a cmd.exe line: nothing cmd.exe would interpret (%, ^, &, |, <, >, quotes, parentheses). */
export const AGENT_CMD_SAFE = /^[A-Za-z0-9 _.:\\/@=-]{1,1000}$/;
const SCRIPT_PATH = /^[A-Za-z]:\\[A-Za-z0-9 ._()\\-]{1,300}\.cmd$/i;

/** Where the agent starts and which other folders it may use. */
export interface Workspace { cwd: string; addDirs: string[] }

/** The first repository to change is the working folder (its CLAUDE.md / AGENTS.md load); every other repository and the order folder are added. */
export function agentWorkspace(order: WorkOrder, orderFolder: string, coordinationFolder: string, sameFolder: (a: string, b: string) => boolean, inside: (root: string, p: string) => boolean): Workspace {
  const first = order.repositories.find(r => r.access === "change") ?? order.repositories[0];
  const cwd = first?.localPath ?? coordinationFolder;
  const dirs: string[] = [];
  const add = (d: string) => { if (!sameFolder(d, cwd) && !dirs.some(x => sameFolder(x, d))) dirs.push(d); };
  for (const r of order.repositories) add(r.localPath);
  if (!inside(cwd, orderFolder) && !dirs.some(d => inside(d, orderFolder))) add(orderFolder);
  return { cwd, addDirs: dirs };
}

/** `--name` text: the id and the title, reduced to characters every shell and the app accept. */
export function sessionName(order: WorkOrder): string {
  return `${order.id} ${order.title}`.replace(/[^A-Za-z0-9 _.-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function claudeArgs(order: WorkOrder, orderMd: string, ws: Workspace): string[] {
  const args: string[] = [];
  if (order.agent.sessionId) args.push("--session-id", order.agent.sessionId);
  args.push("--name", sessionName(order), "--effort", order.agent.effort);
  if (order.agent.model) args.push("--model", order.agent.model);
  if (order.agent.permissions === "ask") args.push("--permission-mode", "default");
  for (const d of ws.addDirs) args.push("--add-dir", d);
  args.push(markerLine(order, orderMd));
  return args;
}

export function codexArgs(order: WorkOrder, orderMd: string, ws: Workspace): string[] {
  const args = ["-C", ws.cwd];
  for (const d of ws.addDirs) args.push("--add-dir", d);
  args.push("--sandbox", "workspace-write", "--ask-for-approval", "on-request");
  if (order.agent.model) args.push("-m", order.agent.model);
  args.push(markerLine(order, orderMd));
  return args;
}

/** `claude --resume <id>` in the same folder (Claude Code in a terminal only). */
export function resumeArgs(order: WorkOrder): string[] | undefined {
  return order.agent.tool === "claude-code" && order.agent.sessionId ? ["--resume", order.agent.sessionId] : undefined;
}

/** The cmd.exe line for a `.cmd` shim, or undefined when a token is outside the strict set. */
export function agentCmdLine(script: string, args: readonly string[]): string | undefined {
  if (!SCRIPT_PATH.test(script)) return undefined;
  if (!args.every(a => AGENT_CMD_SAFE.test(a))) return undefined;
  return `""${script}" ${args.map(a => `"${a}"`).join(" ")}"`;
}

/** A command the person can paste into their own shell (shown, never run by DataPass): each argument quoted for PowerShell or a POSIX shell. */
export function copyableCommand(executable: string, args: readonly string[], cwd: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    return `Set-Location ${q(cwd)}; & ${q(executable)} ${args.map(q).join(" ")}`;
  }
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return `cd ${q(cwd)} && ${q(executable)} ${args.map(q).join(" ")}`;
}

/** What the person sees for a desktop hand-off: three steps, the folder and the prompt on the clipboard. */
export function desktopSteps(app: "claude" | "codex", folder: string): string[] {
  return app === "claude"
    ? ["In the Claude app, open Code and start a new session.", `Choose this folder: ${folder}`, "Paste the prompt (Ctrl+V) and send it."]
    : ["In the ChatGPT app, open Codex and start a new task (local).", `Choose this folder: ${folder}`, "Paste the prompt (Ctrl+V) and send it."];
}
