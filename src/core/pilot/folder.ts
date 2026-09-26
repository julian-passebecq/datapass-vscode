/**
 * Pilot stage 1 (AI-4a): the "pilot folder". The order folder itself is the agent's working folder
 * and holds the guard rails DataPass writes (brief 2026-09-26-ai4-pilot-allowlist.md, "Decision"):
 *
 *   <order folder>/.claude/settings.json   Claude Code (terminal and desktop app read the same file;
 *                                           cwd only, no parent fallback)
 *   <order folder>/.codex/config.toml      Codex: read-only sandbox, approval on request
 *   <order folder>/.codex/rules/pilot.rules Codex prefix rules (allow = runs outside the sandbox,
 *                                           forbidden = blocked, everything else asks)
 *
 * Only ever under the git-ignored .datapass/local/work-orders/<id>/, never in a repository. The
 * content is a pure function of the order, so DataPass regenerates it just before a launch and
 * refuses when the files on disk differ. Pure.
 */
import {
  ALLOW, ASK_ONLY, DENY_PREFIXES, DENY_WORDS, allowPatterns, denyPatterns, shellRules, type PilotCli
} from "./rules";

export const CLAUDE_SETTINGS = ".claude/settings.json";
export const CODEX_CONFIG = ".codex/config.toml";
export const CODEX_RULES = ".codex/rules/pilot.rules";
export const GUARD_RAIL_FILES = [CLAUDE_SETTINGS, CODEX_CONFIG, CODEX_RULES] as const;
/** Folders that must not exist in the order folder before DataPass writes the guard rails. */
export const AGENT_CONFIG_DIRS = [".claude", ".codex"] as const;

export interface PilotFolderInput {
  orderId: string;
  clis: readonly PilotCli[];
  /** Absolute local paths of the repositories the order reads (added directories; edits denied). */
  readRepositories: readonly string[];
}

/**
 * A local path in the form Claude Code matches path rules against: `//` + POSIX form, Windows
 * drives as `/d/…` (code.claude.com permissions: "C:\Users\alice becomes /c/Users/alice").
 */
export function claudeAbsolute(p: string): string {
  const posix = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const drive = /^([A-Za-z]):\/?(.*)$/.exec(posix);
  return drive ? `//${drive[1]!.toLowerCase()}/${drive[2]}` : `/${posix}`;
}

export function claudeSettings(i: PilotFolderInput): string {
  const doc = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    permissions: {
      defaultMode: "default",
      disableBypassPermissionsMode: "disable",
      disableAutoMode: "disable",
      additionalDirectories: [...i.readRepositories],
      allow: [...shellRules(allowPatterns(i.clis)), "Edit(requests/**)", "Edit(result.json)"],
      deny: [...shellRules(denyPatterns(i.clis)), ...i.readRepositories.map(r => `Edit(${claudeAbsolute(r)}/**)`)]
    }
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function codexConfig(i: PilotFolderInput): string {
  return [
    `# Written by DataPass for the pilot order ${i.orderId} (stage 1, read-only). Do not edit:`,
    "# DataPass compares this file with what it generated before each launch and refuses when they differ.",
    'sandbox_mode = "read-only"',
    'approval_policy = "on-request"',
    ""
  ].join("\n");
}

const q = (s: string) => JSON.stringify(s);
const tokenList = (tokens: readonly (string | readonly string[])[]) =>
  `[${tokens.map(t => (typeof t === "string" ? q(t) : `[${t.map(q).join(", ")}]`)).join(", ")}]`;

interface CodexRule { pattern: Array<string | readonly string[]>; decision: "allow" | "forbidden"; justification: string; match: string[]; notMatch: string[] }

/** The command groups the allow rules name (`az group`, `az storage account`…): verb denies are written for each. */
function commandGroups(cli: PilotCli): string[][] {
  const groups = new Map<string, string[]>();
  for (const r of ALLOW.filter(x => x.cli === cli && !x.exact)) {
    const verbIndex = r.tokens.findIndex((t, n) => n > 0 && ["list", "show", "query", "list-functions"].includes(t));
    if (verbIndex < 2) continue;
    const path = r.tokens.slice(0, verbIndex);
    groups.set(path.join(" "), path);
  }
  return [...groups.values()];
}

export function codexRules(i: PilotFolderInput): CodexRule[] {
  const rules: CodexRule[] = [];
  for (const r of ALLOW.filter(x => i.clis.includes(x.cli))) {
    const cmd = r.tokens.join(" ");
    rules.push({
      pattern: [...r.tokens], decision: "allow", justification: "DataPass pilot stage 1: read-only",
      match: [r.exact ? cmd : `${cmd} --output json`],
      notMatch: [`${r.tokens.slice(0, -1).join(" ")} delete-me`]
    });
  }
  for (const cli of i.clis) {
    for (const p of DENY_PREFIXES[cli]) {
      const tokens = [cli, ...p.split(" ")];
      rules.push({ pattern: tokens, decision: "forbidden", justification: "DataPass pilot stage 1: writes, secrets or sign-in changes", match: [`${tokens.join(" ")} --help`], notMatch: [`${cli} version-check`] });
    }
    const verbs = DENY_WORDS[cli].filter(w => !w.includes("*") && !w.startsWith("-"));
    for (const g of commandGroups(cli)) {
      if (!verbs.length) continue;
      rules.push({ pattern: [...g, verbs], decision: "forbidden", justification: "DataPass pilot stage 1: no change in the cloud, no key", match: [`${g.join(" ")} ${verbs[0]} --name x`], notMatch: [`${g.join(" ")} list`] });
    }
  }
  if (i.clis.includes("func")) {
    rules.push({ pattern: ["func", "settings", "list", ["-a", "--showValue"]], decision: "forbidden", justification: "DataPass pilot stage 1: no secret values", match: ["func settings list -a"], notMatch: ["func settings list"] });
  }
  return rules;
}

export function codexRulesText(i: PilotFolderInput): string {
  const lines = [
    `# Written by DataPass for the pilot order ${i.orderId} (stage 1, read-only). Do not edit.`,
    "# allow: runs outside the read-only sandbox (it needs the network). forbidden: blocked.",
    "# Every other command runs in the read-only sandbox, without network, or asks you first.",
    `# Not allowed on purpose (asks): ${ASK_ONLY.join(", ")}.`,
    ""
  ];
  for (const r of codexRules(i)) {
    lines.push(
      "prefix_rule(",
      `    pattern = ${tokenList(r.pattern)},`,
      `    decision = ${q(r.decision)},`,
      `    justification = ${q(r.justification)},`,
      `    match = [${r.match.map(q).join(", ")}],`,
      `    not_match = [${r.notMatch.map(q).join(", ")}],`,
      ")",
      ""
    );
  }
  return lines.join("\n");
}

/** Every guard-rail file, by path relative to the order folder, exactly as DataPass writes it. */
export function pilotFolderFiles(i: PilotFolderInput): Array<{ rel: string; text: string }> {
  return [
    { rel: CLAUDE_SETTINGS, text: claudeSettings(i) },
    { rel: CODEX_CONFIG, text: codexConfig(i) },
    { rel: CODEX_RULES, text: codexRulesText(i) }
  ];
}
