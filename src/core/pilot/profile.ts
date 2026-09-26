/**
 * Pilot stage 1 (AI-4a): the launch profile per agent surface and what DataPass refuses to launch
 * (brief 2026-09-26-ai4-pilot-allowlist.md, "Decision"). Pure.
 *
 *   Claude · terminal   cwd = order folder; claude … --permission-mode default --settings <order>/.claude/settings.json
 *                       [--add-dir <read repository>…] "<marker>"
 *   Claude · app        the prompt is copied; "Choose this folder: the order folder" (the app reads the same file)
 *   Codex · terminal    codex -C <order> --sandbox read-only --ask-for-approval on-request "<marker>"
 *   Codex · app         refused until this machine's qualification passed (datapass.pilot.codexAppQualified)
 */
import { markerLine, type WorkOrder } from "../workOrders/format";
import { sessionName, type Workspace } from "../workOrders/launch";
import { PILOT_CLIS } from "./rules";
import { CLAUDE_SETTINGS } from "./folder";

/** Values that must never reach a pilot launch, in any argument. */
export const FORBIDDEN_VALUES = ["bypassPermissions", "auto", "--dangerously-skip-permissions", "danger-full-access", "never", "workspace-write", "acceptEdits", "dontAsk"] as const;

/** The working folder of a pilot order is the order folder; the repositories it reads are added. */
export function pilotWorkspace(order: WorkOrder, orderFolder: string): Workspace {
  return { cwd: orderFolder, addDirs: order.repositories.map(r => r.localPath) };
}

export function pilotClaudeArgs(order: WorkOrder, orderMd: string, orderFolder: string, join: (...p: string[]) => string): string[] {
  const args: string[] = [];
  if (order.agent.sessionId) args.push("--session-id", order.agent.sessionId);
  args.push("--name", sessionName(order), "--effort", order.agent.effort);
  if (order.agent.model) args.push("--model", order.agent.model);
  args.push("--permission-mode", "default", "--settings", join(orderFolder, ...CLAUDE_SETTINGS.split("/")));
  for (const d of pilotWorkspace(order, orderFolder).addDirs) args.push("--add-dir", d);
  args.push(markerLine(order, orderMd));
  return args;
}

export function pilotCodexArgs(order: WorkOrder, orderMd: string, orderFolder: string): string[] {
  const args = ["-C", orderFolder, "--sandbox", "read-only", "--ask-for-approval", "on-request"];
  if (order.agent.model) args.push("-m", order.agent.model);
  args.push(markerLine(order, orderMd));
  return args;
}

/** The arguments of one pilot launch (terminal surfaces), or undefined for an app hand-off. */
export function pilotArgs(order: WorkOrder, orderMd: string, orderFolder: string, join: (...p: string[]) => string): string[] | undefined {
  if (order.agent.surface !== "terminal") return undefined;
  return order.agent.tool === "claude-code" ? pilotClaudeArgs(order, orderMd, orderFolder, join) : pilotCodexArgs(order, orderMd, orderFolder);
}

/** A forbidden value in the arguments (exact token, or `--flag=value`). */
export function forbiddenArgument(args: readonly string[]): string | undefined {
  for (const a of args) {
    const value = a.includes("=") && a.startsWith("--") ? a.slice(a.indexOf("=") + 1) : a;
    const hit = FORBIDDEN_VALUES.find(f => f === a || f === value);
    if (hit) return hit;
  }
  return undefined;
}

export interface PilotLaunchCheck {
  order: WorkOrder;
  /** datapass.pilot.enabled (a machine setting). */
  enabled: boolean;
  trusted: boolean;
  /** datapass.pilot.codexAppQualified: this machine passed the Codex app qualification. */
  codexAppQualified: boolean;
  /** Whether each guard-rail file on disk is byte-for-byte what DataPass generates for this order now. */
  guardRailsMatch: boolean;
  /** The arguments that would be passed (terminal surfaces). */
  args?: readonly string[];
  /** Environments the project declares, with their production flag. */
  environments: ReadonlyArray<{ id: string; production?: boolean }>;
}

export type Refusal = { rule: string; message: string };

/** Every reason DataPass refuses this pilot launch (empty: it may be launched, after the modal confirmation). */
export function pilotRefusals(c: PilotLaunchCheck): Refusal[] {
  const o = c.order;
  const out: Refusal[] = [];
  const add = (rule: string, message: string) => out.push({ rule, message });
  if (o.kind !== "pilot-read" || !o.pilot) { add("kind", "This is not a pilot order."); return out; }
  if (!c.enabled) add("setting", "Pilot mode is off on this computer (setting datapass.pilot.enabled).");
  if (!c.trusted) add("trust", "Restricted Mode: trust this workspace to launch a pilot order.");
  const env = c.environments.find(e => e.id === o.pilot!.environment);
  if (o.pilot.environment !== "dev" || env?.production) add("environment", `Pilot stage 1 works on dev only, not on "${o.pilot.environment}".`);
  if (o.repositories.some(r => r.access !== "read")) add("repositories", "A pilot order only reads repositories: one of them is to change.");
  if (o.expected.pullRequests !== "none") add("pull-requests", "A pilot order opens no pull request.");
  if (o.agent.permissions !== "ask") add("permissions", "A pilot order always asks before each action (permissions: ask).");
  if (o.agent.tool === "codex" && o.agent.surface === "desktop" && !c.codexAppQualified) add("codex-app", "The Codex app is not qualified for pilot orders on this computer yet: use Codex in a terminal, or Claude.");
  const other = o.pilot.clis.filter(x => !(PILOT_CLIS as readonly string[]).includes(x));
  if (other.length) add("clis", `Pilot stage 1 runs az and func only, not ${other.join(", ")}.`);
  if (!c.guardRailsMatch) add("guard-rails", "The pilot folder's .claude / .codex files differ from what DataPass wrote. Write a new pilot order.");
  const bad = c.args ? forbiddenArgument(c.args) : undefined;
  if (bad) add("arguments", `An argument would be "${bad}": never for a pilot order.`);
  return out;
}
