import assert from "node:assert/strict";
import test from "node:test";
import { buildFileContext, capSiblings, locateFile, owningComponents, parentChain, relativeInside, type ComponentPlace, type FileContextInput } from "../src/core/exchange/fileContext";

// Synthetic, non-FOIL layout: a bridge repository and two native repositories next to it.
const HUB = "D:\\work\\sales-hub";
const PIPE = "D:\\work\\sales-pipeline";
const PIPE_WT = "D:\\work\\worktrees\\sales-pipeline-fix";
const candidates = [
  { key: ".", folder: HUB },
  { key: "pipeline", folder: PIPE, remoteUrl: "https://github.com/example-org/sales-pipeline.git" },
  { key: "infra", remoteUrl: "git@github.com:example-org/sales-infra.git" }
];
const places: ComponentPlace[] = [
  { id: "extract", label: "Extract function", kind: "compute", provider: "azure-functions", repoKey: "pipeline", root: "functions/extract", files: [{ repoPath: "functions/extract/function_app.py", role: "entry" }], scopes: ["Sales ingestion"] },
  { id: "pipeline-all", label: "Whole pipeline", repoKey: "pipeline", root: ".", scopes: [] },
  { id: "adf", label: "Data Factory", repoKey: "pipeline", root: "adf", scopes: ["Sales ingestion"] }
];

function base(over: Partial<FileContextInput> = {}): FileContextInput {
  return {
    project: { id: "sales", title: "Sales BI" },
    bridge: { key: ".", label: "Sales hub" },
    repository: { kind: "declared", key: "pipeline", label: "Sales pipeline", bridge: false, remote: "github.com/example-org/sales-pipeline", otherClone: false, git: { branch: "main", head: "0123456789abcdef0123", fileState: "clean", changes: 0 } },
    file: { relPath: "functions/extract/function_app.py", languageId: "python", text: "import os\n\ndef main():\n    return 1\n" },
    components: owningComponents("pipeline", "functions/extract/function_app.py", places),
    revisions: [{ key: "pipeline", label: "Sales pipeline", state: "local", branch: "main", head: "0123456789abcdef" }, { key: ".", label: "Sales hub", state: "local", branch: "main", head: "fedcba9876543210", bridge: true }],
    tree: { parents: parentChain("functions/extract/function_app.py"), ...capSiblings([{ name: "function_app.py", dir: false }, { name: "tests", dir: true }, { name: "host.json", dir: false }], "function_app.py") },
    diagnostics: [{ severity: "warning", line: 1, message: "\"os\" is not accessed", source: "Pylance" }, { severity: "error", line: 4, message: "Expected expression", source: "Pylance" }],
    localPaths: [HUB, PIPE, "C:\\Users\\someone"],
    ...over
  };
}

const noAbsolutePath = (text: string) => {
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]/, "no drive-letter path");
  assert.doesNotMatch(text, /\/(home|Users)\//, "no home path");
  for (const p of [HUB, PIPE, PIPE_WT, "sales-hub\\", "worktrees"]) assert.ok(!text.includes(p), `leaked ${p}`);
};

