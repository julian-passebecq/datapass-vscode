/**
 * V1-ON Open a Client Project: the clone plan from a bridge's manifest. Planned repositories are
 * never cloned; an existing clone is located by its remote identity (https / SSH, the Azure DevOps
 * forms), wherever it sits; a folder holding something else is never cloned over.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import type { DataPassProjectManifest } from "../src/core/projectManifestModel";
import { candidateFolders, hostMessage, isAuthFailure, parseBridgeUrl, planBridge, planClones, planSummary, workspaceRoots, type FolderFact } from "../src/core/project/cloneplan";

const parent = path.resolve("/clients/acme");
const bridgeFolder = path.join(parent, "acme-bridge");
const BRIDGE = "https://github.com/acme/acme-bridge.git";

function manifest(repositories: DataPassProjectManifest["repositories"]): DataPassProjectManifest {
  return { schemaVersion: 5, project: { id: "acme", title: "Acme" }, repositories } as DataPassProjectManifest;
}

const m = manifest({
  lab: { label: "Lab", description: "Notebooks and studies", remote: { url: "https://github.com/acme/lab.git" } },
  pipeline: { label: "Pipeline", description: "Ingestion", remote: { url: "https://dev.azure.com/acme-org/Data/_git/pipeline" } },
  portal: { label: "Portal", description: "Web app", planned: true, remote: { url: "https://github.com/acme/portal.git" } },
  archive: { label: "Archive", management: "remote-only", remote: { url: "git@gitlab.com:acme/archive.git" } }
});

const gitFact = (folder: string, origin?: string): FolderFact => ({ folder, exists: true, isGitRepo: true, origin });

test("an empty folder: every non-planned repository is cloned next to the bridge, remote-only unticked", () => {
  const plan = planClones(m, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts: [] });
  const byKey = Object.fromEntries(plan.map(e => [e.key, e]));
  assert.equal(byKey.lab!.state, "clone");
  assert.equal(byKey.lab!.folder, path.join(parent, "lab"));
  assert.equal(byKey.lab!.role, "Notebooks and studies");
  assert.equal(byKey.lab!.picked, true);
  assert.equal(byKey.pipeline!.state, "clone");
  assert.equal(byKey.pipeline!.folder, path.join(parent, "pipeline"));
  assert.equal(byKey.portal!.state, "planned");
  assert.equal(byKey.portal!.picked, false);
  assert.equal(byKey.archive!.state, "clone");
  assert.equal(byKey.archive!.picked, false, "remote-only is never cloned unless ticked");
  assert.deepEqual(planSummary(plan), { present: 0, toClone: 3, planned: 1, blocked: 0 });
});

test("a planned repository is never cloned, even when nothing else is declared", () => {
  const plan = planClones(manifest({ p: { planned: true, remote: { url: "https://github.com/acme/p.git" } } }), { bridgeFolder, bridgeUrl: BRIDGE, parent, facts: [] });
  assert.deepEqual(plan.map(e => [e.state, e.folder, e.picked]), [["planned", undefined, false]]);
  assert.ok(!candidateFolders(manifest({ p: { planned: true, remote: { url: "https://github.com/acme/p.git" } } }), bridgeFolder, parent).length);
});

test("an existing clone is located by remote identity: SSH clone of an https declaration, under another name", () => {
  const facts = [gitFact(path.join(parent, "my-lab"), "git@github.com:acme/lab.git")];
  const plan = planClones(m, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts });
  const lab = plan.find(e => e.key === "lab")!;
  assert.equal(lab.state, "present");
  assert.equal(lab.folder, path.join(parent, "my-lab"));
  assert.equal(lab.picked, false);
});

test("Azure DevOps: a clone with the legacy SSH form is the repository declared with the https _git form", () => {
  for (const origin of ["acme-org@vs-ssh.visualstudio.com:v3/acme-org/Data/pipeline", "git@ssh.dev.azure.com:v3/acme-org/Data/pipeline", "https://acme-org@dev.azure.com/acme-org/Data/_git/pipeline", "https://acme-org.visualstudio.com/DefaultCollection/Data/_git/pipeline"]) {
    const plan = planClones(m, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts: [gitFact(path.join(parent, "pipeline"), origin)] });
    assert.equal(plan.find(e => e.key === "pipeline")!.state, "present", origin);
  }
  // And the reverse: declared in the SSH form, cloned from the https form.
  const ssh = manifest({ pipeline: { remote: { url: "acme-org@vs-ssh.visualstudio.com:v3/acme-org/Data/pipeline" } } });
  const plan = planClones(ssh, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts: [gitFact(path.join(parent, "anything"), "https://dev.azure.com/acme-org/Data/_git/pipeline")] });
  assert.equal(plan[0]!.state, "present");
  assert.equal(plan[0]!.folder, path.join(parent, "anything"));
});

test("a target folder holding another repository or plain files is never cloned over", () => {
  const facts: FolderFact[] = [gitFact(path.join(parent, "lab"), "https://github.com/someone-else/lab.git"), { folder: path.join(parent, "pipeline"), exists: true, isGitRepo: false }];
  const plan = planClones(m, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts });
  assert.equal(plan.find(e => e.key === "lab")!.state, "conflict");
  assert.match(plan.find(e => e.key === "lab")!.detail, /github\.com\/someone-else\/lab/);
  assert.equal(plan.find(e => e.key === "pipeline")!.state, "conflict");
  assert.equal(planSummary(plan).blocked, 2);
});

test("declared paths: relative to the bridge, inside the chosen folder; outside it DataPass does not clone", () => {
  const withPaths = manifest({
    lab: { path: "../repos/lab", remote: { url: "https://github.com/acme/lab.git" } },
    far: { path: "../../../elsewhere/far", remote: { url: "https://github.com/acme/far.git" } }
  });
  const plan = planClones(withPaths, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts: [] });
  assert.equal(plan[0]!.state, "clone");
  assert.equal(plan[0]!.folder, path.join(parent, "repos", "lab"));
  assert.equal(plan[1]!.state, "conflict");
  assert.match(plan[1]!.detail, /outside/);
  assert.deepEqual(candidateFolders(withPaths, bridgeFolder, parent), [path.join(parent, "repos", "lab"), path.resolve(bridgeFolder, "../../../elsewhere/far")]);
});

test("the bridge declared among the repositories, a repository without remote, a non-Git address", () => {
  const plan = planClones(manifest({
    hub: { remote: { url: "git@github.com:acme/acme-bridge.git" } },
    docs: { path: "../docs" },
    odd: { remote: { url: "file:///srv/odd.git" } }
  }), { bridgeFolder, bridgeUrl: BRIDGE, parent, facts: [{ folder: path.join(parent, "docs"), exists: true, isGitRepo: false }] });
  assert.deepEqual(plan.map(e => e.state), ["present", "present", "conflict"]);
  assert.equal(plan[0]!.folder, bridgeFolder);
});

test("re-run: everything present, nothing to clone, the workspace roots are the bridge then each clone", () => {
  const facts = [gitFact(path.join(parent, "lab"), "https://github.com/acme/lab"), gitFact(path.join(parent, "pipeline"), "git@ssh.dev.azure.com:v3/acme-org/Data/pipeline"), gitFact(path.join(parent, "archive"), "https://gitlab.com/acme/archive.git")];
  const plan = planClones(m, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts });
  assert.deepEqual(planSummary(plan), { present: 3, toClone: 0, planned: 1, blocked: 0 });
  assert.deepEqual(workspaceRoots(bridgeFolder, plan), [bridgeFolder, path.join(parent, "lab"), path.join(parent, "pipeline"), path.join(parent, "archive")]);
});

test("one clone is never claimed by two declarations", () => {
  const twice = manifest({ a: { remote: { url: "https://github.com/acme/lab.git" } }, b: { remote: { url: "git@github.com:acme/lab.git" } } });
  const plan = planClones(twice, { bridgeFolder, bridgeUrl: BRIDGE, parent, facts: [gitFact(path.join(parent, "lab"), "https://github.com/acme/lab.git")] });
  assert.equal(plan[0]!.state, "present");
  assert.equal(plan[1]!.state, "conflict", "the second declaration's folder already holds the first");
});

test("the bridge address: https and SSH of the three hosts; http, paths and option-like text refused", () => {
  for (const [url, host, name] of [
    ["https://github.com/acme/acme-bridge.git", "GitHub", "acme-bridge"],
    ["git@github.com:acme/acme-bridge.git", "GitHub", "acme-bridge"],
    ["https://acme-org@dev.azure.com/acme-org/Data/_git/bridge", "Azure DevOps", "bridge"],
    ["acme-org@vs-ssh.visualstudio.com:v3/acme-org/Data/bridge", "Azure DevOps", "bridge"],
    ["ssh://git@gitlab.com/acme/group/bridge.git", "GitLab", "bridge"],
    ["  git clone https://gitlab.example.com/acme/bridge  ", "GitLab", "bridge"]
  ] as const) {
    const r = parseBridgeUrl(url);
    assert.ok(!("error" in r), `${url}: ${"error" in r ? r.error : ""}`);
    assert.equal(r.host, host, url);
    assert.equal(r.name, name, url);
  }
  for (const bad of ["", "http://github.com/acme/x.git", "C:\\repos\\x", "file:///srv/x.git", "--upload-pack=evil", "https://github.com/acme/x y"]) assert.ok("error" in parseBridgeUrl(bad), bad);
});

test("the bridge folder: an existing clone is reused, a foreign folder blocks, else <parent>/<name>", () => {
  const b = parseBridgeUrl(BRIDGE);
  assert.ok(!("error" in b));
  assert.deepEqual(planBridge(b, parent, []), { state: "clone", folder: bridgeFolder, detail: `clone into ${bridgeFolder}` });
  assert.equal(planBridge(b, parent, [gitFact(path.join(parent, "hub"), "git@github.com:acme/acme-bridge.git")]).folder, path.join(parent, "hub"));
  assert.equal(planBridge(b, parent, [gitFact(bridgeFolder, "https://github.com/other/acme-bridge")]).state, "conflict");
});

test("clone failures: sign-in refusals are recognised and the host's own message is kept", () => {
  const gh = "Cloning into 'lab'...\nremote: Repository not found.\nfatal: repository 'https://github.com/acme/lab.git/' not found\n";
  assert.equal(isAuthFailure(gh), true);
  assert.equal(hostMessage(gh), "remote: Repository not found.\nfatal: repository 'https://github.com/acme/lab.git/' not found");
  assert.equal(isAuthFailure("fatal: Authentication failed for 'https://dev.azure.com/acme-org/Data/_git/pipeline/'"), true);
  assert.equal(isAuthFailure("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."), true);
  assert.equal(isAuthFailure("fatal: could not create work tree dir 'lab': No space left on device"), false);
});
