/**
 * V3-RC1: package.json must not repeat a key in the same object. JSON parsers keep only the last one,
 * so a second "editor/title" menu silently dropped the *Show File History* editor button (V3-GITDIAG).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

/** Returns "path.key" for every key repeated inside one object (strings and escapes are skipped). */
function duplicateKeys(text: string): string[] {
  const found: string[] = [];
  const stack: Array<{ keys: Set<string>; isObject: boolean; path: string }> = [];
  let i = 0;
  let lastString = "";
  let lastKey = "";
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      lastString = JSON.parse(text.slice(i, j + 1)) as string;
      i = j + 1;
      continue;
    }
    if (c === ":") {
      const top = stack[stack.length - 1];
      if (top?.isObject) {
        if (top.keys.has(lastString)) found.push(`${top.path}.${lastString}`);
        top.keys.add(lastString);
        lastKey = lastString;
      }
    } else if (c === "{" || c === "[") {
      const parent = stack[stack.length - 1];
      stack.push({ keys: new Set(), isObject: c === "{", path: parent ? `${parent.path}.${parent.isObject ? lastKey : "[]"}` : "$" });
    } else if (c === "}" || c === "]") {
      stack.pop();
    }
    i++;
  }
  return found;
}

test("package.json repeats no key inside one object", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
  assert.deepEqual(duplicateKeys(text), []);
});

test("the duplicate-key check finds a repeated menu", () => {
  assert.deepEqual(duplicateKeys('{"menus":{"editor/title":[{"a":1}],"x":[],"editor/title":[]}}'), ["$.menus.editor/title"]);
});
