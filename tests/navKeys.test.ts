/**
 * V4-NAV NAVKEYS1: plain keys inside the nav webviews never take typing or Ctrl/Cmd chords, and the
 * global chords (Shift+Alt+P then a key) collide with no VS Code default on Windows, macOS or Linux,
 * fire only while a nav view is active outside the editor, terminal, trees and inputs, and can be
 * switched off by a setting. The defaults checked are in tests/fixtures/vscode-default-shift-alt-keys.json.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_NAV_KEYS, isTypingTarget, navCommandForKey, parseNavKeys } from "../src/webview/navKeys";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const defaults = JSON.parse(readFileSync("tests/fixtures/vscode-default-shift-alt-keys.json", "utf8")) as { os: Record<string, string[]> };
const NAV = ["up", "down", "left", "right", "home", "back", "forward", "pickView"].map(c => `datapass.nav.${c}`);
const navKeys = (pkg.contributes.keybindings as Array<{ command: string; key: string; mac?: string; when: string }>).filter(k => k.command.startsWith("datapass.nav."));

test("navKeys: arrows, Home and Backspace map to nav commands; Down carries the selection", () => {
  assert.deepEqual(navCommandForKey({ key: "ArrowUp" }), { type: "up" });
  assert.deepEqual(navCommandForKey({ key: "ArrowDown" }, "n7"), { type: "down", childId: "n7" });
  assert.deepEqual(navCommandForKey({ key: "ArrowDown" }), { type: "down" });
  assert.deepEqual(navCommandForKey({ key: "ArrowLeft" }), { type: "left" });
  assert.deepEqual(navCommandForKey({ key: "ArrowRight" }), { type: "right" });
  assert.deepEqual(navCommandForKey({ key: "Home" }), { type: "home" });
  assert.deepEqual(navCommandForKey({ key: "Backspace" }), { type: "back" });
  assert.equal(navCommandForKey({ key: "a" }), null);
});

test("navKeys: typing targets, modifier chords, IME and handled events are left alone", () => {
  for (const tagName of ["INPUT", "textarea", "SELECT"]) assert.equal(navCommandForKey({ key: "ArrowUp", target: { tagName } }), null, tagName);
  assert.equal(navCommandForKey({ key: "ArrowUp", target: { tagName: "DIV", isContentEditable: true } }), null);
  assert.equal(navCommandForKey({ key: "ArrowUp", target: { tagName: "DIV", getAttribute: () => "combobox" } }), null);
  assert.ok(!isTypingTarget({ tagName: "DIV", getAttribute: () => "tree" }));
  for (const m of ["ctrlKey", "metaKey", "shiftKey", "altKey", "isComposing", "defaultPrevented"]) {
    assert.equal(navCommandForKey({ key: "ArrowLeft", [m]: true }), null, m);
  }
});

test("navKeys: a key map from settings is validated; nonsense falls back to the default", () => {
  assert.equal(parseNavKeys("x"), DEFAULT_NAV_KEYS);
  assert.equal(parseNavKeys([{ key: "k", command: "rm -rf" }]), DEFAULT_NAV_KEYS);
  const vim = parseNavKeys([{ key: "k", command: "up" }, { key: "j", command: "down" }, { key: "h", alt: true, command: "back" }, 3]);
  assert.equal(vim.length, 3);
  assert.deepEqual(navCommandForKey({ key: "k" }, undefined, vim), { type: "up" });
  assert.deepEqual(navCommandForKey({ key: "h", altKey: true }, undefined, vim), { type: "back" });
  assert.equal(navCommandForKey({ key: "ArrowUp" }, undefined, vim), null);
});

test("navKeys: every nav command has one global chord, guarded and switchable", () => {
  assert.deepEqual(navKeys.map(k => k.command).sort(), [...NAV].sort());
  const setting = pkg.contributes.configuration.properties["datapass.nav.globalKeys"];
  assert.equal(setting?.type, "boolean");
  for (const k of navKeys) {
    for (const clause of ["datapass.nav.active", "config.datapass.nav.globalKeys", "!editorTextFocus", "!terminalFocus", "!listFocus", "!inputFocus"]) {
      assert.ok(k.when.split(" && ").includes(clause), `${k.command}: when needs ${clause}`);
    }
    assert.equal(k.mac, undefined, `${k.command}: same chord on every OS`);
  }
});

test("navKeys: the chord prefix collides with no VS Code default on Windows, macOS or Linux", () => {
  assert.deepEqual(Object.keys(defaults.os).sort(), ["linux", "macos", "windows"]);
  for (const [os, keys] of Object.entries(defaults.os)) {
    assert.ok(keys.length > 10, `${os}: the fixture lists the Shift+Alt defaults`);
    assert.ok(keys.includes("shift+alt+up") && keys.includes("shift+alt+down"), `${os}: sanity (copy line up/down)`);
    for (const k of navKeys) {
      const [prefix, second] = k.key.split(" ");
      assert.equal(prefix, "shift+alt+p", `${k.command}: chords start with the shared prefix`);
      assert.ok(second, `${k.command}: two-step chord`);
      assert.ok(!keys.includes(prefix!), `${os}: ${prefix} is a VS Code default`);
    }
  }
  assert.equal(new Set(navKeys.map(k => k.key)).size, navKeys.length, "one chord per command");
});
