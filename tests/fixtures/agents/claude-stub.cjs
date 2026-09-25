// Stub Claude Code for the 0.20 desktop tests (datapass.ai.claude.path points here; VS Code runs it
// with its own Node in a terminal). It does what rule 1 to 6 of a work order ask, offline:
//   - reads the order from the marker line (the last argument), as a real agent would;
//   - for each repository to change: a worktree from origin/<base> on the planned branch, one commit,
//     a push to the (local) remote, and a pull request added to the stub gh's answers;
//   - writes proposed/<kind>.json for each file the order expects "via import";
//   - writes result.json with the order's id and receipt.
// claude-stub.cjs.json chooses a mode: "good", "no-pr" (a result naming no PR, no PR created),
// "wrong-receipt" (a result for another revision) or "silent" (nothing at all). Every call is logged
// to claude-stub.cjs.log, so a test can check the arguments DataPass passed.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
fs.appendFileSync(__filename + ".log", JSON.stringify({ args, cwd: process.cwd(), order: process.env.DATAPASS_WORK_ORDER || null }) + "\n");
const config = JSON.parse(fs.readFileSync(__filename + ".json", "utf8"));
const mode = config.mode || "good";
const marker = /DataPass work order (wo-\d{8}-\d{4}-[0-9a-z]{4}): read (.+order\.md) and follow it\./.exec(args[args.length - 1] || "");
if (!marker || mode === "silent") { process.stdout.write("claude stub: nothing to do\n"); setTimeout(() => process.exit(0), 200); return; }

const folder = path.dirname(marker[2]);
const order = JSON.parse(fs.readFileSync(path.join(folder, "order.json"), "utf8"));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const repos = [];
for (const r of order.repositories.filter(x => x.access === "change")) {
  const wt = path.join(r.localPath, ".claude", "worktrees", order.id);
  git(r.localPath, "fetch", "-q", "origin", r.base.branch);
  git(r.localPath, "worktree", "add", "-q", "-b", r.branch, wt, `origin/${r.base.branch}`);
  const board = path.join(wt, ".datapass", "board.json");
  if (fs.existsSync(board) && order.expected.boardMoves.length) {
    const doc = JSON.parse(fs.readFileSync(board, "utf8"));
    for (const m of order.expected.boardMoves) for (const it of doc.items) if (it.id === m.card) it.status = m.to;
    fs.writeFileSync(board, JSON.stringify(doc, null, 2) + "\n");
  } else {
    fs.writeFileSync(path.join(wt, `work-${order.id}.md`), `Work for ${order.title}\n`);
  }
  git(wt, "add", "-A");
  git(wt, "-c", "user.name=Stub Agent", "-c", "user.email=stub@example.invalid", "commit", "-q", "-m", `${order.title} (${order.id})`);
  git(wt, "push", "-q", "-u", "origin", r.branch);
  const sha = git(wt, "rev-parse", "--short", "HEAD");
  let pullRequest;
  if (mode !== "no-pr" && config.ghStub && r.remote) {
    const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(r.remote);
    if (m) {
      const data = JSON.parse(fs.readFileSync(config.ghStub + ".json", "utf8"));
      const key = `${m[1]}/${m[2]}`;
      data.repos = data.repos || {};
      data.repos[key] = data.repos[key] || { open: [], closed: [] };
      const number = 100 + data.repos[key].open.length + data.repos[key].closed.length;
      data.repos[key].open.push({ number, title: order.title, headRefName: r.branch, isDraft: false, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "CLEAN", updatedAt: new Date().toISOString(),
        statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }] });
      fs.writeFileSync(config.ghStub + ".json", JSON.stringify(data, null, 2));
      pullRequest = `https://github.com/${key}/pull/${number}`;
    }
  }
  repos.push({ ref: r.ref, branch: r.branch, commits: [sha], ...(pullRequest ? { pullRequest } : {}) });
}
for (const f of order.expected.datapassFiles.filter(x => x.via === "import")) {
  fs.mkdirSync(path.join(folder, "proposed"), { recursive: true });
  const doc = f.kind === "sheet"
    ? { format: "datapass.sheet", version: "1", summary: "Volumes proposed by the stub agent.", datasets: [{ id: "pdfs", label: "Research PDFs" }] }
    : { note: "unsupported kind in the stub" };
  fs.writeFileSync(path.join(folder, "proposed", `${f.kind}.json`), JSON.stringify(doc, null, 2) + "\n");
}
const result = {
  format: "datapass.work-order-result", version: "1", orderId: order.id,
  receipt: mode === "wrong-receipt" ? "ZZZZ-ZZZZ" : order.receipt,
  status: "done",
  summary: `Stub agent: ${repos.length} repositor${repos.length === 1 ? "y" : "ies"} changed.`,
  repositories: repos,
  checks: [{ what: "stub check", outcome: "passed", note: "1 passed" }],
  questions: ["Is the stub enough?"],
  followUps: [{ title: "Do the real thing", why: "The stub only proves the loop." }],
  agent: { tool: "claude-code", model: "stub" },
  finishedAt: new Date().toISOString()
};
fs.writeFileSync(order.result.path, JSON.stringify(result, null, 2) + "\n");
process.stdout.write("DataPass result written\n");
setTimeout(() => process.exit(0), 200);