test("file inside a component: repository, component, scope, revisions, tree, text, diagnostics, rules", () => {
  const loc = locateFile(`${PIPE}\\functions\\extract\\function_app.py`, candidates, { top: PIPE, origin: "https://github.com/example-org/sales-pipeline" }, HUB, true);
  assert.deepEqual(loc, { kind: "declared", key: "pipeline", root: PIPE, relPath: "functions/extract/function_app.py", via: "folder", otherClone: false });
  const pack = buildFileContext(base({ question: "Why does the extract fail on dev?" }));
  const t = pack.text;
  assert.match(t, /^# DataPass file context: functions\/extract\/function_app\.py/);
  assert.match(t, /## Question\nWhy does the extract fail on dev\?/);
  assert.match(t, /Sales pipeline \(`pipeline`\), a native repository declared by the bridge · remote github\.com\/example-org\/sales-pipeline/);
  assert.match(t, /Git: branch main · HEAD 0123456789ab · this file: unchanged since HEAD · working tree clean/);
  assert.match(t, /Component: Extract function \(`extract`, compute, azure-functions\) — files in `functions\/extract\/`; this file is its declared entry file/);
  assert.ok(!t.includes("Whole pipeline"), "the deepest component root wins");
  assert.match(t, /Scope: Sales ingestion/);
  assert.match(t, /Sales hub \(`\.`, bridge\): local · main @ fedcba987654/);
  assert.match(t, /  functions\/\n    extract\/\n      tests\/\n      function_app\.py   ← this file\n      host\.json/);
  assert.match(t, /```python\nimport os\n\ndef main\(\):\n    return 1\n```/);
  assert.match(t, /- error line 4 \[Pylance\]: Expected expression\n- warning line 1/);
  assert.match(t, /pull request in \*\*Sales pipeline\*\*/);
  assert.match(t, /\*\*separate\*\* pull request in the bridge repository \*\*Sales hub\*\*.*coordinated change set/);
  assert.equal(pack.contentTruncated, false);
  assert.equal(pack.truncated, false);
  noAbsolutePath(t);
});

test("file in a declared repository but in no component", () => {
  const rel = "scripts/tool.sh";
  assert.deepEqual(owningComponents("pipeline", rel, places.filter(p => p.root !== ".")), []);
  const pack = buildFileContext(base({ file: { relPath: rel, text: "echo hi\n" }, components: [], revisions: [] }));
  assert.match(pack.text, /Component: none — the bridge declares this repository, but no component's files include this path\./);
  assert.ok(!pack.sections.includes("Repositories the component uses (revisions)"));
});

test("file outside every declared repository: its own Git root, tree, and 'not in the bridge'", () => {
  const other = "D:\\play\\scratch\\notes\\todo.md";
  const loc = locateFile(other, candidates, { top: "D:/play/scratch", origin: "https://github.com/someone/scratch" }, HUB, true);
  assert.deepEqual(loc, { kind: "undeclared", root: "D:/play/scratch", relPath: "notes/todo.md", isGitRepo: true });
  const noGit = locateFile(other, candidates, undefined, undefined, true);
  assert.equal(noGit.kind, "undeclared");
  assert.equal(noGit.relPath, "todo.md");
  const pack = buildFileContext(base({
    project: undefined, bridge: undefined,
    repository: { kind: "undeclared", name: "scratch", remote: "github.com/someone/scratch", git: { branch: "main", head: "abc", fileState: "untracked" } },
    file: { relPath: "notes/todo.md", languageId: "markdown", text: "- [ ] thing\n" }, components: [], revisions: [],
    tree: { parents: ["notes"], siblings: [{ name: "todo.md", dir: false }], moreSiblings: 0 }, diagnostics: [], localPaths: ["D:\\play\\scratch"]
  }));
  assert.match(pack.text, /No DataPass project is open/);
  assert.match(pack.text, /scratch: \*\*not in the bridge\*\* — no DataPass project declares this repository \(remote github\.com\/someone\/scratch\)/);
  assert.match(pack.text, /this file: untracked/);
  assert.match(pack.text, /  notes\/\n    todo\.md   ← this file/);
  assert.match(pack.text, /DataPass knows nothing about this file's place in an architecture/);
  assert.match(pack.text, /- none reported/);
  noAbsolutePath(pack.text);
});

test("unsaved buffer: the editor's text is used and flagged; an untitled buffer is 'not on disk'", () => {
  const dirty = buildFileContext(base({ file: { relPath: "functions/extract/function_app.py", languageId: "python", unsaved: true, text: "print('edited')\n" } }));
  assert.match(dirty.text, /\*\*Unsaved changes\*\*: the text below is the editor's/);
  assert.match(dirty.text, /print\('edited'\)/);
  const untitled = buildFileContext(base({ repository: { kind: "undeclared", name: "(no folder)", git: { unread: "not saved to disk" } }, components: [], revisions: [], file: { relPath: "(untitled) Untitled-1", notOnDisk: true, text: "draft" } }));
  assert.match(untitled.text, /\*\*Not on disk\*\*/);
  assert.match(untitled.text, /Git: not read \(not saved to disk\)/);
});

test("selection: only the selected lines, labelled with their range", () => {
  const pack = buildFileContext(base({ file: { relPath: "functions/extract/function_app.py", languageId: "python", text: "import os\n\ndef main():\n    return 1\n", selection: { startLine: 3, endLine: 4, text: "def main():\n    return 1" } } }));
  assert.ok(pack.sections.includes("Selection (lines 3–4)"));
  assert.ok(!pack.sections.includes("File content"));
  assert.ok(!pack.text.includes("import os"));
  assert.match(pack.text, /```python\ndef main\(\):\n    return 1\n```/);
});

test("oversize file: cut on a line boundary within the budget, truncation labelled; binary content omitted", () => {
  const big = Array.from({ length: 5000 }, (_v, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
  const pack = buildFileContext(base({ file: { relPath: "adf/big.json", text: big } }), { maxContentBytes: 4000 });
  assert.equal(pack.contentTruncated, true);
  assert.equal(pack.truncated, false);
  assert.match(pack.text, /\[DataPass: truncated — showing the first \d+ of \d+ bytes \(budget 4000\)\./);
  const shown = /```\n([\s\S]*?)\n```\n\[DataPass: truncated/.exec(pack.text)![1]!;
  assert.ok(Buffer.byteLength(shown) <= 4000);
  assert.match(shown, /x$/, "ends on a whole line");
  assert.ok(pack.bytes < 10_000);
  const bin = buildFileContext(base({ file: { relPath: "img.png", binary: true } }));
  assert.match(bin.text, /\(binary file: content not included\)/);
  // Even a tiny total budget keeps the pack bounded and says so.
  const tiny = buildFileContext(base({ file: { relPath: "adf/big.json", text: big } }), { maxBytes: 3000, maxContentBytes: 100_000 });
  assert.ok(tiny.bytes <= 3000);
  assert.equal(tiny.truncated, true);
  assert.match(tiny.text, /pack truncated/);
});

test("a secret in the file is scrubbed, and so are local paths inside the text", () => {
  const text = [
    "API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
    "conn = \"mongodb+srv://admin:hunter2@cluster0.example.net/db\"",
    "{\"client_secret\": \"s3cr3t-value\"}",
    "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    `data = open(r"${PIPE}\\data\\raw.csv")`,
    "log = '/home/someone/app.log'"
  ].join("\n");
  const pack = buildFileContext(base({ file: { relPath: "functions/extract/settings.py", text }, question: `see ${PIPE}\\README.md` }));
  for (const s of ["sk-abcdefghijklmnop", "hunter2", "s3cr3t-value", "ghp_abcdefghij", "/home/someone"]) assert.ok(!pack.text.includes(s), `leaked ${s}`);
  assert.match(pack.text, /<connection-string>/);
  assert.match(pack.text, /<redacted>|<token>/);
  assert.match(pack.text, /<local-path>/);
  noAbsolutePath(pack.text);
});

test("no absolute local path anywhere, even with forward slashes or another case", () => {
  const pack = buildFileContext(base({ file: { relPath: "functions/extract/function_app.py", text: `a = "d:/WORK/sales-pipeline/x"\nb = "D:\\work\\sales-hub\\y"\n` } }));
  noAbsolutePath(pack.text);
});

test("two worktrees of the same remote: the one that holds the file wins", () => {
  const file = `${PIPE_WT}\\adf\\pipeline\\copy.json`;
  const loc = locateFile(file, candidates, { top: PIPE_WT.replace(/\\/g, "/"), origin: "git@github.com:example-org/sales-pipeline.git" }, HUB, true);
  assert.equal(loc.kind, "declared");
  if (loc.kind !== "declared") return;
  assert.equal(loc.key, "pipeline");
  assert.equal(loc.via, "remote");
  assert.equal(loc.otherClone, true);
  assert.equal(loc.root.replace(/\//g, "\\"), PIPE_WT);
  assert.equal(loc.relPath, "adf/pipeline/copy.json");
  // And the observed clone itself resolves by folder.
  const main = locateFile(`${PIPE}\\adf\\pipeline\\copy.json`, candidates, { top: PIPE, origin: "https://github.com/example-org/sales-pipeline" }, HUB, true);
  assert.equal(main.kind === "declared" && main.otherClone, false);
  const comps = owningComponents(loc.key, loc.relPath, places);
  assert.deepEqual(comps.map(c => c.id), ["adf"]);
  const pack = buildFileContext(base({ repository: { kind: "declared", key: "pipeline", label: "Sales pipeline", bridge: false, otherClone: true, git: { branch: "claude/fix", head: "9999999999999" } }, file: { relPath: loc.relPath, text: "{}" }, components: comps, localPaths: [PIPE_WT, PIPE, HUB] }));
  assert.match(pack.text, /another clone or worktree of that repository \(same remote\)/);
  assert.match(pack.text, /branch claude\/fix/);
  noAbsolutePath(pack.text);
});

test("location helpers: prefix matching, a bridge in a monorepo sub-folder, a file in the bridge", () => {
  assert.equal(relativeInside("D:\\a\\b", "D:\\a\\bc\\x", true), undefined);
  assert.equal(relativeInside("D:\\a\\b", "d:\\A\\B\\x\\y.txt", true), "x/y.txt");
  assert.equal(relativeInside("/r", "/r"), "");
  const mono = locateFile("D:\\mono\\bridge\\.datapass\\project.json", [{ key: ".", folder: "D:\\mono\\bridge" }], { top: "D:/mono" }, undefined, true);
  assert.deepEqual(mono, { kind: "declared", key: ".", root: "D:\\mono\\bridge", relPath: ".datapass/project.json", via: "folder", otherClone: false });
  const hubFile = locateFile(`${HUB}\\README.md`, candidates, undefined, HUB, true);
  assert.deepEqual(hubFile, { kind: "declared", key: ".", root: HUB, relPath: "README.md", via: "folder", otherClone: false });
  const inBridge = buildFileContext(base({ repository: { kind: "declared", key: ".", label: "Sales hub", bridge: true, otherClone: false }, file: { relPath: "README.md", text: "# hub" }, components: [], revisions: [] }));
  assert.match(inBridge.text, /the bridge repository \(coordination repository\) of this project/);
  assert.match(inBridge.text, /This is the bridge repository: an architecture change goes here/);
  assert.match(inBridge.text, /Git: not read/);
});

test("siblings are capped, folders first, the file itself always kept", () => {
  const many = Array.from({ length: 80 }, (_v, i) => ({ name: `f${String(i).padStart(2, "0")}.txt`, dir: false }));
  const r = capSiblings([...many, { name: "zz-target.py", dir: false }, { name: "sub", dir: true }, { name: ".git", dir: true }], "zz-target.py", 10);
  assert.equal(r.siblings.length, 10);
  assert.equal(r.siblings[0]!.name, "sub");
  assert.equal(r.siblings.at(-1)!.name, "zz-target.py");
  assert.ok(!r.siblings.some(s => s.name === ".git"));
  assert.equal(r.moreSiblings, 72);
  assert.deepEqual(parentChain("a/b/c.txt"), ["a", "a/b"]);
  assert.deepEqual(parentChain("c.txt"), []);
});

test("fences survive backticks in the content; diagnostics are capped", () => {
  const pack = buildFileContext(base({ file: { relPath: "README.md", languageId: "markdown", text: "```js\nx\n```\n" }, diagnostics: Array.from({ length: 60 }, (_v, i) => ({ severity: "info" as const, line: i + 1, message: `m${i}` })) }));
  assert.match(pack.text, /````markdown\n```js\nx\n```\n````/);
  assert.match(pack.text, /- … 20 more/);
});
