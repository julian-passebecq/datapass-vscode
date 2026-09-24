import assert from "node:assert/strict";
import test from "node:test";
import { galaxyHtml } from "../src/views/galaxyHtml";

const scripts = (html: string) => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map(m => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));

test("every Galaxy webview script parses (a syntax error leaves the panel blank)", () => {
  const found = scripts(galaxyHtml("vscode-resource:", "NONCE123"));
  assert.ok(found.length > 0);
  for (const s of found) assert.doesNotThrow(() => new Function(s.body), `script failed to parse:\n${s.body.slice(0, 200)}`);
});

test("scripts carry the nonce and the CSP allows only that nonce", () => {
  const html = galaxyHtml("vscode-resource:", "NONCE123");
  assert.ok(scripts(html).every(s => s.attrs.includes('nonce="NONCE123"')));
  assert.match(html, /script-src 'nonce-NONCE123'/);
  assert.match(html, /style-src vscode-resource: 'unsafe-inline'/);
});

test("shortValue splits Windows and POSIX paths alike", () => {
  const body = scripts(galaxyHtml("x", "n")).map(s => s.body).join("\n");
  const src = body.match(/function shortValue\(value\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(src, "shortValue not found");
  const shortValue = new Function(`${src}; return shortValue;`)() as (v: string) => string;
  assert.equal(shortValue(String.raw`D:\PROJ\foil\control`), "foil/control");
  assert.equal(shortValue("/home/u/foil/control"), "foil/control");
});
