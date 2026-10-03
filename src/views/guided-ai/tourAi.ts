/**
 * TOURAI1 host: "Ask the AI for a guided tour" through the manual AI exchange (no hidden AI call).
 * `datapass.nav.tour.askAi` writes a tour request file in the exchange folder (`datapass.guided.ai.requestFolder`) and copies it for a topic (setting `datapass.guided.ai.topics`) with the
 * project's Location index and views; the requested generation is remembered per tour id (workspace state)
 * so the import keeps the request's include/exclude; the paste-back flow gets its import context here.
 * Off (`datapass.guided.enabled` or `datapass.guided.ai.enabled` false): the command is not registered and
 * nothing is computed (go/TOUR-PEDA-contract.md § 6).
 */
import * as vscode from "vscode";
import type { WorkSession } from "../../work/session";
import { clipboard } from "../../core/clipboard";
import { readOptional } from "../../core/workspace/loader";
import { newLocalId, sha256Bytes } from "../../core/model/ids";
import { DEFAULT_VIEW_CATALOG, resolveViews, type NavLocation } from "../../core/navigation/navTypes";
import { locationLabel, projectLadder } from "../../core/navigation/projectLadder";
import { checkTours, type TourGeneration, type TourMode } from "../../core/navigation/tours/tourTypes";
import { buildTourRequest, parseTopicPresets, presetGeneration, tourIdFor, tourRequestFile, tourRequestFolder, TOURS_PATH, type TourImportContext } from "../../core/guided-ai/tourExchange";
import { vetRelativePath } from "../../core/exchange/pathSafety";

const REQUESTED_KEY = "datapass.guided.ai.requested";
type Requested = Record<string, { generation?: TourGeneration; mode?: TourMode }>;
let state: vscode.Memento | undefined;

export function guidedAiEnabled(): boolean {
  const c = vscode.workspace.getConfiguration("datapass.guided");
  return c.get<boolean>("enabled", true) !== false && c.get<boolean>("ai.enabled", true) !== false;
}

export function registerTourAi(context: vscode.ExtensionContext, session: WorkSession, version: string, reg: (id: string, fn: (...args: any[]) => Promise<void>) => void): void {
  state = context.workspaceState;
  if (!guidedAiEnabled()) return;
  reg("datapass.nav.tour.askAi", async () => { await copyTourRequest(session, version); });
}

// TODO(REPIN, NAVCAT1): pass nav.overrides so saved views count (contract § 2); the built-in catalog until then.
const viewsAt = (l: NavLocation) => resolveViews(DEFAULT_VIEW_CATALOG, null, l.artifactKind, l.level);

/** Every Location on the project ladder (bounded, cycle-safe). */
function ladderLocations(session: WorkSession, limit = 5000): NavLocation[] {
  const ladder = projectLadder(() => session.projectMap());
  const out: NavLocation[] = [];
  const seen = new Set<string>();
  const queue = [ladder.root()];
  while (queue.length && out.length < limit) {
    const l = queue.shift()!;
    const k = `${l.level}\u0000${l.nodeId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    queue.push(...ladder.children(l));
  }
  return out;
}

async function currentTours(session: WorkSession): Promise<string | undefined> {
  if (!session.root) return undefined;
  const b = await readOptional(vscode.Uri.joinPath(session.root, ...TOURS_PATH.split("/")));
  return b ? new TextDecoder().decode(b) : undefined;
}

/** The context the paste-back flow needs to check a tour answer; undefined while guided AI tours are off. */
export async function tourImportContext(session: WorkSession): Promise<TourImportContext | undefined> {
  if (!guidedAiEnabled()) return undefined;
  return { locations: ladderLocations(session), viewsAt, requested: state?.get<Requested>(REQUESTED_KEY) ?? {}, currentText: await currentTours(session) };
}

/** Pick a topic and copy the tour request; returns the tours path, or undefined when cancelled or off. */
export async function copyTourRequest(session: WorkSession, version: string, quiet = false): Promise<string | undefined> {
  if (!guidedAiEnabled()) { void vscode.window.showInformationMessage("DataPass: AI guided tours are off (setting datapass.guided.ai.enabled)."); return undefined; }
  const { presets, problems } = parseTopicPresets(vscode.workspace.getConfiguration("datapass.guided.ai").get("topics"));
  if (problems.length) void vscode.window.showWarningMessage(`DataPass: ${problems[0]}`);
  if (!presets.length) { void vscode.window.showInformationMessage("DataPass: no tour topic in the setting datapass.guided.ai.topics."); return undefined; }
  const pick = await vscode.window.showQuickPick(presets.map((p) => ({ label: p.label, detail: p.ask?.slice(0, 150), p })), { title: "Guided tour: which topic should the AI prepare?" });
  if (!pick) return undefined;
  const map = session.projectMap();
  const current = await currentTours(session);
  let existing: string[] = [];
  try { existing = current ? checkTours(JSON.parse(current)).document.tours.map((t) => t.id) : []; } catch { /* unreadable: the import says so */ }
  const tourId = tourIdFor(pick.p.id, existing);
  const locations = ladderLocations(session).map((location) => ({ location, label: locationLabel(map, location), views: viewsAt(location).map((v) => ({ id: v.id, title: v.title })) }));
  const text = buildTourRequest({ tourId, topic: pick.p, locations, projectTitle: session.project.manifest?.project.title, dataPassVersion: version });
  // AI exchange contract: the request is a file in the exchange folder; the clipboard is a convenience.
  const file = tourRequestFile(tourId, pick.p.id, text, new Date().toISOString(), tourRequestFolder(vscode.workspace.getConfiguration("datapass.guided.ai").get("requestFolder")));
  if (session.root) {
    const vet = vetRelativePath(file.path);
    if (vet.ok) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(session.root, ...vet.relative.split("/")), new TextEncoder().encode(file.text));
  }
  await clipboard.writeText(text);
  const generation = presetGeneration(pick.p);
  const requested: Requested = { ...(state?.get<Requested>(REQUESTED_KEY) ?? {}), [tourId]: { ...(generation ? { generation } : {}), ...(pick.p.mode ? { mode: pick.p.mode } : {}) } };
  await state?.update(REQUESTED_KEY, Object.fromEntries(Object.entries(requested).slice(-50)));
  await session.recordExchange({ id: newLocalId("ai-file"), kind: "ai-context", label: `${TOURS_PATH} tour request (${pick.p.id})`, status: "copied", digest: sha256Bytes(text).value, scopeRef: session.model().scope.id, at: new Date().toISOString() });
  if (!quiet) void vscode.window.showInformationMessage(`Wrote ${file.path} and copied the guided-tour request (${pick.p.label}). Paste it into ChatGPT or Claude, then paste its complete answer in the AI exchange view.`, "Open the AI exchange")
    .then((c) => { if (c) void vscode.commands.executeCommand("datapass.showAiExchange", "tour"); });
  return TOURS_PATH;
}
