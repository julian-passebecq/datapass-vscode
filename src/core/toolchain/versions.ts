/**
 * Version ranges of a project's toolchain (manifest v5) and the version a probe saw. Pure.
 *
 * A range is a small, explicit grammar that covers what projects write for CLIs, VS Code
 * extensions and Python libraries (npm and pip habits both appear):
 *
 *   >=1.0   >1.2.3   <=2   <2.0   =1.4   ==1.4.2   !=1.5.0   1.x   1.2.*   *
 *   ^1.2 (same major; ^0.3 stays below 0.4)   ~1.2 (same minor)   ~=1.4.2 (pip: >=1.4.2, ==1.4.*)
 *   comparators joined by spaces or commas are all required: ">=1.0 <2.0", ">=0.1.20,<1"
 *   alternatives: "^1.4 || ^2.0"
 *
 * A bare version (1.4, ==1.4) means that release line: 1.4 accepts 1.4.0 and 1.4.9, not 1.5.0.
 * Pre-release tags are not part of the grammar. An observed version is the first dotted number
 * found in a tool's version output ("git version 2.46.0.windows.1" → 2.46.0).
 */

export type Version = readonly number[];

type Comparator = { op: ">=" | ">" | "<=" | "<" | "==" | "!="; v: Version } | { op: "any" };
/** Alternatives (OR) of comparator sets (AND). */
export interface VersionRange { text: string; sets: Comparator[][] }

export const MAX_RANGE_LENGTH = 80;
const PART = /^(?:0|[1-9]\d{0,5})$/;
const WILD = /^[xX*]$/;

/** The first dotted number in a version output, at most four parts ("v1.2.3", "Python 3.12.1"). */
export function extractVersion(output: string | undefined): Version | undefined {
  if (!output) return undefined;
  const m = /(?:^|[^\d.])v?(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?/.exec(output.slice(0, 4000));
  if (!m) return undefined;
  return m.slice(1).filter((p): p is string => p !== undefined).map(Number);
}

export const versionText = (v: Version) => v.join(".");

/**
 * The version a CLI printed: its first dotted number ("Databricks CLI v0.230.0" → 0.230.0), else its
 * first meaningful line (`az version` prints JSON, whose first line is "{").
 */
export function cliVersion(output: string | undefined): string | undefined {
  const v = extractVersion(output);
  if (v) return versionText(v);
  return output?.split(/\r?\n/).map(l => l.trim()).find(l => /[A-Za-z0-9]/.test(l))?.slice(0, 80);
}


function compare(a: Version, b: Version): number {
  for (let i = 0; i < Math.max(a.length, b.length, 3); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Parse "1", "1.2", "1.2.3", "1.x", "1.2.*": the fixed parts, and whether a wildcard ended it. */
function parsePartial(text: string): { parts: number[]; wild: boolean } | undefined {
  const raw = text.split(".");
  if (!raw.length || raw.length > 4) return undefined;
  const parts: number[] = [];
  let wild = false;
  for (const p of raw) {
    if (WILD.test(p)) { wild = true; continue; }
    if (wild || !PART.test(p)) return undefined;   // nothing may follow a wildcard
    parts.push(Number(p));
  }
  return parts.length || wild ? { parts, wild } : undefined;
}

/** Next release line after the first `keep` parts: [1,2,3] keep 2 → [1,3]. */
const bump = (parts: readonly number[], keep: number): Version => [...parts.slice(0, keep - 1), (parts[keep - 1] ?? 0) + 1];

/** All releases of the line the fixed parts name ("1.2" → >=1.2.0 <1.3.0; "1.2.3" → exactly 1.2.3). */
function line(parts: number[]): Comparator[] {
  if (!parts.length) return [{ op: "any" }];
  if (parts.length >= 3) return [{ op: ">=", v: parts }, { op: "<", v: [...parts.slice(0, -1), parts[parts.length - 1]! + 1] }];
  return [{ op: ">=", v: parts }, { op: "<", v: bump(parts, parts.length) }];
}

function comparator(token: string): Comparator[] | undefined {
  const m = /^(>=|<=|>|<|==|=|!=|\^|~=|~)?(.+)$/.exec(token);
  if (!m) return undefined;
  const op = m[1] ?? "";
  const partial = parsePartial(m[2]!);
  if (!partial) return undefined;
  const { parts, wild } = partial;
  switch (op) {
    case "":
    case "=":
    case "==":
      return line(parts);
    case "!=":
      if (wild || !parts.length) return undefined;
      return [{ op: "!=", v: parts }];
    case ">=": case ">": case "<=": case "<":
      if (wild || !parts.length) return undefined;
      return [{ op, v: parts }];
    case "^": {
      if (wild || !parts.length) return undefined;
      // Same leftmost non-zero part: ^1.2 → <2, ^0.3 → <0.4, ^0.0.3 → <0.0.4.
      const lead = parts.findIndex(p => p !== 0);
      const keep = lead === -1 ? parts.length : lead + 1;
      return [{ op: ">=", v: parts }, { op: "<", v: bump(parts, keep) }];
    }
    case "~":
      if (wild || !parts.length) return undefined;
      return [{ op: ">=", v: parts }, { op: "<", v: bump(parts, Math.min(parts.length, 2)) }];
    case "~=":
      // pip's compatible release needs at least two parts: ~=1.4 → >=1.4 <2; ~=1.4.2 → >=1.4.2 <1.5.
      if (wild || parts.length < 2) return undefined;
      return [{ op: ">=", v: parts }, { op: "<", v: bump(parts, parts.length - 1) }];
    default:
      return undefined;
  }
}

/** Parse a range, or say why it is not one (the message never repeats the text). */
export function parseRange(text: unknown): VersionRange | { error: string } {
  if (typeof text !== "string" || !text.trim()) return { error: "must be a non-empty version range" };
  if (text.length > MAX_RANGE_LENGTH) return { error: `must be at most ${MAX_RANGE_LENGTH} characters` };
  if (!/^[0-9xX*.,<>=!^~|\s]+$/.test(text)) return { error: "may only use digits, dots, x or *, the operators >= > <= < = == != ^ ~ ~=, spaces, commas and ||" };
  const sets: Comparator[][] = [];
  for (const alt of text.split("||")) {
    // "> = 1.0" is not ">=1.0": operators must touch their version.
    const tokens = alt.trim().split(/[\s,]+/).filter(Boolean);
    if (!tokens.length) return { error: "has an empty alternative around ||" };
    const set: Comparator[] = [];
    for (const t of tokens) {
      const c = comparator(t);
      if (!c) return { error: "is not a version range (examples: >=1.0, ^2.3, ~1.4, 1.x, >=1.0 <2.0)" };
      set.push(...c);
    }
    sets.push(set);
  }
  return { text: text.trim(), sets };
}

export const isRangeError = (r: VersionRange | { error: string }): r is { error: string } => "error" in r;

export function satisfies(v: Version, range: VersionRange): boolean {
  return range.sets.some(set => set.every(c => {
    if (c.op === "any") return true;
    const d = compare(v, c.v);
    switch (c.op) {
      case ">=": return d >= 0;
      case ">": return d > 0;
      case "<=": return d <= 0;
      case "<": return d < 0;
      case "==": return d === 0;
      case "!=": return d !== 0;
    }
  }));
}
