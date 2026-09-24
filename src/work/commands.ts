/**
 * V2.2 commands: scope, checklist, preflight, app exchange, candidates and impact, publication
 * briefs, authority snapshots, DiagramCloud export, Power BI project inspection, AI context,
 * manifest migration, graph init and contract validation.
 *
 * Invariants: imports are untrusted data; results are candidates or quarantined, never applied
 * automatically; private exchange history stays under .datapass/local (git-ignored); nothing
 * here executes cloud operations.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { gitRunner } from "./session";
import { confirmModal, guarded, jsonBytes, openLocal, pickFile, pickFiles, readBounded, readJsonInput, relativeTo, report, requireRoot, text, UserFacingError, Cancelled } from "./io";
import { writeLocal, LOCAL_DIR } from "../core/workspace/loader";
import { CAPABILITY_INDEX } from "../core/capabilities/registry";
import { preflight } from "../core/capabilities/preflight";
import { projectFacts } from "../core/workspace/loader";
import { executeGalaxyAction } from "../core/actions";
import { CHECKLIST_STATES, IMPLICIT_SCOPE_ID, type ChecklistState, type ExchangeRecord, type WorkChecklistEntry } from "../core/work/workModel";
import { buildAppRequest } from "../core/exchange/appExchange";
import { assessAppResult } from "../core/exchange/appExchange";
import type { AppExchangePayload, Audience, Classification, Envelope, AuthoritySnapshotPayload, PublicationBriefPayload } from "../core/contracts/envelopes";
import { envelopeKind, parseEnvelope } from "../core/contracts/validate";
import { newLocalId, sha256Bytes, isId } from "../core/model/ids";
import { parseStrictJson } from "../core/model/strictJson";
import { observeRemoteRevision } from "../core/workspace/gitBase";
import { createCandidate, getPointer, CandidateError, type FieldEdit } from "../core/domainPacks/candidate";
import { EDITABLE_ROLES, parseDomainPack, type DomainPack, type PackField } from "../core/domainPacks/pack";
import { analyzeImpact, classifyChange, type FacetChange } from "../core/impact/facets";
import { emptyGraph, parseGraph, resolveOutputs, type ProjectGraph } from "../core/workspace/graph";
import { CLAIMS_REGISTER_PATH, emptyClaimsRegister, parseClaimsRegister } from "../core/publication/claimsRegister";
import { assessBriefTrust, assessOutputManifest, prepareBrief } from "../core/publication/brief";
import { describeSnapshot } from "../core/authority/snapshot";
import { querySpecHash, validateQuerySpec } from "../core/authority/querySpec";
import { projectToDiagramCloud } from "../core/diagramcloud/projection";
import { analyzePbip } from "../core/powerbi/pbipGraph";
import { buildAiContext, type ContextPreset } from "../core/exchange/aiContext";
import { migrateManifestToV2, validateProjectManifest, DATAPASS_MANIFEST_PATH } from "../core/projectManifestModel";
import { applyWithJournal, type JournalFs } from "../core/exchange/journal";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { clipboard } from "../core/clipboard";

const now = () => new Date().toISOString();

export function registerWorkCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));

  reg("datapass.work.refresh", async () => session.refresh(true));
  reg("datapass.selectScope", async () => selectScope(session));
  reg("datapass.setChecklistState", async (entry?: WorkChecklistEntry) => setChecklistState(session, entry));
  reg("datapass.showPreflight", async (capabilityId?: string) => showPreflight(session, capabilityId));
  reg("datapass.createAppRequest", async () => createAppRequest(session));
  reg("datapass.importAppResult", async () => importAppResult(session));
  reg("datapass.observeAppRevision", async (node?: { app?: { app?: { id: string } } }) => observeAppRevision(session, node?.app?.app?.id));
  reg("datapass.createCandidate", async () => createCandidateCmd(session));
  reg("datapass.analyzeImpact", async () => analyzeImpactCmd(session));
  reg("datapass.prepareBrief", async () => prepareBriefCmd(session));
  reg("datapass.approveBrief", async (node?: { rec?: ExchangeRecord }) => approveBrief(session, node?.rec));
  reg("datapass.importOutputManifest", async () => importOutputManifest(session));
  reg("datapass.importAuthoritySnapshot", async () => importAuthoritySnapshot(session));
  reg("datapass.exportDiagramCloud", async () => exportDiagramCloud(session));
  reg("datapass.inspectPowerBiProject", async () => inspectPowerBi(session));
  reg("datapass.copyAiContext", async () => copyAiContext(session));
  reg("datapass.migrateManifestToV2", async () => migrateManifest(session));
  reg("datapass.initGraph", async () => initGraph(session));
  reg("datapass.validateContract", async (uri?: vscode.Uri) => validateContract(session, uri));
  reg("datapass.openExchange", async (file: string) => openLocal(requireRoot(session.root), file));
}

// ---------------------------------------------------------------- scope & checklist

async function selectScope(session: WorkSession): Promise<void> {
  const m = session.model();
  const items = [
    ...m.scopes.map(s => ({ label: s.title, description: s.id, detail: s.objective, id: s.id, picked: s.id === m.scope.id })),
    { label: "Whole project", description: IMPLICIT_SCOPE_ID, detail: "No scope filter; operations for every declared platform", id: IMPLICIT_SCOPE_ID, picked: m.scopeSource === "implicit" }
  ];
  if (!m.scopes.length) void vscode.window.showInformationMessage("No scopes are declared. Add `scopes` to .datapass/project.json (schemaVersion 2) to focus the Work view on one objective.");
  const pick = await vscode.window.showQuickPick(items, { title: "Select DataPass work scope", placeHolder: "One active scope per window. A scope focuses navigation; it does not sandbox other tools." });
  if (pick) await session.selectScope(pick.id);
}

async function setChecklistState(session: WorkSession, entry?: WorkChecklistEntry): Promise<void> {
  const m = session.model();
  const target = entry ?? (await vscode.window.showQuickPick(m.checklist.map(e => ({ label: e.label, description: e.state, e })), { title: "Checklist item" }))?.e;
  if (!target) return;
  const labels: Record<ChecklistState, string> = { todo: "$(circle-large-outline) To do", done: "$(pass-filled) Done", blocked: "$(error) Blocked", problem: "$(warning) Problem", skipped: "$(debug-step-over) Skipped" };
  const actions = [
    ...CHECKLIST_STATES.map(s => ({ label: labels[s], id: s as string, description: s === target.state ? "current" : undefined })),
    ...(target.capabilityRef ? [{ label: "$(tools) Show operation preflight", id: "preflight", description: target.capabilityRef }] : [])
  ];
  const pick = await vscode.window.showQuickPick(actions, { title: target.label, placeHolder: "Checklist state is a user-reported note, not execution evidence" });
  if (!pick) return;
  if (pick.id === "preflight") return showPreflight(session, target.capabilityRef);
  const state = pick.id as ChecklistState;
  let note: string | undefined;
  if (state === "blocked" || state === "problem" || state === "skipped") {
    note = await vscode.window.showInputBox({ title: `${target.label}: ${state}`, prompt: "Short note (why / what is missing)", value: target.note, validateInput: v => (v.length > 500 ? "Keep it under 500 characters" : undefined) });
    if (note === undefined) return;
  }
  await session.setChecklist(m.scope.id, target.id, state, note);
}

// ---------------------------------------------------------------- preflight

async function showPreflight(session: WorkSession, capabilityId?: string): Promise<void> {
  const m = session.model();
  let id = capabilityId;
  if (!id) {
    const pick = await vscode.window.showQuickPick(m.operations.map(o => ({ label: o.capability.label, description: o.result.status, detail: o.capability.id, id: o.capability.id })), { title: "Operation preflight" });
    if (!pick) return;
    id = pick.id;
  }
  const cap = CAPABILITY_INDEX.get(id);
  if (!cap) throw new UserFacingError(`Unknown capability ${id}`);
  for (;;) {
    const r = preflight(cap, { tools: session.toolObservations(), facts: projectFacts(session.project), reviewsConfirmed: new Set([...cap.reviews.map(rv => `${cap.id}:${rv.id}`)].filter(k => session.reviewConfirmed(k))) });
    const section = (title: string, items: Array<{ label: string; detail: string }>) => (items.length ? [`${title}:`, ...items.map(i => `  - ${i.label} — ${i.detail}`)] : []);
    report(`Preflight: ${cap.label} [${cap.id}]`, [
      `Status: ${r.status.toUpperCase()}`,
      `Next step: ${r.nextStep}`,
      `Provider ${cap.provider} · item ${cap.nativeItemType} · operation ${cap.operation} · mode ${cap.authoringMode}`,
      `Action mode: ${cap.actionMode} · side effects: ${r.sideEffects.join(", ") || "none"}`,
      ...section("Blockers", r.blockers), ...section("Configuration", r.configIssues), ...section("Unknown (cannot probe; not the same as missing)", r.unknowns),
      ...section("Pending reviews", r.pendingReviews), ...section("Optional, missing (never blocks)", r.optionalMissing), ...section("Satisfied", r.satisfied),
      ...(r.warnings.length ? ["Warnings:", ...r.warnings.map(w => `  - ${w}`)] : []),
      ...(cap.covers?.length ? [`Covers: ${cap.covers.join(", ")}`] : []),
      `Fallback: ${r.fallback}`,
      `Sources: ${cap.sources.join(", ")}`,
      r.evidenceNote
    ]);
    const choices: Array<{ label: string; id: string; detail?: string }> = r.pendingReviews.map(p => ({ label: `$(eye) Confirm review: ${p.label}`, id: `review:${p.id}` }));
    if (cap.datapassActionId && cap.implementation === "implemented") {
      const runnable = r.status === "ready" || r.status === "unknown";
      choices.push({ label: `$(play) ${cap.actionMode === "copy-command" ? "Copy command" : cap.actionMode === "open-native" ? "Open native tool" : "Run"}: ${cap.label}`, id: runnable ? "run" : "blocked", detail: runnable ? (r.status === "unknown" ? "Some prerequisites could not be probed." : undefined) : `Not available while ${r.status}.` });
    }
    if (!choices.length) return;
    const pick = await vscode.window.showQuickPick(choices, { title: `${cap.label}: ${r.status}`, placeHolder: "Details are in the DataPass Work output" });
    if (!pick || pick.id === "blocked") return;
    if (pick.id.startsWith("review:")) {
      const review = cap.reviews.find(rv => rv.id === pick.id.slice("review:".length))!;
      if (await confirmModal(review.prompt, `Operation: ${cap.label}\nThis confirmation lasts for this window session only and applies to the currently declared target.`, "I have reviewed this")) {
        session.confirmReview(cap.id, review.id);
      }
      continue;
    }
    const actionId = cap.datapassActionId!;
    if (actionId.startsWith("datapass.")) await vscode.commands.executeCommand(actionId);
    else await executeGalaxyAction(actionId, session.extensionUri);
    return;
  }
}

// ---------------------------------------------------------------- app exchange

async function createAppRequest(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid project manifest is required.");
  const apps = manifest.apps ?? [];
  if (!apps.length) throw new UserFacingError("Declare the external app in `apps` of .datapass/project.json (schemaVersion 2) first.");
  const app = (await vscode.window.showQuickPick(apps.map(a => ({ label: a.label ?? a.id, description: `${a.appType} · ${a.repoRef}`, a })), { title: "Which external app is this request for?" }))?.a;
  if (!app) return;
  if (!isId(app.id)) throw new UserFacingError(`App id "${app.id}" must match ^[a-z][a-z0-9_.-]{0,79}$ to be used in exchanges.`);
  const op = (await vscode.window.showQuickPick([
    { label: "prepare-candidate", detail: "Ask the app/AI to prepare a candidate change or result" },
    { label: "validate", detail: "Ask the app's own validator to check inputs" },
    { label: "package", detail: "Ask the app to package outputs" },
    { label: "describe", detail: "Ask the app to describe itself / its contracts" }
  ], { title: "Operation" }))?.label as AppExchangePayload["operation"] | undefined;
  if (!op) return;
  const graphItems = session.project.graph?.items ?? [];
  const inputs = graphItems.length
    ? (await vscode.window.showQuickPick(graphItems.map(i => ({ label: i.label, description: `${i.id} · ${i.kind}`, id: i.id, picked: app.inputContracts?.includes(i.id) })), { title: "Inputs (project graph items)", canPickMany: true }))?.map(p => p.id)
    : await askIds("Input references (comma-separated IDs, may be empty)", app.inputContracts ?? []);
  if (!inputs) return;
  const classification = (await vscode.window.showQuickPick(["internal", "confidential", "public"], { title: "Classification of this request" })) as Classification | undefined;
  if (!classification) return;
  const scope = session.model().scope;
  const id = newLocalId(`req-${app.id}`.slice(0, 50));
  const frozen = buildAppRequest({
    id, projectRef: safeId(manifest.project.id), scopeRef: safeId(scope.id), base: await session.captureBase(), classification,
    createdAt: now(), sources: [], appRef: app.id, operation: op, inputRefs: inputs
  });
  const rel = `exchanges/${id}/request.json`;
  await writeLocal(root, rel, frozen.bytes);
  await session.recordExchange({ id, kind: "app-request", label: `${app.label ?? app.id}: ${op}`, status: "awaiting-result", file: `${LOCAL_DIR}/${rel}`, digest: frozen.digest.value, scopeRef: scope.id, at: now() });
  report(`App request ${id}`, [
    `App ${app.id} · operation ${op} · inputs ${inputs.join(", ") || "none"}`,
    `Saved: ${LOCAL_DIR}/${rel}`,
    `Request sha256: ${frozen.digest.value}`,
    "The result must be a datapass.app-exchange envelope with direction=result, the same correlationId/scope/base,",
    `and payload.requestHash = { algorithm: "sha256", value: "${frozen.digest.value}" } (hash of the exact request bytes).`,
    "Give the external app/AI the exact file bytes; do not reformat them."
  ]);
  const act = await vscode.window.showInformationMessage(`Request ${id} saved.`, "Copy request", "Open");
  if (act === "Copy request") await clipboard.writeText(text(frozen.bytes));
  if (act === "Open") await openLocal(root, `${LOCAL_DIR}/${rel}`);
}

async function importAppResult(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const open = session.exchanges().filter(e => e.kind === "app-request");
  if (!open.length) throw new UserFacingError("There is no app request to correlate with. Create one first.");
  const req = (await vscode.window.showQuickPick(open.map(e => ({ label: e.label, description: `${e.status} · ${e.at}`, detail: e.id, e })), { title: "Which request does this result answer?" }))?.e;
  if (!req?.file) return;
  const requestBytes = await readBounded(vscode.Uri.joinPath(root, ...req.file.split("/")));
  if (req.digest && sha256Bytes(requestBytes).value !== req.digest) throw new UserFacingError("The saved request file changed since it was created; it can no longer be used for correlation.");
  const input = await readJsonInput("app result", root);
  // Artifacts are optional; they are matched by artifact id or locator (file base name).
  const files = await pickFiles("Select returned artifact files (optional, Esc to skip)", root);
  const supplied = new Map<string, Uint8Array>();
  let declared: AppExchangePayload["outputArtifacts"] = [];
  try {
    const peek = parseStrictJson(input.bytes) as Envelope<"app-exchange", AppExchangePayload>;
    declared = Array.isArray(peek?.payload?.outputArtifacts) ? peek.payload.outputArtifacts : [];
  } catch { /* assessed below */ }
  for (const f of files) {
    const base = f.path.split("/").pop()!;
    const stem = base.replace(/\.[^.]+$/, "");
    const match = declared.find(a => a.id === base || a.id === stem || a.locatorRef === base || a.locatorRef === stem);
    supplied.set(match?.id ?? base, await readBounded(f));
  }
  const assessment = assessAppResult(requestBytes, input.bytes, supplied, now());
  const dir = `exchanges/${req.id}/${assessment.status === "candidate" ? "result" : `quarantine-${Date.now()}`}`;
  await writeLocal(root, `${dir}/result.json`, input.bytes);
  for (const [id, bytes] of supplied) {
    if (vetRelativePath(`${dir}/artifacts/${id}`).ok) await writeLocal(root, `${dir}/artifacts/${id}`, bytes);
  }
  await writeLocal(root, `${dir}/assessment.json`, jsonBytes({ ...assessment, result: undefined }));
  const resultId = assessment.result?.id ?? newLocalId("result");
  await session.recordExchange({ id: `${req.id}.result.${Date.now().toString(36)}`, kind: "app-result", label: `Result for ${req.label}`, status: assessment.status, file: `${LOCAL_DIR}/${dir}/result.json`, digest: sha256Bytes(input.bytes).value, scopeRef: req.scopeRef, at: now() });
  if (assessment.status === "candidate") await session.recordExchange({ ...req, status: "result-received" });
  report(`App result for ${req.id} (${input.origin})`, [
    `Status: ${assessment.status.toUpperCase()}${assessment.status === "candidate" ? " — staged for review; nothing was applied" : " — accepted state untouched"}`,
    `Result id: ${resultId}`,
    ...assessment.reasons.map(r => `  ✗ ${r}`),
    ...assessment.warnings.map(w => `  ! ${w}`),
    ...assessment.artifacts.map(a => `  artifact ${a.artifactId}: ${a.state}`),
    "Observations:",
    ...assessment.observations.map(o => `  - ${o.kind}: ${o.subjectRef} by ${o.by} (${o.method}) — ${o.limits}`),
    `Saved under ${LOCAL_DIR}/${dir}/`
  ]);
  if (assessment.status === "candidate") void vscode.window.showInformationMessage(`Result correlated with ${req.id} and staged as a candidate. External "succeeded" is reported, not observed.`);
  else void vscode.window.showWarningMessage(`Result quarantined: ${assessment.reasons[0] ?? "see output"}`);
}

