// Stub GitHub CLI for the 0.19 desktop tests (datapass.git.ghPath points here; VS Code runs it with
// its own Node). It answers `gh auth status` and `gh pr list` from gh-stub.cjs.json, logs every call
// to gh-stub.cjs.log, and refuses anything else, so a test can prove DataPass only reads.
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(__filename + ".log", JSON.stringify(args) + "\n");
const data = JSON.parse(fs.readFileSync(__filename + ".json", "utf8"));
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args[0] === "auth" && args[1] === "status") process.exit(data.signedIn ? 0 : 1);
if (args[0] === "pr" && args[1] === "list") {
  const rows = ((data.repos || {})[opt("--repo")] || {})[opt("--state")] || [];
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
// 0.20: `gh repo view owner/repo --json visibility --jq .visibility` (the private work-log check), only when the JSON names it.
if (args[0] === "repo" && args[1] === "view" && data.visibility && data.visibility[args[2]]) {
  process.stdout.write(data.visibility[args[2]] + "\n");
  process.exit(0);
}
process.stderr.write("gh stub: unsupported command " + args.join(" ") + "\n");
process.exit(2);
