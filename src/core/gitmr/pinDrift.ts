/**
 * STUB until REPIN8 (PM 30 ruling B4): port of the PURE PINDRIFT1 logic (Common !231 tools/pin-drift); REPIN8 swaps it for
 * the vendored project-contracts `pin-drift` subpath (V5FREEZE2). Git input only through gitReadOnly (TL-4), never execFileSync.
 *
 * V5 GITMR3: Common pin drift (AC-V2). A consumer repository pins each vendored Common package by version + tarball
 * digest + source commit (`vendor/common/manifest.json`, `datapass.vendored-common/1`, and the repo-set `pins`). This
 * compares the pins with Common main from the LOCAL Common clone (no fetch, no remote call), with the statuses and the
 * report shape of PINDRIFT1 (`datapass.pin-drift-report/1`):
 *   ok              same version, shipped package sources unchanged since the pinned commit
 *   behind          Common main has a higher version than the pin
 *   digest-mismatch same version, but shipped package sources changed since the pinned commit
 *   unknown         not a Common package, pin commit absent from the clone, no version, or pin ahead of main
 * PINDRIFT1 reads blobs (`ls-tree`, `cat-file`); GITMR3 must stay inside the TL-4 read-only allow-list, so the same
 * question is answered with `rev-parse` and `diff` between the pinned commit and main. The classifier is pure.
 */
import type { GitRunner } from "../workspace/gitBase";
import { readOnlyGit } from "./readOnly";
import { PIN_DRIFT_REPORT_SCHEMA, PIN_STATUSES, type PinDriftReport, type PinDriftRow, type PinStatus, type RepoSetLike } from "./stubs";

export const VENDOR_MANIFEST_PATH = "vendor/common/manifest.json";
const VENDOR_SCHEMA = "datapass.vendored-common/1";
const SCOPE = "@juliandatapass-group/";
const TARBALL = /^juliandatapass-group-(.+)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/;
/** Files that never reach the packed tarball do not count as drift (same rule as PINDRIFT1). */
const NOT_SHIPPED = /(^|\/)(tests?|__tests__|fixtures|node_modules|dist)\//;
const SHA = /^[0-9a-f]{7,40}$/;
const TIMEOUT_MS = 15_000;

/** One vendored copy in one consumer repository. */
export interface Pin { readonly repo: string; readonly name: string; readonly version: string | null; readonly sha256: string | null; readonly sourceCommit: string | null }

/** Pins of a `datapass.vendored-common/1` manifest (name and version from the tarball name when not explicit). */
export function parseVendorManifest(raw: unknown, repo: string): { pins: Pin[]; error?: string } {
  const m = raw as { schema?: unknown; sourceCommit?: unknown; artifacts?: unknown } | null;
  if (!m || typeof m !== "object" || m.schema !== VENDOR_SCHEMA) return { pins: [], error: `not a ${VENDOR_SCHEMA} manifest` };
  const pins: Pin[] = [];
  for (const a of Array.isArray(m.artifacts) ? m.artifacts as Record<string, unknown>[] : []) {
    const t = TARBALL.exec(typeof a.file === "string" ? a.file : "");
    const name = typeof a.name === "string" ? a.name : t ? SCOPE + t[1] : undefined;
    if (!name) continue;
    const commit = typeof a.sourceCommit === "string" ? a.sourceCommit : typeof m.sourceCommit === "string" ? m.sourceCommit : null;
    pins.push({ repo, name, version: typeof a.version === "string" ? a.version : t?.[2] ?? null, sha256: typeof a.sha256 === "string" ? a.sha256 : null, sourceCommit: commit && SHA.test(commit) ? commit : null });
  }
  return { pins };
}

/** Pins declared in the repo set (GITSPI1 `pins`). */
export function pinsFromRepoSet(set: Pick<RepoSetLike, "pins">): Pin[] {
  return set.pins.map(p => ({ repo: p.repo, name: p.package, version: p.version, sha256: p.digest?.replace(/^sha256:/i, "") ?? null, sourceCommit: SHA.test(p.pinnedSha) ? p.pinnedSha : null }));
}

