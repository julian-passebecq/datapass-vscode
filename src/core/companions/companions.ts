/**
 * Optional companion web apps for the selected scope: Grafana (operational observability). Pure
 * and deterministic.
 *
 * DataPass builds reviewed links from the project manifest. It makes no HTTP request, opens no
 * database connection, runs no timer and stores no credential. A link is navigation only: it is
 * not evidence that the service is reachable, that the user is signed in, or that dashboards show
 * fresh data.
 */
import { baseOf, hostLabel, safeAppUrl } from "../model/safeUrl";
import { vetRelativePath } from "../exchange/pathSafety";
import type { DataPassProjectManifest } from "../projectManifestModel";
import { moduleEnabled } from "../modules";

export const GRAFANA_UID = /^[A-Za-z0-9_-]{1,40}$/;
export const WHOLE_PROJECT = "project";
export const MAX_DASHBOARDS = 50;
/** Companion keys older manifests may still carry: accepted and ignored, never shown. */
export const LEGACY_COMPANION_KEYS: readonly string[] = ["mongoku"];

export type CompanionService = "grafana";

export interface CompanionLink {
  /** Stable within a scope; the command resolves it again from current state before opening. */
  id: string;
  service: CompanionService;
  label: string;
  url: string;
  /** Workspace-relative dashboard-as-code file, when declared. */
  source?: string;
}

export interface GrafanaCompanion { host: string; links: CompanionLink[] }

export interface ResolvedCompanions {
  grafana?: GrafanaCompanion;
}

export interface CompanionInput {
  manifest: DataPassProjectManifest | undefined;
  scopeId: string;
}

/** Scope applicability: an omitted scopes list means every scope, including the whole project. */
const appliesTo = (scopes: readonly string[] | undefined, scopeId: string) => !scopes?.length || scopes.includes(scopeId);

export function resolveCompanions(input: CompanionInput): ResolvedCompanions {
  const out: ResolvedCompanions = {};
  const grafana = input.manifest?.platforms?.grafana;
  const grafanaUrl = moduleEnabled(input.manifest, "grafana") ? safeAppUrl(grafana?.url) : undefined;
  if (grafanaUrl) {
    const base = baseOf(grafanaUrl);
    const links: CompanionLink[] = [
      { id: "grafana.home", service: "grafana", label: "Open Grafana", url: `${base}/` },
      { id: "grafana.explore", service: "grafana", label: "Explore (logs, metrics, traces)", url: `${base}/explore` }
    ];
    for (const d of grafana?.dashboards ?? []) {
      if (!GRAFANA_UID.test(d.uid) || !appliesTo(d.scopes, input.scopeId)) continue;
      const source = d.source !== undefined ? vetRelativePath(d.source) : undefined;
      links.push({ id: `grafana.dashboard:${d.uid}`, service: "grafana", label: d.title, url: `${base}/d/${d.uid}`, source: source?.ok ? source.relative : undefined });
    }
    out.grafana = { host: hostLabel(grafanaUrl), links };
  }
  return out;
}

export function companionLinks(resolved: ResolvedCompanions): CompanionLink[] {
  return [...(resolved.grafana?.links ?? [])];
}

// ---------------------------------------------------------------- manifest validation

/**
 * Validate `platforms.grafana.{url,dashboards}` and `companions`. Scope references must name a
 * declared scope or the whole project, so renaming a scope reports a problem instead of links
 * silently disappearing.
 */
export function validateCompanionSections(doc: Record<string, unknown>, declaredScopes: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const scopeRef = (value: unknown, where: string) => {
    if (typeof value !== "string" || (value !== WHOLE_PROJECT && !declaredScopes.has(value))) issues.push(`${where} must name a declared scope or "${WHOLE_PROJECT}".`);
  };
  const platforms = doc.platforms as Record<string, unknown> | undefined;
  const grafana = platforms && typeof platforms === "object" ? platforms.grafana : undefined;
  if (grafana !== undefined) {
    if (!grafana || typeof grafana !== "object" || Array.isArray(grafana)) issues.push("platforms.grafana must be an object.");
    else {
      const g = grafana as Record<string, unknown>;
      for (const key of ["generatorCommand", "watchPath"]) if (g[key] !== undefined && typeof g[key] !== "string") issues.push(`platforms.grafana.${key} must be a string.`);
      if (g.url !== undefined && !safeAppUrl(g.url)) issues.push("platforms.grafana.url must be https:// (or http://localhost) without credentials, query or fragment.");
      if (g.dashboards !== undefined) {
        if (!Array.isArray(g.dashboards) || g.dashboards.length > MAX_DASHBOARDS) issues.push(`platforms.grafana.dashboards must be an array of at most ${MAX_DASHBOARDS}.`);
        else {
          if (g.url === undefined && g.dashboards.length) issues.push("platforms.grafana.dashboards needs platforms.grafana.url.");
          const seen = new Set<string>();
          g.dashboards.forEach((raw, i) => {
            const d = raw as Record<string, unknown>;
            const where = `platforms.grafana.dashboards[${i}]`;
            if (!d || typeof d !== "object" || Array.isArray(d)) { issues.push(`${where} must be an object.`); return; }
            for (const key of Object.keys(d)) if (!["uid", "title", "scopes", "source"].includes(key)) issues.push(`${where}.${key} is not allowed.`);
            if (typeof d.uid !== "string" || !GRAFANA_UID.test(d.uid)) issues.push(`${where}.uid must be a Grafana dashboard UID (letters, digits, - and _, at most 40).`);
            else if (seen.has(d.uid)) issues.push(`${where}.uid is duplicated.`);
            else seen.add(d.uid);
            if (typeof d.title !== "string" || !d.title.trim() || d.title.length > 100) issues.push(`${where}.title is required (at most 100 characters).`);
            if (d.scopes !== undefined) {
              if (!Array.isArray(d.scopes)) issues.push(`${where}.scopes must be an array.`);
              else d.scopes.forEach((s, j) => scopeRef(s, `${where}.scopes[${j}]`));
            }
            if (d.source !== undefined && (typeof d.source !== "string" || !vetRelativePath(d.source).ok)) issues.push(`${where}.source must be a workspace-relative path.`);
          });
        }
      }
    }
  }

  if (doc.companions !== undefined) {
    const c = doc.companions as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || Array.isArray(c)) return [...issues, "companions must be an object."];
    // Legacy keys from older manifests load without error and are ignored.
    for (const key of Object.keys(c)) if (!LEGACY_COMPANION_KEYS.includes(key)) issues.push(`companions.${key} is not a known companion.`);
  }
  return issues;
}
