import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  FABRIC_CORE_EXTENSION_ID,
  FABRIC_PORTAL_URL,
  fabricNativeBridgeFacts,
  fabricPortalUrl,
  fabricViewContainerId,
  isFabricManager,
  nativeBridgeDetail,
  type ExtensionLike
} from "../src/core/fabric/nativeBridge";

const WS = "1b2c3d4e-0000-4a5b-8c9d-0123456789ab";
const manifest = (version: string, viewsContainers?: Record<string, Array<{ id?: unknown }>>) =>
  ({ version, contributes: viewsContainers ? { viewsContainers } : {} });
const only = (ext: ExtensionLike | undefined) => (id: string) => (id === FABRIC_CORE_EXTENSION_ID ? ext : undefined);
const op = (facts: ReturnType<typeof fabricNativeBridgeFacts>, name: string) => facts.operations.find(o => o.operation === name)!;

test("FABINT1: without the Fabric extension, static analysis and the portal fallback remain", () => {
  const facts = fabricNativeBridgeFacts(only(undefined));
  assert.equal(facts.installed, false);
  assert.equal(facts.bridgeAvailable, false);
  assert.equal(facts.version, undefined);
  assert.deepEqual(facts.fallback, { staticAnalysis: true, portalUrl: FABRIC_PORTAL_URL });
  assert.equal(op(facts, "detect").supported, true);
  for (const name of ["revealWorkspaceView", "workspaceContext", "itemIdentity", "openNativeArtifact"]) assert.equal(op(facts, name).supported, false, name);
  assert.match(nativeBridgeDetail(facts), /not installed; static analysis works without it/);
});

test("FABINT1: installed and inactive: version and manifest view container, services closed, never reads exports", () => {
  let exportsRead = false;
  const ext: ExtensionLike = {
    isActive: false,
    packageJSON: manifest("0.39.18", { activitybar: [{ id: "vscode-fabric_view_workspace" }] }),
    get exports() { exportsRead = true; return {}; }
  };
  const facts = fabricNativeBridgeFacts(only(ext), { workspaceId: WS });
  assert.equal(exportsRead, false, "an inactive extension's exports are never touched");
  assert.equal(facts.installed, true);
  assert.equal(facts.active, false);
  assert.equal(facts.version, "0.39.18");
  assert.equal(facts.exportsRecognized, undefined);
  assert.equal(op(facts, "revealWorkspaceView").supported, true);
  assert.equal(op(facts, "openNativeArtifact").supported, false);
  assert.match(op(facts, "openNativeArtifact").reason, /allow-listed Microsoft satellites/);
  assert.equal(facts.fallback.portalUrl, `${FABRIC_PORTAL_URL}groups/${WS}/list`);
  assert.match(nativeBridgeDetail(facts), /0\.39\.18 detected \(revealWorkspaceView\)/);
});

test("FABINT1: an old version without a view container still reports detection only", () => {
  const facts = fabricNativeBridgeFacts(only({ isActive: false, packageJSON: manifest("0.10.0") }));
  assert.equal(facts.version, "0.10.0");
  assert.equal(op(facts, "revealWorkspaceView").supported, false);
  assert.match(op(facts, "revealWorkspaceView").reason, /contributes no view container/);
  assert.equal(facts.bridgeAvailable, false);
});

test("FABINT1: an active extension's exports are recognized by shape only, addExtension is never called", () => {
  let called = false;
  const exports = { addExtension: () => { called = true; throw new Error("is not allowed"); } };
  const facts = fabricNativeBridgeFacts(only({ isActive: true, packageJSON: manifest("0.39.18"), exports }));
  assert.equal(facts.exportsRecognized, true);
  assert.equal(called, false);
  assert.equal(facts.bridgeAvailable, false);
  assert.equal(fabricNativeBridgeFacts(only({ isActive: true, packageJSON: { version: 3 }, exports: "x" })).exportsRecognized, false);
  assert.equal(isFabricManager(null), false);
});

test("FABINT1: a throwing lookup and malformed manifests degrade to not installed / no container", () => {
  assert.equal(fabricNativeBridgeFacts(() => { throw new Error("host gone"); }).installed, false);
  assert.equal(fabricViewContainerId({ isActive: false, packageJSON: { contributes: { viewsContainers: { activitybar: [{ id: 42 }] } } } }), undefined);
  assert.equal(fabricViewContainerId({ isActive: false, packageJSON: manifest("1", { panel: [{ id: "p" }] }) }), "p");
});

test("FABINT1: the portal link only uses a GUID workspace ID", () => {
  assert.equal(fabricPortalUrl(undefined), FABRIC_PORTAL_URL);
  assert.equal(fabricPortalUrl("Sales Workspace"), FABRIC_PORTAL_URL);
  assert.equal(fabricPortalUrl("../../evil"), FABRIC_PORTAL_URL);
  assert.equal(fabricPortalUrl(` ${WS.toUpperCase()} `), `${FABRIC_PORTAL_URL}groups/${WS}/list`);
});