/** Manifest pins win over a repo-set pin of the same repo + package (the manifest is what is vendored). */
export function mergePins(...lists: readonly (readonly Pin[])[]): Pin[] {
  const out = new Map<string, Pin>();
  for (const list of lists) for (const p of list) if (!out.has(`${p.repo}\0${p.name}`)) out.set(`${p.repo}\0${p.name}`, p);
  return [...out.values()];
}

/** Semver precedence, prerelease aware (port of PINDRIFT1 `compareVersions`). */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): [number[], string[]] => { const [core = "", ...pre] = v.split("-"); return [core.split(".").map(Number), pre.length ? pre.join("-").split(".") : []]; };
  const [ac, ap] = split(a), [bc, bp] = split(b);
  for (let i = 0; i < 3; i++) if ((ac[i] ?? 0) !== (bc[i] ?? 0)) return (ac[i] ?? 0) - (bc[i] ?? 0);
  if (!ap.length || !bp.length) return bp.length - ap.length;
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i], y = bp[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** What changed under `packages/` between one pinned commit and the Common ref. */
export interface CommitDelta {
  /** Package dirs whose shipped files changed. */
  readonly changed: readonly string[];
  /** Package dirs whose package.json was removed. */
  readonly removed: readonly string[];
  /** Version at the ref, for package dirs whose `version` line changed. */
  readonly versionAtRef: Readonly<Record<string, string>>;
}
export interface CommonFacts {
  readonly ref: string;
  readonly commit: string | null;
  /** Package name → `packages/<dir>`. */
  readonly dirOf: Readonly<Record<string, string>>;
  /** Pinned commit → delta, or null when the commit is not in the clone. */
  readonly bySha: Readonly<Record<string, CommitDelta | null>>;
}

/** Pure classifier: pins + facts → one PINDRIFT1-shaped report. */
export function classifyPins(pins: readonly Pin[], facts: CommonFacts): PinDriftReport {
  const packages: PinDriftRow[] = pins.map(pin => {
    const base = { name: pin.name, pinned: pin.version ?? "?", sha256: pin.sha256, sourceCommit: pin.sourceCommit };
    const unknown = (reason: string, common: string | null = null): PinDriftRow => ({ ...base, common, status: "unknown", reason });
    const dir = facts.dirOf[pin.name];
    if (!dir) return unknown(`not a Common package at ${facts.ref}`);
    if (!pin.version) return unknown("the pin names no version");
    if (!pin.sourceCommit) return unknown("the pin names no source commit to compare package sources");
    const delta = facts.bySha[pin.sourceCommit];
    if (!delta) return unknown(`source commit ${pin.sourceCommit.slice(0, 9)} is not in the local Common clone`);
    if (delta.removed.includes(dir)) return unknown(`not a Common package at ${facts.ref}`);
    const now = delta.versionAtRef[dir] ?? pin.version;
    const order = compareVersions(now, pin.version);
    const row = { ...base, common: now };
    if (order > 0) return { ...row, status: "behind", reason: `Common ${facts.ref} has ${now}` };
    if (order < 0) return { ...row, status: "unknown", reason: `pin ${pin.version} is ahead of Common ${facts.ref}` };
    if (delta.changed.includes(dir)) return { ...row, status: "digest-mismatch", reason: `sources changed since ${pin.sourceCommit.slice(0, 9)} under unchanged version ${pin.version} (bump + re-pin)` };
    return { ...row, status: "ok", reason: "same version, sources unchanged" };
  });
  const counts = Object.fromEntries(PIN_STATUSES.map(s => [s, packages.filter(p => p.status === s).length])) as Record<PinStatus, number>;
  return { schema: PIN_DRIFT_REPORT_SCHEMA, ref: facts.ref, commit: facts.commit, drift: counts.behind + counts["digest-mismatch"] > 0, counts, packages };
}

export function formatPinDriftText(report: PinDriftReport, repo?: string): string {
  const width = Math.max(4, ...report.packages.map(p => p.name.length));
  const summary = PIN_STATUSES.map(s => `${s} ${report.counts[s]}`).join(", ");
  const head = `${repo ? `${repo}: ` : ""}Common pin drift vs ${report.ref}${report.commit ? ` (${report.commit.slice(0, 9)})` : ""}: ${summary}`;
  return [head, ...report.packages.map(p => `  ${p.status.padEnd(15)} ${p.name.padEnd(width)} ${p.pinned.padEnd(16)} ${p.reason}`)].join("\n");
}

// ---------------------------------------------------------------- git side (local clone, read-only)

/** `diff --name-status` + `diff -U0` of package.json files → per-package delta. */
export function parseCommitDelta(nameStatus: string, packageJsonDiff: string): CommitDelta {
  const changed = new Set<string>(), removed = new Set<string>(), versionAtRef: Record<string, string> = {};
  for (const line of nameStatus.split(/\r?\n/)) {
    const cols = line.split("\t");
    const status = cols[0] ?? "";
    for (const path of cols.slice(1)) {
      const m = /^packages\/([^/]+)\/(.+)$/.exec(path);
      if (!m || NOT_SHIPPED.test(m[2]!)) continue;
      changed.add(m[1]!);
      if (m[2] === "package.json" && status.startsWith("D") && path === cols[1]) removed.add(m[1]!);
    }
  }
  let dir: string | undefined;
  for (const line of packageJsonDiff.split(/\r?\n/)) {
    const file = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (file) { dir = /^packages\/([^/]+)\/package\.json$/.exec(file[1]!)?.[1]; continue; }
    const v = /^\+\s*"version"\s*:\s*"([^"]+)"/.exec(line);
    if (dir && v) versionAtRef[dir] = v[1]!;
  }
  return { changed: [...changed].sort(), removed: [...removed].sort(), versionAtRef };
}

