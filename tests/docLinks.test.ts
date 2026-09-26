/**
 * V1-SURF: the entry documents a person or an AI reads first have no broken relative links
 * (files and folders; `#anchors` and web links are not checked here).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ENTRY = [
  "CLAUDE.md", "README.md", "handoff/CURRENT.md", "handoff/README.md", "handoff/PLAN.md", "handoff/ROADMAP.md",
  "docs/DEMARRER.md", "docs/PREPARING_A_PROJECT.md",
  ...readdirSync("docs/guide").filter(f => f.endsWith(".md")).map(f => `docs/guide/${f}`)
].filter(f => existsSync(f));

/** Relative link targets of a Markdown text, outside code spans and fenced blocks. */
export function relativeLinks(md: string): string[] {
  const text = md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const out: string[] = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]!.split("#")[0]!;
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    out.push(decodeURIComponent(target));
  }
  return out;
}

test("doc links: relativeLinks skips web links, anchors and code", () => {
  assert.deepEqual(relativeLinks("[a](b.md) [w](https://x.y) [h](#top) `[c](d.md)` [e](f/g.md#s \"t\")"), ["b.md", "f/g.md"]);
});

test("doc links: every relative link in the entry documents resolves", () => {
  const broken: string[] = [];
  for (const f of ENTRY) for (const l of relativeLinks(readFileSync(f, "utf8"))) {
    if (!existsSync(join(dirname(f), l))) broken.push(`${f} → ${l}`);
  }
  assert.deepEqual(broken, []);
});
