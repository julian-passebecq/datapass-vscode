/**
 * V3-FIX-ICONS: every bundled diagram icon path must be valid SVG path data that stays inside its viewBox.
 * A past minifier glued numbers together ("a0.190.19 0 0.19-0.18", "-0.180.19"), so si:docker drew nothing.
 * No dependency: a small tokenizer and parser following the SVG 1.1 path grammar.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DIAGRAM_ICONS } from "../src/webview/diagramIcons";

type Token = { kind: "cmd"; value: string } | { kind: "num"; value: number; text: string };

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Tokenizes path data. Arc flags are read as single 0/1 characters, as the grammar allows ("a1 1 0 00.5.5"). */
function parsePath(d: string): Array<{ cmd: string; args: Token[] }> {
  const out: Array<{ cmd: string; args: Token[] }> = [];
  let i = 0;
  let current: { cmd: string; args: Token[] } | undefined;
  const skipSeparators = (): void => { while (i < d.length && /[\s,]/.test(d[i]!)) i++; };
  while (true) {
    skipSeparators();
    if (i >= d.length) break;
    const ch = d[i]!;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      current = { cmd: ch, args: [] };
      out.push(current);
      i++;
      continue;
    }
    if (!current) throw new Error(`path data must start with a command, found "${d.slice(i, i + 12)}"`);
    const upper = current.cmd.toUpperCase();
    if (upper === "Z") throw new Error(`number after Z at "${d.slice(i, i + 12)}"`);
    const position = current.args.length % ARITY[upper]!;
    if (upper === "A" && (position === 3 || position === 4)) {
      if (ch !== "0" && ch !== "1") throw new Error(`arc flag must be 0 or 1 in "${current.cmd}", found "${d.slice(i, i + 12)}"`);
      current.args.push({ kind: "num", value: Number(ch), text: ch });
      i++;
      continue;
    }
    const m = NUMBER.exec(d.slice(i));
    if (!m) throw new Error(`invalid character at "${d.slice(i, i + 12)}"`);
    const text = m[0];
    const next = d[i + text.length];
    // svgo (Simple Icons) never writes a leading zero, so ".186.186" is two numbers by design; "0.190.19" is the
    // minifier artifact that inserted a zero and dropped the separator. Reject a leading-zero decimal glued to "."
    if (/^[+-]?0\.\d/.test(text) && next === ".") throw new Error(`number token with two decimal points: "${d.slice(i, i + 16)}"`);
    current.args.push({ kind: "num", value: Number(text), text });
    i += text.length;
  }
  for (const seg of out) {
    const arity = ARITY[seg.cmd.toUpperCase()]!;
    if (arity === 0 ? seg.args.length !== 0 : seg.args.length === 0 || seg.args.length % arity !== 0) {
      throw new Error(`"${seg.cmd}" has ${seg.args.length} arguments, expected a multiple of ${arity}`);
    }
  }
  return out;
}

/** Walks the segment end points and returns their extent (control points may legitimately overshoot). */
function extent(d: string): { minX: number; minY: number; maxX: number; maxY: number } {
  let x = 0, y = 0, sx = 0, sy = 0;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const see = (px: number, py: number): void => {
    box.minX = Math.min(box.minX, px); box.maxX = Math.max(box.maxX, px);
    box.minY = Math.min(box.minY, py); box.maxY = Math.max(box.maxY, py);
  };
  for (const seg of parsePath(d)) {
    const rel = seg.cmd === seg.cmd.toLowerCase();
    const upper = seg.cmd.toUpperCase();
    const n = seg.args.map((t) => (t as { value: number }).value);
    const arity = ARITY[upper]!;
    if (upper === "Z") { x = sx; y = sy; continue; }
    for (let k = 0; k < n.length; k += arity) {
      const a = n.slice(k, k + arity);
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (upper === "H") { x = a[0]! + (rel ? x : 0); see(x, y); continue; }
      if (upper === "V") { y = a[0]! + (rel ? y : 0); see(x, y); continue; }
      if (upper === "A") { x = a[5]! + ox; y = a[6]! + oy; see(x, y); continue; }
      x = a[arity - 2]! + ox; y = a[arity - 1]! + oy;
      see(x, y);
      if (upper === "M" && k === 0) { sx = x; sy = y; }
    }
  }
  return box;
}

test("the path parser accepts svgo-style packed numbers and rejects the minifier artifact", () => {
  assert.doesNotThrow(() => parsePath("M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006z"));
  assert.throws(() => parsePath("M13.98 11.08h2.12a0.190.19 0 0.19-0.18V9.01z"), /two decimal points|arc flag/);
  assert.throws(() => parsePath("M1 1l-0.180.19z"), /two decimal points/);
  assert.throws(() => parsePath("M1 1c0 0.10.080.190.190.19z"), /two decimal points/);
  assert.throws(() => parsePath("M1 1a2 2 0 0 5 3 3"), /arc flag/);
  assert.throws(() => parsePath("M1 1L2"), /expected a multiple of 2/);
});

test("every bundled diagram icon path parses and stays inside its viewBox", () => {
  const failures: string[] = [];
  for (const [id, icon] of Object.entries(DIAGRAM_ICONS)) {
    try {
      const [vx, vy, vw, vh] = icon.vb.split(/\s+/).map(Number) as [number, number, number, number];
      const box = extent(icon.d);
      const slack = 0.5;
      if (box.minX < vx - slack || box.minY < vy - slack || box.maxX > vx + vw + slack || box.maxY > vy + vh + slack) {
        throw new Error(`outside viewBox ${icon.vb}: x ${box.minX.toFixed(2)}..${box.maxX.toFixed(2)}, y ${box.minY.toFixed(2)}..${box.maxY.toFixed(2)}`);
      }
    } catch (e) {
      failures.push(`${id}: ${(e as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});