/** Package name → dir from `packages/<dir>/package.json` contents of the clone; unread names fall back to the tarball convention. */
export function packageDirs(manifests: readonly { dir: string; json: string }[], names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { dir, json } of manifests) {
    try { const n = (JSON.parse(json) as { name?: unknown }).name; if (typeof n === "string" && n.startsWith(SCOPE)) out[n] = dir; } catch { /* unreadable: skipped */ }
  }
  const dirs = new Set(manifests.map(m => m.dir));
  for (const n of names) if (!out[n] && n.startsWith(SCOPE) && dirs.has(n.slice(SCOPE.length))) out[n] = n.slice(SCOPE.length);
  return out;
}

/** Common main in the clone: the remote-tracking branch if the clone has one, else the local branch. No fetch. */
export async function resolveCommonMain(git: GitRunner, commonDir: string, defaultBranch: string | null): Promise<{ ref: string; commit: string } | null> {
  const branch = defaultBranch && /^[A-Za-z0-9._/-]{1,200}$/.test(defaultBranch) ? defaultBranch : "main";
  const ro = readOnlyGit(git);
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const r = await ro(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], commonDir, TIMEOUT_MS);
    const sha = r.stdout.trim();
    if (r.ok && /^[0-9a-f]{40}$/.test(sha)) return { ref: ref.replace(/^refs\/(remotes\/|heads\/)/, ""), commit: sha };
  }
  return null;
}

/** Facts for the classifier, from the local Common clone through the read-only wrapper. */
export async function readCommonFacts(git: GitRunner, commonDir: string, main: { ref: string; commit: string }, pins: readonly Pin[], dirOf: Record<string, string>): Promise<CommonFacts> {
  const ro = readOnlyGit(git);
  const bySha: Record<string, CommitDelta | null> = {};
  for (const sha of new Set(pins.map(p => p.sourceCommit).filter((s): s is string => !!s))) {
    const ok = await ro(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], commonDir, TIMEOUT_MS);
    if (!ok.ok) { bySha[sha] = null; continue; }
    const names = await ro(["diff", "--no-ext-diff", "--name-status", "--no-renames", sha, main.commit, "--", "packages"], commonDir, TIMEOUT_MS);
    const versions = await ro(["diff", "--no-ext-diff", "-U0", "--no-renames", sha, main.commit, "--", "packages/*/package.json"], commonDir, TIMEOUT_MS);
    bySha[sha] = names.ok && versions.ok ? parseCommitDelta(names.stdout, versions.stdout) : null;
  }
  return { ref: main.ref, commit: main.commit, dirOf, bySha };
}