async function observeAppRevision(session: WorkSession, appId?: string): Promise<void> {
  const m = session.model();
  const remote = m.apps.filter(a => a.repo?.remote?.url);
  if (!remote.length) throw new UserFacingError("No app has a remote repository (repositories.<ref>.remote.url).");
  const target = remote.find(a => a.app.id === appId) ?? (await vscode.window.showQuickPick(remote.map(a => ({ label: a.app.label ?? a.app.id, description: a.repo!.remote!.url, a })), { title: "Observe remote revision (git ls-remote, no clone)" }))?.a;
  if (!target) return;
  const obs = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "DataPass: git ls-remote" },
    () => observeRemoteRevision(gitRunner, target.repo!.remote!.url, target.repo!.remote!.branch, now()));
  await session.recordAppObservation(target.app.id, obs);
  const msg = obs.state === "observed" ? `${target.app.id}: ${obs.ref} is at ${obs.revision!.slice(0, 12)} (observed ${obs.observedAt}). This is the remote branch, not a deployment receipt.`
    : `${target.app.id}: ${obs.state}${obs.detail ? ` — ${obs.detail}` : ""}. Credentials are never prompted; use your normal Git credential helper.`;
  if (obs.state === "observed") void vscode.window.showInformationMessage(msg); else void vscode.window.showWarningMessage(msg);
}

