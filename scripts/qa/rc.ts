/**
 * `npm run qa:rc -- [--out <folder>] [--upgrade-from <previous.vsix>] [--auto <test repository clone>] [--code <VS Code executable>] [--allow-dirty]`
 *
 * V1-RC (M3): build the release candidate's VSIX once from a clean, pinned source and record its
 * provenance in `<out>/<version>/manifest.json` (format `datapass.rc-manifest`): commit, version,
 * lockfile SHA-256, Node, OS, VS Code, the VSIX's SHA-256. Then, in an isolated profile under the
 * same folder, install the previous release (when given), install the candidate over it and read the
 * version VS Code reports: the installed version must be the one built. With `--auto`, every
 * repository the synthetic client's journeys need is checked with `git ls-remote`: an empty one is a
 * setup blocker for J01–J10, never a pass.
 *
 * Gates it cannot run itself (desktop suites, perf, Codex journeys, the real-screen check) are listed
 * as NOT_RUN with their command: the qualification report fills them from real runs. A candidate is
 * qualified only when every gate is PASS (`rcVerdict`).
 *
 * Exit 0 = every gate this script ran passed; 1 = one failed or is blocked; 2 = cannot start (dirty
 * tree, build failure). It writes only under `--out` (default `out/rc`), never in the person's profile.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cli, EXTENSION_ID, vscodeExecutable } from "./prepare";
import { parseCodexTests, CODEX_TESTS_FILE } from "../../src/qa/formats";

export const RC_MANIFEST_FORMAT = "datapass.rc-manifest";
export type GateStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "HUMAN";
export interface Gate { id: string; title: string; status: GateStatus; detail: string; command?: string }
export interface RcManifest {
  format: typeof RC_MANIFEST_FORMAT; version: 1;
  datapass: { version: string; commit: string; dirty: boolean; vsix: string; sha256: string; bytes: number };
  build: { node: string; npm: string; vsce: string; lockfileSha256: string; os: string; arch: string; builtAt: string };
  vscode?: { executable: string; version: string };
  gates: Gate[];
  verdict: ReturnType<typeof rcVerdict>;
}

/** Qualified only when every gate passed; anything not run, blocked or left to a person keeps it open. */
export function rcVerdict(gates: Gate[]): { qualified: boolean; open: string[] } {
  const open = gates.filter(g => g.status !== "PASS").map(g => `${g.id} ${g.status}`);
  return { qualified: gates.length > 0 && open.length === 0, open };
}

/** The M3 gates this script does not run, with the command that produces their evidence. */
export function externalGates(): Gate[] {
  return [
    { id: "verify", title: "npm run verify (types, unit tests, build)", status: "NOT_RUN", detail: "run on the frozen commit", command: "npm run verify" },
    { id: "desktop-windows", title: "Desktop suite on Windows", status: "NOT_RUN", detail: "CI desktop job or local run", command: "npm run test:desktop" },
    { id: "desktop-ubuntu", title: "Desktop suite on Ubuntu", status: "NOT_RUN", detail: "CI desktop job", command: "xvfb-run -a npm run test:desktop" },
    { id: "perf", title: "Performance harness (5 runs)", status: "NOT_RUN", detail: "budgets in scripts/perf.ts", command: "npm run perf -- --runs=5" },
    { id: "qa-ui", title: "qa:prepare + qa:ui smoke on the packaged VSIX (Playwright, not Codex Computer Use)", status: "NOT_RUN", detail: "CI validate job (ubuntu)", command: "DATAPASS_QA_VSIX=<vsix> npx tsx --test tests/qaPrepare.test.ts tests/qa-ui.smoke.test.ts" },
    { id: "codex-journeys", title: "J01–J10 walked by Codex on the synthetic client", status: "NOT_RUN", detail: "Codex desktop run (qa:prepare --launch); Playwright results never stand in for it" },
    { id: "restricted-mode", title: "Restricted Mode on the installed VSIX", status: "HUMAN", detail: "VS Code opens automated windows trusted; checked on a real screen (handoff/v1/RC_CHECK.md)" },
    { id: "real-screen", title: "Real-screen / sign-in check", status: "HUMAN", detail: "handoff/v1/RC_CHECK.md" }
  ];
}

