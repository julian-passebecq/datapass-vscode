/**
 * Where a value sits in a JSON text, so a single value can be replaced in place: the rest of the
 * file (formatting, key order, line endings) stays byte for byte. Pure. The text must already have
 * been accepted by parseStrictJson (no duplicate keys, valid escapes); anything unexpected returns
 * undefined rather than a guess, and the caller re-parses its result to verify the edit.
 */

export type JsonPath = ReadonlyArray<string | number>;

const LITERAL = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

class LocateError extends Error {}

/** [start, end) of the value at `path` (a string includes its quotes), or undefined. */
export function locateJsonValue(text: string, path: JsonPath): { start: number; end: number } | undefined {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let found: { start: number; end: number } | undefined;

  const ws = () => { while (pos < text.length && " \n\r\t".includes(text[pos]!)) pos++; };
  const bad = (): never => { throw new LocateError(); };

  const readString = (): string => {
    const start = pos;
    if (text[pos] !== '"') bad();
    pos++;
    while (pos < text.length) {
      const c = text[pos]!;
      if (c === '"') { pos++; return JSON.parse(text.slice(start, pos)) as string; }
      pos += c === "\\" ? 2 : 1;
    }
    return bad();
  };

  /** `rest`: what is left of the path below this value, or undefined when the target is not below it. */
  const value = (depth: number, rest: JsonPath | undefined): void => {
    if (depth > 64) bad();
    ws();
    const start = pos;
    const c = text[pos];
    if (c === "{") {
      pos++;
      ws();
      if (text[pos] === "}") pos++;
      else for (;;) {
        ws();
        const key = readString();
        ws();
        if (text[pos] !== ":") bad();
        pos++;
        value(depth + 1, rest?.length && rest[0] === key ? rest.slice(1) : undefined);
        ws();
        if (text[pos] === ",") { pos++; continue; }
        if (text[pos] === "}") { pos++; break; }
        bad();
      }
    } else if (c === "[") {
      pos++;
      ws();
      if (text[pos] === "]") pos++;
      else for (let index = 0; ; index++) {
        value(depth + 1, rest?.length && rest[0] === index ? rest.slice(1) : undefined);
        ws();
        if (text[pos] === ",") { pos++; continue; }
        if (text[pos] === "]") { pos++; break; }
        bad();
      }
    } else if (c === '"') {
      readString();
    } else {
      LITERAL.lastIndex = pos;
      const m = LITERAL.exec(text);
      if (!m) bad();
      pos += m![0].length;
    }
    if (rest && rest.length === 0) found = { start, end: pos };
  };

  try {
    value(0, path);
    ws();
    if (pos !== text.length) return undefined;
  } catch (e) {
    if (e instanceof LocateError || e instanceof SyntaxError) return undefined;
    throw e;
  }
  return found;
}