// ---------------------------------------------------------------- candidates & impact

async function pickPack(session: WorkSession, needForms: boolean): Promise<DomainPack> {
  const packs = session.project.packs.filter(p => !needForms || p.forms?.length);
  if (!packs.length) throw new UserFacingError(needForms ? "No domain pack with parameter forms is loaded. Add one to `domainPacks` in the manifest (e.g. \"builtin:sample.retail\")." : "No domain pack is loaded. Add one to `domainPacks` in the manifest.");
  if (packs.length === 1) return packs[0]!;
  const p = await vscode.window.showQuickPick(packs.map(pk => ({ label: pk.title, description: `${pk.namespace}@${pk.version} · ${pk.mappingStatus}`, pk })), { title: "Domain pack" });
  if (!p) throw new Cancelled();
  return p.pk;
}

async function pickChangedRef(session: WorkSession, fileRel: string | undefined, pack: DomainPack): Promise<string> {
  const graph = session.project.graph;
  const byPath = fileRel ? graph?.items.find(i => i.path === fileRel) : undefined;
  if (byPath) return byPath.id;
  const refs = new Set<string>([...Object.values(graph?.roles ?? {}), ...pack.outputs.flatMap(o => o.dependsOn.map(d => graph?.roles?.[d.ref] ?? d.ref))]);
  const pick = await vscode.window.showQuickPick([...refs].map(r => ({ label: r })), { title: "Which input does this file represent?", placeHolder: "Tip: set `path` on the graph item so DataPass can resolve it automatically" });
  if (!pick) throw new Cancelled();
  return pick.label;
}