/** Repositories a journey run needs; `lsRemote` returns the refs a remote has (empty = empty repository). */
export function fixtureGate(auto: string | undefined, lsRemote: (remote: string) => string | undefined): Gate {
  const base = { id: "journey-fixtures", title: "Synthetic client repositories are populated (J01–J10 can run)" };
  if (!auto) return { ...base, status: "NOT_RUN", detail: "pass --auto <clone of the client's auto repository>" };
  const file = path.join(auto, CODEX_TESTS_FILE);
  if (!fs.existsSync(file)) return { ...base, status: "BLOCKED", detail: `no ${CODEX_TESTS_FILE} in ${auto}` };
  let config;
  try { config = parseCodexTests(fs.readFileSync(file), CODEX_TESTS_FILE); } catch (e) { return { ...base, status: "BLOCKED", detail: `${CODEX_TESTS_FILE} is invalid: ${e instanceof Error ? e.message : String(e)}` }; }
  const refs = config.workspaces.flatMap(w => [w.bridge, ...w.repositories]);
  const problems: string[] = [];
  for (const r of refs) {
    const out = lsRemote(r.remote);
    if (out === undefined) problems.push(`${r.remote}: not reachable`);
    else if (!out.trim()) problems.push(`${r.remote}: empty repository`);
  }
  return problems.length
    ? { ...base, status: "BLOCKED", detail: `setup blocker (the client AI has not filled them): ${problems.join("; ")}` }
    : { ...base, status: "PASS", detail: `${refs.length} repositories have commits` };
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function sh(cmd: string, args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 600_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function installedVersion(executable: string, profile: string): string | undefined {
  const list = cli(executable, ["--user-data-dir", path.join(profile, "user"), "--extensions-dir", path.join(profile, "ext"), "--list-extensions", "--show-versions"]);
  return list.split(/\r?\n/).find(l => l.toLowerCase().startsWith(`${EXTENSION_ID}@`))?.split("@")[1];
}

function install(executable: string, profile: string, vsix: string): void {
  cli(executable, ["--user-data-dir", path.join(profile, "user"), "--extensions-dir", path.join(profile, "ext"), "--install-extension", vsix, "--force"]);
}

export async function qualify(opts: { repo: string; out: string; upgradeFrom?: string; auto?: string; code?: string; allowDirty?: boolean; log?: (l: string) => void }): Promise<{ code: 0 | 1 | 2; manifest?: RcManifest; reasons: string[] }> {
  const log = opts.log ?? (l => console.log(l));
  const repo = opts.repo;
  const git = (...a: string[]) => sh("git", a, repo);
  const commit = git("rev-parse", "HEAD").out;
  const dirty = git("status", "--porcelain", "--untracked-files=no").out.length > 0;
  if (dirty && !opts.allowDirty) return { code: 2, reasons: ["the working tree has uncommitted changes: a candidate is built from a committed source (or pass --allow-dirty for a dry run)"] };
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
  const dir = path.resolve(opts.out, pkg.version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  log(`▶ building ${pkg.version} from ${commit.slice(0, 12)}${dirty ? " (dirty)" : ""}`);
  const build = sh("npm", ["run", "build"], repo);
  if (!build.ok) return { code: 2, reasons: [`npm run build failed:\n${build.out.slice(-1500)}`] };
  const vsix = path.join(dir, `datapass-vscode-${pkg.version}.vsix`);
  const pack = sh("npx", ["vsce", "package", "--no-dependencies", "-o", vsix], repo);
  if (!pack.ok || !fs.existsSync(vsix)) return { code: 2, reasons: [`vsce package failed:\n${pack.out.slice(-1500)}`] };
  const hash = sha256(vsix);
  log(`  ✓ ${path.basename(vsix)} sha256 ${hash}`);

  const gates: Gate[] = [{ id: "vsix", title: "VSIX built once from the frozen commit", status: dirty ? "FAIL" : "PASS", detail: `${hash}${dirty ? " (dirty tree: not a candidate)" : ""}` }];
  let vscode: RcManifest["vscode"];
  try {
    const executable = await vscodeExecutable(opts.code);
    vscode = { executable, version: (cli(executable, ["--version"]).split(/\r?\n/)[0] ?? "").trim() };
    if (opts.upgradeFrom) {
      const profile = path.join(dir, "profile-upgrade");
      install(executable, profile, path.resolve(opts.upgradeFrom));
      const before = installedVersion(executable, profile);
      install(executable, profile, vsix);
      const after = installedVersion(executable, profile);
      gates.push({ id: "upgrade", title: "Upgrade over the previous release in one profile", status: before && after === pkg.version && before !== after ? "PASS" : "FAIL", detail: `${before ?? "none"} → ${after ?? "none"}` });
    }
    const clean = path.join(dir, "profile-clean");
    install(executable, clean, vsix);
    const seen = installedVersion(executable, clean);
    gates.push({ id: "installed-version", title: "Clean install reports the built version", status: seen === pkg.version ? "PASS" : "FAIL", detail: `VS Code ${vscode.version} lists ${seen ?? "nothing"}` });
  } catch (e) {
    gates.push({ id: "installed-version", title: "Clean install reports the built version", status: "BLOCKED", detail: e instanceof Error ? e.message.split("\n")[0]! : String(e) });
  }
  gates.push(fixtureGate(opts.auto, remote => { const r = sh("git", ["ls-remote", "--heads", remote], repo); return r.ok ? r.out : undefined; }));
  for (const g of gates) log(`  ${g.status === "PASS" ? "✓" : "✗"} ${g.id}: ${g.status} — ${g.detail}`);

  const all = [...gates, ...externalGates()];
  const manifest: RcManifest = {
    format: RC_MANIFEST_FORMAT, version: 1,
    datapass: { version: pkg.version, commit, dirty, vsix: path.basename(vsix), sha256: hash, bytes: fs.statSync(vsix).size },
    build: {
      node: process.version, npm: sh("npm", ["--version"], repo).out, vsce: sh("npx", ["vsce", "--version"], repo).out,
      lockfileSha256: sha256(path.join(repo, "package-lock.json")), os: `${os.type()} ${os.release()}`, arch: process.arch, builtAt: new Date().toISOString()
    },
    ...(vscode ? { vscode } : {}),
    gates: all,
    verdict: rcVerdict(all)
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  log(`Manifest: ${path.relative(repo, path.join(dir, "manifest.json"))} — ${manifest.verdict.qualified ? "qualified" : `open gates: ${manifest.verdict.open.join(", ")}`}`);
  return { code: gates.every(g => g.status === "PASS" || g.status === "NOT_RUN") ? 0 : 1, manifest, reasons: [] };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  void qualify({ repo: process.cwd(), out: value("out") ?? path.join("out", "rc"), upgradeFrom: value("upgrade-from"), auto: value("auto"), code: value("code"), allowDirty: argv.includes("--allow-dirty") })
    .then(r => { for (const x of r.reasons) console.error(`✗ ${x}`); process.exit(r.code); });
}
