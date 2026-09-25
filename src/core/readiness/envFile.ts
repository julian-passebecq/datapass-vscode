/**
 * Key-presence parsing of local env files (.env, .env.local, .dev.vars…). Pure.
 *
 * DataPass needs to know which variable NAMES a file defines and whether each is non-empty. It
 * never needs a value, so this parser returns only `name → "set" | "empty"` for the names it was
 * asked about. Values are never sliced out, returned, logged, compared or cached; undeclared names
 * are not returned either (names can be private too). The decoded text lives only inside this
 * call.
 *
 * Syntax follows dotenv: `KEY=value`, `export KEY=value`, `KEY: value`, `#` comments, single,
 * double and backtick quotes (a quoted value may span lines). A name defined twice keeps the last
 * definition, like dotenv.
 */

export type KeyPresence = "set" | "empty";

/** Env files DataPass may read for key presence: .env*, *.env, .dev.vars* (Cloudflare Wrangler). */
const ENV_FILE_NAME = /^(?:\.env(?:\.[A-Za-z0-9_-]+)*|[A-Za-z0-9_-]+\.env|\.dev\.vars(?:\.[A-Za-z0-9_-]+)*)$/;
/** Variable names DataPass accepts in the manifest (POSIX-like, as dotenv and shells use them). */
export const ENV_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const MAX_ENV_FILE_BYTES = 256 * 1024;

export function isEnvFileName(relativePath: string): boolean {
  const base = relativePath.split("/").pop() ?? "";
  return ENV_FILE_NAME.test(base);
}

/** Start of a definition at a line start: optional `export`, the name, then `=` or `: `. The match never includes the value. */
const DEFINITION = /[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*(?:=|:(?=[ \t]))/y;

const lineEnd = (text: string, from: number) => { const i = text.indexOf("\n", from); return i < 0 ? text.length : i; };

/** Index of the closing quote, or -1. Backslash escapes count inside double quotes and backticks. */
function closingQuote(text: string, from: number, quote: string): number {
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\" && quote !== "'") { i += 1; continue; }
    if (c === quote) return i;
  }
  return -1;
}

/**
 * For each wanted name found in the file: "set" (non-empty value) or "empty". Names not in
 * `wanted` are skipped without being recorded.
 */
export function envKeyPresence(bytes: Uint8Array, wanted: ReadonlySet<string>): Map<string, KeyPresence> {
  const out = new Map<string, KeyPresence>();
  if (!wanted.size) return out;
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let i = 0;
  while (i < text.length) {
    const eol = lineEnd(text, i);
    DEFINITION.lastIndex = i;
    const m = DEFINITION.exec(text);
    if (!m || m.index !== i || DEFINITION.lastIndex > eol) { i = eol + 1; continue; }
    const name = m[1]!;
    let j = DEFINITION.lastIndex;
    while (j < eol && (text[j] === " " || text[j] === "\t")) j += 1;
    const c = text[j];
    let presence: KeyPresence;
    let next = eol + 1;
    if (c === "\"" || c === "'" || c === "`") {
      const close = closingQuote(text, j + 1, c);
      if (close < 0) presence = "set";
      else { presence = close > j + 1 ? "set" : "empty"; next = lineEnd(text, close) + 1; }
    } else {
      presence = j >= eol || c === "#" || c === "\r" ? "empty" : "set";
    }
    if (wanted.has(name)) out.set(name, presence);
    i = next;
  }
  return out;
}
