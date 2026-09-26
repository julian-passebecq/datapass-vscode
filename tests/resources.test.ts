import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { declaredResources, remoteTarget, resourcesForScope, scopeTitles, LEGACY_ORACLE_ID } from "../src/core/resources/resources";
import { validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { projectFacts } from "../src/core/workspace/facts";

/** One VM shared by Wind and Hydro, as in the V2.1 design (synthetic values). */
const manifest = (): DataPassProjectManifest => ({
  schemaVersion: 2,
  project: { id: "lab", title: "Lab" },
  repositories: { control: { path: "../control" } },
  scopes: [{ id: "wind", title: "Wind" }, { id: "hydro", title: "Hydro" }, { id: "docs", title: "Docs" }],
  resources: [
    { id: "vm", kind: "vm", title: "Lab VM", provider: "oci", ssh: { host: "lab-vm" } },
    { id: "cluster", kind: "kubernetes-cluster", title: "Spare cluster" }
  ],
  bindings: [
    { id: "wind-on-vm", resource: "vm", scopes: ["wind"], folder: "/opt/lab/wind", repository: "control", compose: "docker-compose.wind.yml", env: ["MQTT_URL", "EVENTHUB_NAME"], processes: ["wind-gateway"] },
    { id: "hydro-on-vm", resource: "vm", scopes: ["hydro"], folder: "/opt/lab/hydro" }
  ]
});

test("resources: a shared VM shows each scope its own binding and who else a host-level change affects", () => {
  const m = manifest();
  const wind = resourcesForScope(m, "wind");
  assert.deepEqual(wind.map(v => v.resource.id), ["vm", "cluster"], "an unbound resource belongs to every scope");
  assert.deepEqual(wind[0]!.bindings.map(b => b.id), ["wind-on-vm"]);
  assert.deepEqual(wind[0]!.sharedWith.map(b => b.id), ["hydro-on-vm"]);
  assert.deepEqual(scopeTitles(m, wind[0]!.sharedWith), ["Hydro"]);
  assert.deepEqual(resourcesForScope(m, "docs").map(v => v.resource.id), ["cluster"], "a VM bound only to other scopes is not shown");
  const whole = resourcesForScope(m, "project");
  assert.deepEqual(whole[0]!.bindings.map(b => b.id), ["wind-on-vm", "hydro-on-vm"]);
  assert.deepEqual(whole[0]!.sharedWith, []);
});

test("resources: Remote-SSH target is the alias plus the binding folder, never anything else", () => {
  const m = manifest();
  assert.deepEqual(remoteTarget(m.resources![0]!, m.bindings![0]), { authority: "ssh-remote+lab-vm", path: "/opt/lab/wind" });
  assert.deepEqual(remoteTarget(m.resources![0]!), { authority: "ssh-remote+lab-vm", path: "/" });
  assert.equal(remoteTarget(m.resources![1]!), undefined, "no alias, no target");
  assert.equal(remoteTarget({ id: "x", kind: "vm", ssh: { host: "root@evil" } }), undefined);
  assert.equal(remoteTarget(m.resources![0]!, { id: "b", resource: "vm", folder: "/opt/../etc" })!.path, "/");
});

test("resources: the legacy platforms.oracle.sshHost becomes a VM resource and feeds the SSH preflight fact", () => {
  const legacy: DataPassProjectManifest = { schemaVersion: 1, project: { id: "p", title: "P" }, platforms: { oracle: { sshHost: "oracle-prod" } } };
  const r = declaredResources(legacy);
  assert.deepEqual(r, [{ id: LEGACY_ORACLE_ID, kind: "vm", title: "Oracle VM", ssh: { host: "oracle-prod" } }]);
  assert.equal(projectFacts({ manifest: legacy }).get("vm.sshHost"), "oracle-prod");
  assert.equal(projectFacts({ manifest: manifest() }).get("vm.sshHost"), "lab-vm");
  const both = manifest();
  both.platforms = { oracle: { sshHost: "lab-vm" } };
  assert.equal(declaredResources(both).length, 2, "not duplicated when a resource already declares the alias");
});

test("resources: validation keeps secrets, users and relative folders out of the manifest", () => {
  assert.deepEqual(validateProjectManifest(manifest()), []);
  const cases: Array<[(m: any) => void, RegExp]> = [
    [m => { m.bindings[0].env.push("TOKEN=abc123"); }, /env\[2\] must be a variable NAME only — values never go in the manifest/],
    [m => { m.resources[0].ssh.host = "ubuntu@10.0.0.4"; }, /alias from your ~\/.ssh\/config/],
    [m => { m.resources[0].password = "x"; }, /password is not allowed/],
    [m => { m.bindings[0].folder = "opt/lab"; }, /absolute folder/],
    [m => { m.bindings[0].folder = "/opt/../etc"; }, /absolute folder/],
    [m => { m.bindings[0].resource = "ghost"; }, /must name a declared resource/],
    [m => { m.bindings[0].scopes = ["renamed"]; }, /must name a declared scope/],
    [m => { m.bindings[0].repository = "nope"; }, /must name a declared repository/],
    [m => { m.bindings[1].id = "wind-on-vm"; }, /id is duplicated/],
    [m => { m.resources[0].kind = "server"; }, /kind must be one of/]
  ];
  for (const [mutate, expected] of cases) {
    const m = structuredClone(manifest()) as any;
    mutate(m);
    const issues = validateProjectManifest(m);
    assert.ok(issues.some(i => expected.test(i)), `${expected}: ${issues.join(" | ")}`);
    assert.ok(!issues.join(" ").includes("abc123"), "an env value is never echoed back");
  }
  const v1 = { schemaVersion: 1, project: { id: "p", title: "P" }, resources: [] };
  assert.ok(validateProjectManifest(v1).some(i => /requires schemaVersion 2/.test(i)));
});

test("resources: the editor schema agrees with the runtime", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validate = ajv.compile(JSON.parse(readFileSync("schemas/datapass-project.schema.json", "utf8")));
  assert.ok(validate(manifest()), JSON.stringify(validate.errors));
  for (const mutate of [
    (m: any) => { m.bindings[0].env.push("TOKEN=abc123"); },
    (m: any) => { m.resources[0].ssh.host = "ubuntu@10.0.0.4"; },
    (m: any) => { m.resources[0].password = "x"; },
    (m: any) => { m.bindings[0].folder = "opt/lab"; }
  ]) {
    const m = structuredClone(manifest()) as any;
    mutate(m);
    assert.equal(validate(m), false);
    assert.ok(validateProjectManifest(m).length > 0);
  }
});