async function applyImpact(session: WorkSession, pack: DomainPack, ref: string, change: FacetChange, title: string): Promise<void> {
  const impact = analyzeImpact(resolveOutputs(session.project.graph, pack), new Map([[ref, change.facets]]));
  await session.setImpact(impact);
  report(title, [
    `Changed input: ${ref}`,
    `Facets: ${change.facets.join(", ") || "none"}${change.unmapped.length ? ` (unmapped pointers: ${change.unmapped.slice(0, 10).join(", ")}${change.unmapped.length > 10 ? "…" : ""})` : ""}`,
    ...impact.map(e => `  ${e.state.padEnd(24)} ${e.label}${e.reasons.length ? ` — ${e.reasons.join("; ")}` : ""}`),
    "Stale outputs remain valid historical results of their original inputs."
  ]);
}

async function createCandidateCmd(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const pack = await pickPack(session, true);
  const form = (await vscode.window.showQuickPick(pack.forms!.map(f => ({ label: f.title, description: f.schemaRef, f })), { title: "Parameter form" }))?.f;
  if (!form) return;
  const baseUri = await pickFile(`Select the accepted base file (${form.schemaRef})`, root, { JSON: ["json"] });
  const baseBytes = await readBounded(baseUri);
  const base = parseStrictJson(baseBytes);
  const fields = form.groups.flatMap(g => g.fields.map(f => ({ f, group: g.title })));
  const edits = new Map<string, unknown>();
  for (;;) {
    const choices = fields.map(({ f, group }) => {
      const current = edits.has(f.pointer) ? edits.get(f.pointer) : safeGet(base, f.pointer);
      const editable = EDITABLE_ROLES.has(f.role);
      return { label: `${editable ? "$(edit)" : "$(lock)"} ${f.label}`, description: `${fmt(current)}${f.unit ? ` ${f.unit}` : ""}${edits.has(f.pointer) ? " (edited)" : ""}`, detail: `${group} · ${f.role}${f.coupledToModel === false ? " · not coupled to the model" : ""}${f.help ? ` — ${f.help}` : ""}`, f, editable };
    });
    const pick = await vscode.window.showQuickPick([{ label: `$(check) Create candidate (${edits.size} edit${edits.size === 1 ? "" : "s"})`, done: true } as const, ...choices], { title: `${form.title} — reference fields are read-only`, matchOnDetail: true });
    if (!pick) return;
    if ("done" in pick) break;
    if (!pick.editable) { void vscode.window.showInformationMessage(`${pick.f.label} is ${pick.f.role}; it cannot be edited here.`); continue; }
    const value = await askFieldValue(pick.f, edits.has(pick.f.pointer) ? edits.get(pick.f.pointer) : safeGet(base, pick.f.pointer));
    if (value !== undefined) edits.set(pick.f.pointer, value);
  }
  if (!edits.size) return;
  const id = newLocalId("cand");
  const baseRel = relativeTo(root, baseUri) ?? baseUri.path.split("/").pop()!;
  let result;
  try {
    result = createCandidate({ id, pack, formId: form.id, baseRef: baseRel, baseBytes, base, edits: [...edits].map(([pointer, value]): FieldEdit => ({ pointer, value })), createdAt: now() });
  } catch (error) {
    if (error instanceof CandidateError) throw new UserFacingError(error.message);
    throw error;
  }
  const rel = `candidates/${id}.json`;
  await writeLocal(root, rel, jsonBytes(result.candidate));
  await writeLocal(root, `candidates/${id}.proposed.json`, jsonBytes(result.after));
  await session.recordExchange({ id, kind: "candidate", label: `Candidate: ${form.title} (${edits.size} edits)`, status: "candidate", file: `${LOCAL_DIR}/${rel}`, scopeRef: session.model().scope.id, at: now() });
  const ref = await pickChangedRef(session, relativeTo(root, baseUri), pack);
  await applyImpact(session, pack, ref, result.change, `Candidate ${id}`);
  void vscode.window.showInformationMessage(`Candidate ${id} saved. Validate it with the external kernel/validator before accepting; the base file was not modified.`);
}

