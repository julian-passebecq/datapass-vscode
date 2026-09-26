/**
 * Integration evidence chain (D-22, FOIL review R-03). For a tool or an MCP server, what DataPass
 * has actually seen, link by link:
 *
 *   known → installed → registered in a host → connected → authenticated identity →
 *   authorized target → operation verified
 *
 * Each link is `observed` (it holds or it does not, with the source and the time of the
 * observation), `unknown` (the default, always with a reason) or `not-applicable` (a CLI is not
 * registered in a host). Nothing is inferred from another link: a registration file does not make
 * a server connected, a sign-in does not make a target authorized, an installed CLI does not make
 * it signed in. Pure; no file is read here, and DataPass never reads another tool's credential
 * files to fill a link.
 */

export const LINKS = ["known", "installed", "registered", "connected", "authenticated", "authorized", "verified"] as const;
export type LinkId = typeof LINKS[number];

export const LINK_LABELS: Readonly<Record<LinkId, { yes: string; no: string; name: string }>> = {
  known: { yes: "known", no: "not in DataPass's registry", name: "known to DataPass" },
  installed: { yes: "installed", no: "not installed", name: "installed" },
  registered: { yes: "registered", no: "not registered", name: "registered in a host" },
  connected: { yes: "connected", no: "not connected", name: "connected" },
  authenticated: { yes: "signed in", no: "not signed in", name: "authenticated identity" },
  authorized: { yes: "authorized", no: "not authorized", name: "authorized on the target" },
  verified: { yes: "verified", no: "operation failed", name: "operation verified" }
};

export type EvidenceLink =
  | { link: LinkId; state: "observed"; holds: boolean; source: string; at?: string; detail?: string }
  | { link: LinkId; state: "unknown"; reason: string }
  | { link: LinkId; state: "not-applicable"; reason: string };

export type Observations = Partial<Record<LinkId, EvidenceLink>>;

export const unknown = (link: LinkId, reason: string): EvidenceLink => ({ link, state: "unknown", reason });
export const observed = (link: LinkId, holds: boolean, source: string, at?: string, detail?: string): EvidenceLink =>
  ({ link, state: "observed", holds, source, ...(at ? { at } : {}), ...(detail ? { detail } : {}) });
export const notApplicable = (link: LinkId, reason: string): EvidenceLink => ({ link, state: "not-applicable", reason });

const DEFAULT_REASON = "not observed by DataPass";

/**
 * The full chain: every link DataPass has no observation for is `unknown`. A link is never filled
 * from another one: the caller passes only what it saw.
 */
export function buildChain(obs: Observations = {}, reasons: Partial<Record<LinkId, string>> = {}): EvidenceLink[] {
  return LINKS.map(id => {
    const o = obs[id];
    return o && o.link === id ? o : unknown(id, reasons[id] ?? DEFAULT_REASON);
  });
}

/**
 * One line: the furthest link observed to hold with every applicable link before it observed too,
 * then what stops the chain. "installed / not registered", "signed in · authorized unknown".
 * `known` is not a step a person reaches, so it only shows when it does not hold.
 */
export function chainSummary(chain: readonly EvidenceLink[]): string {
  const known = chain.find(l => l.link === "known");
  const prefix = known?.state === "observed" && !known.holds ? `${LINK_LABELS.known.no} · ` : "";
  let reached: LinkId | undefined;
  for (const l of chain) {
    if (l.link === "known" || l.state === "not-applicable") continue;
    if (l.state === "observed" && l.holds) { reached = l.link; continue; }
    const head = reached ? LINK_LABELS[reached].yes : undefined;
    const stop = l.state === "observed" ? LINK_LABELS[l.link].no : `${LINK_LABELS[l.link].name} unknown`;
    return prefix + (head ? `${head} / ${stop}` : stop);
  }
  return prefix + (reached ? LINK_LABELS[reached].yes : "nothing observed");
}

/** The tone of a chain: ok when the operation is verified, bad when an observed link fails, else muted. */
export function chainTone(chain: readonly EvidenceLink[]): "ok" | "warn" | "muted" {
  if (chain.some(l => l.state === "observed" && !l.holds && l.link !== "known")) return "warn";
  const v = chain.find(l => l.link === "verified");
  return v?.state === "observed" && v.holds ? "ok" : "muted";
}

/** A line per link, for reports, tooltips and Details. */
export function linkText(l: EvidenceLink): string {
  const name = LINK_LABELS[l.link].name;
  if (l.state === "observed") return `${name}: ${l.holds ? "yes" : "no"} — observed (${l.source}${l.at ? `, ${l.at}` : ""})${l.detail ? ` · ${l.detail}` : ""}`;
  if (l.state === "not-applicable") return `${name}: does not apply — ${l.reason}`;
  return `${name}: unknown — ${l.reason}`;
}
