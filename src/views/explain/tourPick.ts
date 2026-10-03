/**
 * V5 TOURSHARE1: the "Include tour…" step of the explainer export. Offers the tours a person sees in the
 * Navigator (built-in journeys + `.datapass/tours.json`, contract § EXPLAIN1), "No tour" first (the default).
 * Guided tours switched off (`datapass.guided.enabled`) = no step, no player. Words resolve through the
 * TOUR2 explanation registry, so later schemes (concept:, project:…) work here too.
 */
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import { explanationText, resolveExplanation } from "../../core/guided/explanations";
import { loadTourFile, TOURS_FILE, type LoadedTours } from "../../core/navigation/tours/store";
import type { Tour } from "../../core/navigation/tours/tourTypes";
import { playerTour, type PlayerTour } from "../../core/explain/tourPlayer";
import { labelPack } from "../navToursHtml";
import { navTours } from "../navTours";

export const EXPLAIN_EXPORT_TOUR_COMMAND = "datapass.explain.exportWithTour";

/** The export command's argument when a tour must be chosen (the "with a tour" command). */
export const wantsTour = (arg: unknown): boolean => !!arg && typeof arg === "object" && (arg as { includeTour?: unknown }).includeTour === true;

async function loadTours(root: vscode.Uri | undefined): Promise<{ loaded: LoadedTours; visible: readonly Tour[] }> {
  const live = navTours();
  if (live) { const loaded = live.loaded(); return { loaded, visible: live.visible(loaded.document.tours) }; }
  let text: string | undefined;
  if (root) { try { text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...TOURS_FILE))); } catch { text = undefined; } }
  const loaded = loadTourFile(text);
  return { loaded, visible: loaded.document.tours };
}

/** undefined = no tour (skipped or none offered); null = the person cancelled the export. */
export async function pickExportTour(host: NavHost, arg: unknown): Promise<PlayerTour | undefined | null> {
  const guided = vscode.workspace.getConfiguration("datapass.guided");
  const force = wantsTour(arg);
  if (!guided.get<boolean>("enabled", true)) {
    if (force) void vscode.window.showInformationMessage("DataPass: guided tours are off (setting datapass.guided.enabled).");
    return force ? null : undefined;
  }
  const { loaded, visible } = await loadTours(host.session.root);
  if (!visible.length) {
    if (force) { void vscode.window.showInformationMessage("DataPass: no tour to include yet (.datapass/tours.json or a journey tour)."); return null; }
    return undefined;
  }
  const guide = labelPack(guided.get("labels"));
  const texts = loaded.document.texts;
  // The page shows the tour's own title only; the "first → last" box names stay in the quick pick (never exported).
  const baseTitle = (t: Tour): string => explanationText(resolveExplanation(t.titleRef, { texts, guide, tour: t })) ?? t.id;
  const titleOf = (t: Tour): string => {
    const base = baseTitle(t);
    const first = t.steps[0], last = t.steps[t.steps.length - 1];
    return t.id.startsWith("datapass.journey.") && first && last ? `${base}: ${host.label(first.location)} → ${host.label(last.location)}` : base;
  };
  type Item = vscode.QuickPickItem & { tour?: Tour };
  const items: Item[] = [
    ...(force ? [] : [{ label: "$(close) No tour", description: "default", detail: "Export the page without a guided tour" }]),
    ...visible.map((t): Item => ({ label: titleOf(t), description: t.mode ?? "general", detail: `${t.steps.length} step(s) · ${t.id}`, tour: t }))
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "DataPass: include a tour in the explainer page?" });
  if (!pick) return null;
  if (!pick.tour) return undefined;
  const tour = pick.tour;
  return playerTour(tour, {
    title: baseTitle(tour),
    label: (l) => host.label(l),
    explain: (ref, step) => explanationText(resolveExplanation(ref, { texts, guide, tour, step, location: step.location }))
  });
}