async function analyzeImpactCmd(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const mode = await vscode.window.showQuickPick([{ label: "Compare two files", id: "compare" }, { label: "Clear impact analysis", id: "clear" }], { title: "Impact analysis" });
  if (!mode) return;
  if (mode.id === "clear") return session.setImpact(undefined);
  const pack = await pickPack(session, false);
  const beforeUri = await pickFile("Accepted (before) file", root, { JSON: ["json"] });
  const afterUri = await pickFile("Proposed (after) file", root, { JSON: ["json"] });
  const change = classifyChange(parseStrictJson(await readBounded(beforeUri)), parseStrictJson(await readBounded(afterUri)), pack.facets);
  const ref = await pickChangedRef(session, relativeTo(root, beforeUri), pack);
  await applyImpact(session, pack, ref, change, "Impact analysis");
}

// ---------------------------------------------------------------- publication

async function prepareBriefCmd(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid project manifest is required.");
  const regUri = vscode.Uri.joinPath(root, ...CLAIMS_REGISTER_PATH.split("/"));
  let regBytes: Uint8Array;
  try { regBytes = await readBounded(regUri); } catch {
    if (await confirmModal("No claims register found.", `Create ${CLAIMS_REGISTER_PATH}? Briefs are selected from reviewed claims with sources; DataPass never writes claims for you.`, "Create")) {
      await vscode.workspace.fs.writeFile(regUri, jsonBytes(emptyClaimsRegister()));
      await vscode.window.showTextDocument(regUri);
    }
    return;
  }
  const register = parseClaimsRegister(regBytes);
  const pack = session.project.packs[0];
  const templates = pack?.briefTemplates ?? [];
  const tpl = templates.length ? (await vscode.window.showQuickPick([...templates.map(t => ({ label: t.title, description: t.audience, t })), { label: "Custom brief", description: "choose audience", t: undefined }], { title: "Brief template" })) : { t: undefined };
  if (!tpl) return;
  const audience = tpl.t?.audience ?? (await vscode.window.showQuickPick(["internal", "named-reviewers", "public"], { title: "Audience" })) as Audience | undefined;
  if (!audience) return;
  const purpose = await vscode.window.showInputBox({ title: "Purpose", value: tpl.t?.purpose ?? "", validateInput: v => (v.trim() ? undefined : "Required") });
  if (!purpose) return;
  const formats = (await vscode.window.showQuickPick(["pptx", "pdf", "docx", "web"].map(f => ({ label: f, picked: f === "pptx" })), { title: "Requested output formats", canPickMany: true }))?.map(p => p.label) as PublicationBriefPayload["outputFormats"] | undefined;
  if (!formats?.length) return;
  const id = newLocalId("brief");
  const brief = prepareBrief({
    id, projectRef: safeId(manifest.project.id), scopeRef: safeId(session.model().scope.id), base: await session.captureBase(), createdAt: now(),
    audience, purpose, outputFormats: formats, claims: register.claims, sources: register.sources, assetRefs: []
  });
  const rel = `briefs/${id}.json`;
  await writeLocal(root, rel, brief.bytes);
  await session.recordExchange({ id, kind: "brief", label: `Brief (${audience}): ${purpose.slice(0, 60)}`, status: "draft", file: `${LOCAL_DIR}/${rel}`, digest: brief.digest.value, scopeRef: session.model().scope.id, at: now() });
  report(`Publication brief ${id}`, [
    `Audience ${audience} · formats ${formats.join(", ")} · ${brief.envelope.payload.claims.length} claim(s) included, ${brief.excluded.length} excluded`,
    ...(tpl.t ? [`Template sections: ${tpl.t.sections.join(" / ")}`] : []),
    ...brief.excluded.map(e => `  excluded ${e.claimId}: ${e.reason}`),
    ...(brief.missingApprovals.length ? [`Claims still in draft review: ${brief.missingApprovals.join(", ")}`] : []),
    `sha256 ${brief.digest.value}`,
    "State: draft · publication: not-authorized. Approve it for generation (local approval of these exact bytes) before handing it to an authoring tool."
  ]);
}

async function pickBrief(session: WorkSession, rec?: ExchangeRecord): Promise<ExchangeRecord> {
  const briefs = session.exchanges().filter(e => e.kind === "brief");
  const r = rec ?? (await vscode.window.showQuickPick(briefs.map(e => ({ label: e.label, description: e.status, detail: e.id, e })), { title: "Brief" }))?.e;
  if (!r?.file) throw new Cancelled();
  return r;
}

async function approveBrief(session: WorkSession, rec?: ExchangeRecord): Promise<void> {
  const root = requireRoot(session.root);
  const r = await pickBrief(session, rec);
  const bytes = await readBounded(vscode.Uri.joinPath(root, ...r.file!.split("/")));
  const env = parseEnvelope(bytes) as unknown as Envelope<"publication-brief", PublicationBriefPayload>;
  const digest = sha256Bytes(bytes).value;
  const drafts = env.payload.claims.filter(c => c.review !== "approved");
  const ok = await confirmModal(`Approve brief for generation (${env.payload.audience})?`, [
    `${env.payload.claims.length} claims · purpose: ${env.payload.purpose}`,
    drafts.length ? `${drafts.length} claim(s) are still draft: ${drafts.map(c => c.id).join(", ")}` : "All included claims are approved.",
    `sha256 ${digest}`,
    "This allows handing these exact bytes to an authoring tool. It does not approve publication of whatever the tool produces."
  ].join("\n"), "Approve for generation");
  if (!ok) return;
  await session.addApproval({ subjectDigest: digest, audience: env.payload.audience, scope: "generation", approvedBy: "local-user", approvedAt: now() });
  const trust = assessBriefTrust(bytes, session.approvals());
  await session.recordExchange({ ...r, status: trust.state });
  const act = await vscode.window.showInformationMessage(`Brief ${r.id}: ${trust.state}.`, "Copy brief");
  if (act) await clipboard.writeText(text(bytes));
}

