/**
 * JSON and YAML syntax. JSON goes through JSON.parse; YAML through the bundled `yaml` parser
 * (core schema: no custom tag ever constructs anything). Only errors are reported: unknown tags
 * such as CloudFormation's `!Ref` stay warnings of the parser and are not shown.
 */
import { LineCounter, parseAllDocuments, parseDocument, type Document } from "yaml";
import { finding, type Finding } from "./types";

/** Line/column (0-based) of an offset. */
export function positionAt(text: string, offset: number): { line: number; col: number } {
  let line = 0, start = 0;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) { line++; start = i + 1; }
  return { line, col: end - start };
}

const stripBom = (t: string) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

export function checkJsonSyntax(file: string, text: string): Finding[] {
  const body = stripBom(text);
  try { JSON.parse(body); return []; } catch {
    // JSON.parse's message and position vary between runtimes; locate the error ourselves.
    const err = locateJsonError(body);
    return [finding(file, "json.syntax", "error", `JSON syntax: ${err.message}.`, positionAt(body, err.offset))];
  }
}

/** First syntax error of a JSON text (called only once JSON.parse has failed). Iterative: no recursion limit. */
export function locateJsonError(t: string): { offset: number; message: string } {
  let i = 0;
  const ws = () => { while (i < t.length && " \t\r\n".includes(t[i]!)) i++; };
  const fail = (message: string) => ({ offset: i, message });
  const describe = () => (i >= t.length ? "unexpected end of the file" : `unexpected \`${t[i]}\``);
  // Stack of open containers; "k" = object expecting a key, "v" = expecting a value.
  const stack: Array<"{" | "["> = [];
  const value = (): { offset: number; message: string } | undefined => {
    ws();
    const c = t[i];
    if (c === '"') {
      i++;
      while (i < t.length && t[i] !== '"') {
        if (t[i] === "\\") { i++; if (!/["\\/bfnrtu]/.test(t[i] ?? "")) return fail("invalid escape in a string"); }
        else if (t.charCodeAt(i) < 0x20) return fail("control character or line break inside a string");
        i++;
      }
      if (i >= t.length) return fail("unterminated string");
      i++;
      return undefined;
    }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|^(true|false|null)/.exec(t.slice(i, i + 400));
    if (m && m[0]) { i += m[0].length; return undefined; }
    return fail(describe() + " where a value was expected");
  };
  ws();
  for (;;) {
    ws();
    const c = t[i];
    if (c === "{" || c === "[") {
      stack.push(c); i++; ws();
      if (t[i] === (c === "{" ? "}" : "]")) { i++; stack.pop(); }
      else if (c === "{") { if (t[i] !== '"') return fail(describe() + " where a property name was expected"); continue; }
      else continue;
    } else {
      if (stack[stack.length - 1] === "{") {
        const e = value(); if (e) return e; // the key
        ws(); if (t[i] !== ":") return fail(describe() + " where `:` was expected"); i++;
        ws();
        if (t[i] === "{" || t[i] === "[") continue;
      }
      const e = value(); if (e) return e;
    }
    // after a complete value: close containers or expect a comma
    for (;;) {
      ws();
      const top = stack[stack.length - 1];
      if (!top) return i < t.length ? fail(describe() + " after the end of the JSON value") : fail("invalid JSON");
      const close = top === "{" ? "}" : "]";
      if (t[i] === close) { i++; stack.pop(); continue; }
      if (t[i] !== ",") return fail(describe() + ` where \`,\` or \`${close}\` was expected`);
      i++; ws();
      if (t[i] === close) return fail(`trailing comma before \`${close}\``);
      if (top === "{" && t[i] !== '"') return fail(describe() + " where a property name was expected");
      break;
    }
  }
}

export interface ParsedYaml { docs: Document.Parsed[]; lines: LineCounter }

function yamlErrors(file: string, docs: Document.Parsed[], lines: LineCounter): Finding[] {
  const out: Finding[] = [];
  for (const d of docs) for (const err of d.errors) {
    const [s, e] = err.pos;
    const a = lines.linePos(s), b = lines.linePos(Math.max(e, s + 1));
    const text = err.message.split("\n")[0]!.replace(/ at line \d+, column \d+:?$/, "");
    out.push(finding(file, "yaml.syntax", "error", `YAML syntax: ${text}`, { line: a.line - 1, col: a.col - 1, endLine: b.line - 1, endCol: b.col - 1 }));
  }
  return out;
}

/** Every document of a (possibly multi-document) YAML file; errors as findings. */
export function checkYamlSyntax(file: string, text: string): Finding[] {
  const lines = new LineCounter();
  const docs = parseAllDocuments(stripBom(text), { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  return Array.isArray(docs) ? yamlErrors(file, docs, lines) : [];
}

/** One YAML document with positions, or its errors. */
export function parseYaml(file: string, text: string): { doc?: Document.Parsed; lines: LineCounter; errors: Finding[] } {
  const lines = new LineCounter();
  const doc = parseDocument(stripBom(text), { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  const errors = yamlErrors(file, [doc], lines);
  return errors.length ? { lines, errors } : { doc, lines, errors };
}
