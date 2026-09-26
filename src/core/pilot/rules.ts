/**
 * Pilot stage 1 (AI-4a): the read-only command rules DataPass writes into a pilot order's folder
 * (handoff/briefs/2026-09-26-ai4-pilot-allowlist.md, "Decision"). Pure.
 *
 * These tables are CODE, a reviewed constant: no hub, toolkit or project file can extend them
 * (acceptance test 6 checks this module imports nothing from the toolkit or hub reader).
 *
 * A rule is a command prefix as tokens. In the Claude rules a trailing " *" means "any further
 * arguments" and a "*" token in the middle means "any sub-command" (Claude Code's wildcard matches
 * any text). Codex has no middle wildcard: its rules are prefixes, where one token may list
 * alternatives, so verb denies are written per command group (see codexRules in folder.ts).
 *
 * The real safety net is the cloud role (Reader, Storage Blob Data Reader). These rules are guard
 * rails: they match command text, not programs.
 */

/** The CLIs a stage-1 pilot order may name. `fab` and `databricks` are sketched below but not enabled. */
export const PILOT_CLIS = ["az", "func"] as const;
export type PilotCli = typeof PILOT_CLIS[number];
export const SKETCHED_CLIS = ["fab", "databricks"] as const;

/** A command prefix. `exact`: the command with no further arguments only. */
export interface AllowRule { cli: PilotCli; tokens: readonly string[]; exact?: boolean }

const a = (cli: PilotCli, text: string, exact = false): AllowRule => ({ cli, tokens: text.split(" "), ...(exact ? { exact } : {}) });

/** Allowed in stage 1 (`dev` only). `--auth-mode login` is part of the storage prefixes: without it `az` reads the account key. */
export const ALLOW: readonly AllowRule[] = [
  a("az", "az version", true),
  a("az", "az account show"),
  a("az", "az account list"),
  a("az", "az group list"), a("az", "az group show"),
  a("az", "az resource list"), a("az", "az resource show"),
  a("az", "az functionapp list"), a("az", "az functionapp show"),
  a("az", "az functionapp function list"), a("az", "az functionapp function show"),
  a("az", "az functionapp config show"),
  a("az", "az functionapp plan show"),
  a("az", "az storage account list"), a("az", "az storage account show"),
  a("az", "az storage container list --auth-mode login"),
  a("az", "az storage blob list --auth-mode login"),
  a("az", "az monitor app-insights query"),
  a("az", "az monitor metrics list"),
  a("az", "az monitor activity-log list"),
  a("func", "func --version", true),
  a("func", "func azure functionapp list-functions"),
  a("func", "func settings list", true)
];

/**
 * Denied, as command prefixes right after the CLI name ("az rest", "az account get-access-token").
 * Written as `<cli> <prefix>` and `<cli> <prefix> *`.
 */
export const DENY_PREFIXES: Readonly<Record<PilotCli, readonly string[]>> = {
  az: [
    "rest", "login", "logout", "account set", "account clear", "account get-access-token", "config", "configure",
    "extension add", "extension update", "extension remove", "interactive", "upgrade", "keyvault", "ad", "role",
    "storage blob query", "--debug"
  ],
  func: [
    "azure functionapp publish", "azure functionapp fetch-app-settings", "azure storage fetch-connection-string",
    "start", "run", "host", "new", "init", "pack", "deploy", "settings add", "settings delete", "settings encrypt", "settings decrypt",
    "durable", "extensions", "bundles", "workload", "setup", "quickstart", "profile set", "kubernetes", "azurecontainerapps"
  ]
};

/**
 * Denied anywhere after the CLI name: verbs and sub-commands (`az * create`, `az * keys *`) and flags
 * (`func * --show-keys`). Written as `<cli> * <word>` and `<cli> * <word> *`.
 */
export const DENY_WORDS: Readonly<Record<PilotCli, readonly string[]>> = {
  az: [
    "create", "delete", "update", "set", "start", "stop", "restart", "deploy", "upload", "download", "copy", "sync", "import", "purge",
    "invoke-action", "generate-sas", "keys", "show-connection-string", "connection-string", "appsettings", "list-publishing-*", "lease", "--debug"
  ],
  func: ["--show-keys", "--showValue", "--access-token*", "-a"]
};

/** Not allowed and not denied, so the agent must ask: a two-hour stream (use the App Insights query instead). */
export const ASK_ONLY: readonly string[] = ["func azure functionapp logstream"];

/** Sketches for 1b/later (not enabled: their flag is off until verified against their docs). */
export const SKETCH: Readonly<Record<typeof SKETCHED_CLIS[number], { allow: readonly string[]; deny: readonly string[] }>> = {
  fab: {
    allow: ["fab --version", "fab auth status", "fab ls", "fab get", "fab exists", "fab desc"],
    deny: ["api", "set", "rm", "mkdir", "cp", "mv", "import", "export", "job", "acl set", "acl rm", "start", "stop", "assign", "unassign", "ln", "auth login", "auth logout", "config set"]
  },
  databricks: {
    allow: ["databricks auth profiles", "databricks current-user me", "databricks workspace list", "databricks jobs list", "databricks jobs get", "databricks jobs list-runs", "databricks clusters list"],
    deny: ["api", "auth token", "auth login", "configure", "secrets", "fs", "workspace export", "workspace import", "jobs run-now", "jobs submit", "jobs cancel", "bundle"]
  }
};

// ------------------------------------------------------------------ rule text (Claude)

/** Claude patterns (inside `Bash(…)` / `PowerShell(…)`) for one CLI's allow rules. */
export function allowPatterns(clis: readonly PilotCli[]): string[] {
  const out: string[] = [];
  for (const r of ALLOW.filter(x => clis.includes(x.cli))) {
    const base = r.tokens.join(" ");
    out.push(base);
    if (!r.exact) out.push(`${base} *`);
  }
  return out;
}

export function denyPatterns(clis: readonly PilotCli[]): string[] {
  const out: string[] = [];
  for (const cli of clis) {
    for (const p of DENY_PREFIXES[cli]) out.push(`${cli} ${p}`, `${cli} ${p} *`);
    for (const w of DENY_WORDS[cli]) out.push(`${cli} * ${w}`, `${cli} * ${w} *`);
  }
  return [...new Set(out)];
}

/** Each pattern written for both shells Claude Code uses on Windows. */
export const shellRules = (patterns: readonly string[]): string[] => patterns.flatMap(p => [`Bash(${p})`, `PowerShell(${p})`]);

// ------------------------------------------------------------------ matcher (tests; documented prefix semantics)

/** Claude Code's wildcard: `*` matches any text (including none); the rest is literal. */
export function globMatch(pattern: string, command: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s");
  return re.test(command);
}

/** Sub-commands of a compound command (`&&`, `||`, `;`, `|`, new lines): each is checked on its own, as Claude Code does. */
export function subCommands(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map(s => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

export type Verdict = "deny" | "allow" | "ask";

/** Deny wins; allowed only when every sub-command matches an allow rule; otherwise the agent asks. */
export function verdictOf(command: string, allow: readonly string[], deny: readonly string[]): Verdict {
  const parts = subCommands(command);
  if (parts.some(p => deny.some(d => globMatch(d, p)))) return "deny";
  if (parts.length && parts.every(p => allow.some(x => globMatch(x, p)))) return "allow";
  return "ask";
}