async function importOutputManifest(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const r = await pickBrief(session);
  const briefBytes = await readBounded(vscode.Uri.joinPath(root, ...r.file!.split("/")));
  const trust = assessBriefTrust(briefBytes, session.approvals());
  const input = await readJsonInput("output manifest (datapass.output-manifest)", root);
  const files = await pickFiles("Select the produced files (pptx/pdf/…) to verify", root);
  const map = new Map<string, Uint8Array>();
  for (const f of files) map.set(f.path.split("/").pop()!, await readBounded(f, 64 * 1024 * 1024));
  const a = assessOutputManifest(briefBytes, input.bytes, map);
  const dir = `briefs/${r.id}-outputs-${Date.now().toString(36)}`;
  await writeLocal(root, `${dir}/output-manifest.json`, input.bytes);
  await writeLocal(root, `${dir}/assessment.json`, jsonBytes(a));
  await session.recordExchange({ id: `${r.id}.out.${Date.now().toString(36)}`, kind: "output-manifest", label: `Outputs for ${r.label}`, status: a.status, file: `${LOCAL_DIR}/${dir}/assessment.json`, scopeRef: r.scopeRef, at: now() });
  report(`Output manifest for ${r.id}`, [
    `Status: ${a.status}${trust.state !== "approved-for-generation" ? ` · brief was ${trust.state} when generated` : ""}`,
    ...a.reasons.map(x => `  ✗ ${x}`), ...a.warnings.map(x => `  ! ${x}`),
    ...a.fileChecks.map(f => `  ${f.file}: ${f.state}`),
    "Received ≠ reviewed ≠ publication approved."
  ]);
}

// ---------------------------------------------------------------- authority snapshots

async function importAuthoritySnapshot(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const input = await readJsonInput("authority snapshot (datapass.authority-snapshot)", root);
  const env = parseEnvelope(input.bytes);
  if (envelopeKind(env) !== "authority-snapshot") throw new UserFacingError(`Expected datapass.authority-snapshot, got ${env.format}.`);
  const snap = env as unknown as Envelope<"authority-snapshot", AuthoritySnapshotPayload>;
  const known = await reviewedQueryHashes(root);
  const d = describeSnapshot(snap, new Date(), { knownQueryHashes: known.size ? known : undefined });
  const rel = `snapshots/${snap.id}.json`;
  await writeLocal(root, rel, input.bytes);
  await session.recordExchange({ id: `snap.${snap.id}`, kind: "authority-snapshot", label: `Snapshot ${snap.payload.querySpecRef}`, status: d.state, file: `${LOCAL_DIR}/${rel}`, digest: sha256Bytes(input.bytes).value, scopeRef: session.model().scope.id, at: now() });
  report(`Authority snapshot ${snap.id} (${input.origin})`, [
    d.headline, ...d.details,
    known.size ? `Checked against ${known.size} reviewed QuerySpec(s) in .datapass/queries/.` : "No reviewed QuerySpecs in .datapass/queries/; the producing query was not verified.",
    `Usable as AI context: ${d.usableAsContext ? "yes, with the labels above" : "no"}. A snapshot is context, not an authority update.`
  ]);
}

async function reviewedQueryHashes(root: vscode.Uri): Promise<Set<string>> {
  const out = new Set<string>();
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, ".datapass/queries/*.json"), undefined, 100);
  for (const f of files) {
    try {
      const { spec, issues } = validateQuerySpec(parseStrictJson(await readBounded(f, 256 * 1024)));
      if (!issues.length) out.add(querySpecHash(spec).value);
    } catch { /* invalid specs are simply not reviewed */ }
  }
  return out;
}

// ---------------------------------------------------------------- DiagramCloud

async function exportDiagramCloud(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const graph = session.project.graph;
  if (!graph?.items.length) throw new UserFacingError("The project graph (.datapass/graph.json) has no items. Run \"DataPass: Initialize Project Graph\" and describe the architecture first.");
  const audience = (await vscode.window.showQuickPick([
    { label: "internal", detail: "Public + internal items; confidential and unclassified-as-confidential are omitted" },
    { label: "public", detail: "Only items explicitly classified public" }
  ], { title: "DiagramCloud projection audience" }))?.label as "public" | "internal" | undefined;
  if (!audience) return;
  const manifest = session.project.manifest;
  const documentId = safeId(`${manifest?.project.id ?? "datapass"}-${audience}`);
  const semanticRevision = sha256Bytes(JSON.stringify({ items: graph.items, relations: graph.relations })).value.slice(0, 16);
  const { document, sidecar, bytes } = projectToDiagramCloud({ documentId, title: manifest?.project.title ?? "DataPass architecture", audience, items: graph.items, relations: graph.relations ?? [], semanticRevision, layoutRevision: "auto-1" });
  const ok = await confirmModal(`Export ${document.nodes.length} nodes and ${document.edges.length} edges for a ${audience} audience?`, [
    sidecar.omitted.length ? `Omitted (${sidecar.omitted.length}): ${sidecar.omitted.slice(0, 12).map(o => `${o.ref} (${o.reason})`).join("; ")}${sidecar.omitted.length > 12 ? "…" : ""}` : "Nothing omitted.",
    ...sidecar.lossReport.slice(0, 6),
    "Node status is always idle: DiagramCloud animation is illustrative, not telemetry. Provenance stays in a private sidecar. Nothing is uploaded."
  ].join("\n"), "Save projection");
  if (!ok) return;
  const target = await vscode.window.showSaveDialog({ title: "Save DiagramCloud document", defaultUri: vscode.Uri.joinPath(root, `${documentId}.diagramcloud.json`), filters: { JSON: ["json"] } });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, bytes);
  await writeLocal(root, `diagramcloud/${documentId}.sidecar.json`, jsonBytes(sidecar));
  await session.recordExchange({ id: `dc.${documentId}.${Date.now().toString(36)}`, kind: "diagramcloud", label: `DiagramCloud ${audience} projection`, status: "exported-not-published", file: `${LOCAL_DIR}/diagramcloud/${documentId}.sidecar.json`, digest: sidecar.documentHash, scopeRef: session.model().scope.id, at: now() });
  void vscode.window.showInformationMessage(`Saved ${target.path.split("/").pop()}. Import it into DiagramCloud manually; a returned layout is not an architecture change.`);
}

