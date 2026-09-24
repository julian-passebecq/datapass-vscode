/**
 * Strict, bounded JSON parser for untrusted input (clipboard, AI output, imported files).
 *
 * JSON.parse silently keeps the last duplicate key, turns 1e999 into Infinity and
 * assigns `__proto__` keys through the prototype setter. None of that is acceptable
 * for exchange envelopes, so this is a small recursive-descent parser with explicit limits.
 */

export interface StrictJsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxEntries: number;
  maxStringLength: number;
}

export const DEFAULT_LIMITS: StrictJsonLimits = {
  maxBytes: 1_048_576,
  maxDepth: 30,
  maxEntries: 10_000,
  maxStringLength: 262_144
};

export class StrictJsonError extends Error {
  constructor(message: string, readonly offset?: number) {
    super(offset === undefined ? message : `${message} (at offset ${offset})`);
    this.name = "StrictJsonError";
  }
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function parseStrictJson(raw: string | Uint8Array, limits: Partial<StrictJsonLimits> = {}): unknown {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
  if (bytes > lim.maxBytes) throw new StrictJsonError(`Input exceeds ${lim.maxBytes} bytes`);
  const text = typeof raw === "string" ? raw : decodeUtf8Strict(raw);

  let pos = 0;
  let entries = 0;

  const ws = () => {
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos++;
      else break;
    }
  };
  const fail = (msg: string): never => { throw new StrictJsonError(msg, pos); };
  const count = () => { if (++entries > lim.maxEntries) fail(`More than ${lim.maxEntries} values`); };

  const parseString = (): string => {
    const start = pos;
    if (text[pos] !== '"') fail("Expected string");
    pos++;
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c === 0x22) {
        pos++;
        let value: string;
        try {
          value = JSON.parse(text.slice(start, pos)) as string;
        } catch {
          return fail("Invalid string escape");
        }
        if (value.length > lim.maxStringLength) fail("String too long");
        return value;
      }
      if (c === 0x5c) { pos += 2; continue; }
      if (c < 0x20) fail("Control character in string");
      pos++;
    }
    return fail("Unterminated string");
  };

  const parseValue = (depth: number): unknown => {
    if (depth > lim.maxDepth) fail(`Nesting deeper than ${lim.maxDepth}`);
    ws();
    count();
    const c = text[pos];
    if (c === "{") {
      pos++;
      const out: Record<string, unknown> = {};
      const seen = new Set<string>();
      ws();
      if (text[pos] === "}") { pos++; return out; }
      for (;;) {
        ws();
        const key = parseString();
        if (seen.has(key)) fail(`Duplicate JSON key: ${key}`);
        if (FORBIDDEN_KEYS.has(key)) fail(`Forbidden JSON key: ${key}`);
        seen.add(key);
        ws();
        if (text[pos] !== ":") fail("Expected ':'");
        pos++;
        const value = parseValue(depth + 1);
        Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
        ws();
        if (text[pos] === ",") { pos++; continue; }
        if (text[pos] === "}") { pos++; return out; }
        fail("Expected ',' or '}'");
      }
    }
    if (c === "[") {
      pos++;
      const out: unknown[] = [];
      ws();
      if (text[pos] === "]") { pos++; return out; }
      for (;;) {
        out.push(parseValue(depth + 1));
        ws();
        if (text[pos] === ",") { pos++; continue; }
        if (text[pos] === "]") { pos++; return out; }
        fail("Expected ',' or ']'");
      }
    }
    if (c === '"') return parseString();
    if (text.startsWith("true", pos)) { pos += 4; return true; }
    if (text.startsWith("false", pos)) { pos += 5; return false; }
    if (text.startsWith("null", pos)) { pos += 4; return null; }
    NUMBER_RE.lastIndex = pos;
    const m = NUMBER_RE.exec(text);
    if (m && m[0].length > 0) {
      pos += m[0].length;
      const n = Number(m[0]);
      if (!Number.isFinite(n)) fail(`Nonfinite number: ${m[0]}`);
      return n;
    }
    return fail("Unexpected token");
  };

  // A leading BOM is tolerated; anything else before the value is not.
  if (text.charCodeAt(0) === 0xfeff) pos = 1;
  const value = parseValue(0);
  ws();
  if (pos !== text.length) fail("Trailing content after JSON value");
  return value;
}

export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StrictJsonError("Input is not valid UTF-8");
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