// ---------------------------------------------------------------- Power BI

async function inspectPowerBi(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const exclude = "{**/node_modules/**,**/.git/**,**/.datapass/local/**}";
  const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/*.{pbip,pbir,pbism,tmdl,bim,json}"), exclude, 20000);
  const files = found.map(u => relativeTo(root, u)).filter((p): p is string => !!p && /\.(pbip|pbir|pbism|tmdl|bim)$|\.(Report|SemanticModel)\//.test(p));
  if (!files.some(f => f.endsWith(".pbip") || /\.(Report|SemanticModel)\//.test(f))) throw new UserFacingError("No Power BI Project (.pbip / *.Report / *.SemanticModel) found in this workspace.");
  const graph = await analyzePbip(files, async rel => {
    const vet = vetRelativePath(rel);
    if (!vet.ok) return undefined;
    try { return text(await readBounded(vscode.Uri.joinPath(root, ...vet.relative.split("/")), 512 * 1024)); } catch { return undefined; }
  });
  report("Power BI Project structure", [
    ...graph.entries.map(e => `PBIP ${e.pbip} → ${e.reports.join(", ") || "(no report)"}`),
    ...graph.reports.map(r => `Report ${r.folder}: ${r.format}${r.format === "pbir-legacy" ? " (report.json; PBIR folder format not in use)" : ""} · ${r.pageCount} page(s) · dataset ${r.datasetBinding.kind}${r.datasetBinding.kind === "byPath" ? ` → ${r.datasetBinding.semanticModelFolder}${r.datasetBinding.exists ? "" : " (MISSING)"}` : ""}`),
    ...graph.semanticModels.map(s => `Semantic model ${s.folder}: ${s.format}${s.format === "tmdl" ? ` (${s.tmdlFiles} .tmdl)` : ""} · tables ${s.tables.slice(0, 20).join(", ") || "?"}${s.tables.length > 20 ? "…" : ""} · consumers ${s.consumers.join(", ") || "none in workspace"}`),
    ...graph.issues.map(i => `  ! ${i}`),
    "Close Power BI Desktop before editing PBIP files externally; Desktop does not reload external changes while open.",
    "Source validity ≠ refresh success ≠ render correctness ≠ correct analytical results."
  ]);
}

// ---------------------------------------------------------------- AI context

async function copyAiContext(session: WorkSession): Promise<void> {
  const m = session.model();
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid project manifest is required.");
  const preset = (await vscode.window.showQuickPick([
    { label: "current-task", detail: "Scope, checklist and operation readiness" },
    { label: "missing-prerequisites", detail: "Only what blocks the next operations" },
    { label: "impact", detail: "Stale and affected outputs" },
    { label: "programme-summary", detail: "Programme views and outputs" }
  ], { title: "AI context preset (paste into ChatGPT/Claude manually)" }))?.label as ContextPreset | undefined;
  if (!preset) return;
  const ctx = buildAiContext(preset, {
    project: { id: manifest.project.id, title: manifest.project.title },
    scope: { id: m.scope.id, title: m.scope.title, objective: m.scope.objective },
    checklist: m.checklist.map(c => ({ label: c.label, state: c.state, note: c.note })),
    preflight: m.operations.map(o => ({ label: o.capability.label, result: o.result })),
    impact: m.outputs,
    programme: m.programme,
    packs: session.project.packs.map(p => ({ namespace: p.namespace, version: p.version, mappingStatus: p.mappingStatus }))
  });
  const choice = await vscode.window.showInformationMessage(`AI context: ${ctx.bytes} bytes, ${ctx.sections.length} section(s)${ctx.truncated ? ", TRUNCATED" : ""}.`, {
    modal: true,
    detail: `Sections: ${ctx.sections.join(", ") || "header only"}\nNever included: ${ctx.omissions.join(", ")}.`
  }, "Copy", "Preview");
  if (choice === "Preview") {
    const doc = await vscode.workspace.openTextDocument({ content: ctx.text, language: "markdown" });
    await vscode.window.showTextDocument(doc, { preview: true });
    return;
  }
  if (choice !== "Copy") return;
  await clipboard.writeText(ctx.text);
  await session.recordExchange({ id: newLocalId("ctx"), kind: "ai-context", label: `AI context: ${preset}`, status: "copied", digest: sha256Bytes(ctx.text).value, scopeRef: m.scope.id, at: now() });
}

// ---------------------------------------------------------------- manifest & graph

function workspaceJournalFs(root: vscode.Uri): JournalFs {
  const uri = (p: string) => {
    const vet = vetRelativePath(p);
    if (!vet.ok) throw new Error(`Refusing path ${p}: ${vet.reason}`);
    return vscode.Uri.joinPath(root, ...vet.relative.split("/"));
  };
  return {
    read: async p => { try { return await vscode.workspace.fs.readFile(uri(p)); } catch { return undefined; } },
    write: async (p, bytes) => { const u = uri(p); await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(u, "..")); await vscode.workspace.fs.writeFile(u, bytes); },
    remove: async p => { await vscode.workspace.fs.delete(uri(p)); }
  };
}

async function migrateManifest(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const ctx = session.project;
  if (!ctx.manifest || !ctx.manifestBytes) throw new UserFacingError("No valid manifest to migrate.");
  if (ctx.manifest.schemaVersion === 2) { void vscode.window.showInformationMessage("The manifest is already schemaVersion 2."); return; }
  const v2 = migrateManifestToV2(ctx.manifest);
  const errors = validateProjectManifest(v2);
  if (errors.length) throw new UserFacingError(`Migration produced an invalid manifest: ${errors.join("; ")}`);
  const fs = workspaceJournalFs(root);
  let backup = ".datapass/project.v1.json";
  if (await fs.read(backup)) backup = `.datapass/project.v1.${Date.now().toString(36)}.json`;
  if (!(await confirmModal("Upgrade .datapass/project.json to schemaVersion 2?", `A copy of the current file is written to ${backup}. Existing fields are preserved; v2 adds scopes, apps, domainPacks and remote-only repositories. Review the diff before committing.`, "Upgrade"))) return;
  const id = newLocalId("migrate");
  await applyWithJournal(fs, `${LOCAL_DIR}/journal/${id}.json`, id, now(), [
    { target: backup, bytes: ctx.manifestBytes, expectedBaseHash: null },
    { target: DATAPASS_MANIFEST_PATH, bytes: jsonBytes(v2), expectedBaseHash: sha256Bytes(ctx.manifestBytes).value }
  ]);
  await session.refresh();
  await openLocal(root, DATAPASS_MANIFEST_PATH);
}

async function initGraph(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const rel = session.project.manifest?.graph ?? ".datapass/graph.json";
  const vet = vetRelativePath(rel);
  if (!vet.ok) throw new UserFacingError(`Graph path rejected: ${vet.reason}`);
  const uri = vscode.Uri.joinPath(root, ...vet.relative.split("/"));
  try { await vscode.workspace.fs.stat(uri); await vscode.window.showTextDocument(uri); return; } catch { /* create */ }
  const graph: ProjectGraph = emptyGraph();
  const m = session.project.manifest;
  // Seed with what the manifest already declares; everything else is described by the user.
  for (const app of m?.apps ?? []) {
    if (isId(app.id)) graph.items.push({ id: app.id, kind: "application", label: app.label ?? app.id, ...(isId(app.repoRef) ? { repoRef: app.repoRef } : {}) } as ProjectGraph["items"][number]);
  }
  const bytes = jsonBytes(graph);
  parseGraph(bytes); // never write something we would reject on read
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, bytes);
  await vscode.window.showTextDocument(uri);
  await session.refresh();
}

async function validateContract(session: WorkSession, uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? await pickFile("Select a DataPass JSON file", session.root, { JSON: ["json"] });
  const bytes = await readBounded(target);
  const name = target.path.split("/").pop();
  let kind = "unknown";
  try {
    const doc = parseStrictJson(bytes) as { format?: unknown };
    const format = typeof doc?.format === "string" ? doc.format : "";
    if (envelopeKind(doc)) { kind = format; parseEnvelope(bytes); }
    else if (format === "datapass.domain-pack") { kind = format; parseDomainPack(bytes); }
    else if (format === "datapass.graph") { kind = format; parseGraph(bytes); }
    else if (format === "datapass.claims-register") { kind = format; parseClaimsRegister(bytes); }
    else if (format === "datapass.query-spec") { kind = format; const { issues } = validateQuerySpec(doc); if (issues.length) throw new Error(issues.join("; ")); }
    else if (doc && typeof doc === "object" && "schemaVersion" in doc && "project" in doc) { kind = "datapass project manifest"; const e = validateProjectManifest(doc); if (e.length) throw new Error(e.join("; ")); }
    else throw new Error(`Unrecognised format ${JSON.stringify(format).slice(0, 60)}`);
    void vscode.window.showInformationMessage(`${name}: valid ${kind}. Structural validity is not domain or scientific validity.`);
  } catch (error) {
    report(`Validation of ${name}`, [`Kind: ${kind}`, `✗ ${error instanceof Error ? error.message : String(error)}`]);
    void vscode.window.showWarningMessage(`${name}: invalid ${kind} — see DataPass Work output.`);
  }
}

// ---------------------------------------------------------------- helpers

function safeId(value: string): string {
  if (isId(value)) return value;
  const s = String(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 80);
  return isId(s) ? s : "project";
}

function safeGet(doc: unknown, pointer: string): unknown {
  try { return getPointer(doc, pointer); } catch { return undefined; }
}

function fmt(v: unknown): string {
  if (v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

async function askIds(title: string, initial: string[]): Promise<string[] | undefined> {
  const v = await vscode.window.showInputBox({ title, value: initial.join(", "), validateInput: s => s.split(",").map(x => x.trim()).filter(Boolean).find(x => !isId(x)) ? "Each ID must match ^[a-z][a-z0-9_.-]{0,79}$" : undefined });
  return v === undefined ? undefined : v.split(",").map(x => x.trim()).filter(Boolean);
}

async function askFieldValue(f: PackField, current: unknown): Promise<unknown> {
  if (f.type === "boolean") {
    const p = await vscode.window.showQuickPick(["true", "false"], { title: f.label });
    return p === undefined ? undefined : p === "true";
  }
  if (f.type === "enum") return vscode.window.showQuickPick(f.options ?? [], { title: f.label });
  const range = f.min !== undefined || f.max !== undefined ? ` [${f.min ?? "−∞"} … ${f.max ?? "∞"}]` : "";
  const raw = await vscode.window.showInputBox({
    title: `${f.label}${f.unit ? ` (${f.unit})` : ""}${range}`, prompt: f.help, value: current === undefined ? "" : String(current),
    validateInput: s => {
      if (f.type === "string") return s.length > 4000 ? "Too long" : undefined;
      const n = Number(s);
      if (!s.trim() || !Number.isFinite(n)) return "Enter a finite number";
      if (f.type === "integer" && !Number.isInteger(n)) return "Enter an integer";
      if (f.min !== undefined && n < f.min) return `Must be ≥ ${f.min}`;
      if (f.max !== undefined && n > f.max) return `Must be ≤ ${f.max}`;
      return undefined;
    }
  });
  if (raw === undefined) return undefined;
  return f.type === "string" ? raw : Number(raw);
}
