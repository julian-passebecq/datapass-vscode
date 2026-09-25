/**
 * The ID map (manifest v5 identifiers with a value per environment): which declared identifier a
 * GUID or id is. Pure. Values are explicitly non-secret (validated on load); a lookup answers with
 * the identifier's id, label, kind and environment, never with another value.
 */
import type { IdentifierDecl } from "../readiness/readiness";

export interface IdMatch { id: string; label: string; provider?: string; kind?: string; environment?: string }

/**
 * Identifiers whose value is `text` (ignoring case and surrounding blanks). When nothing matches
 * exactly, a longer text (a pasted portal address) matches the declared values it contains.
 * Values shorter than `minLength` are ignored (short ids would match by accident in a hover).
 */
export function lookupId(identifiers: readonly IdentifierDecl[], text: string, minLength = 4): IdMatch[] {
  const wanted = text.trim().toLowerCase();
  if (!wanted || wanted.length > 2000) return [];
  type Entry = { d: IdentifierDecl; env?: string; v: string };
  const entries = identifiers.flatMap((d): Entry[] => (d.values ? Object.entries(d.values).map(([env, v]) => ({ d, env, v })) : d.value ? [{ d, v: d.value }] : []))
    .filter(x => x.v.length >= minLength);
  const toMatch = (x: Entry): IdMatch => ({ id: x.d.id, label: x.d.label, provider: x.d.provider, kind: x.d.kind, ...(x.env ? { environment: x.env } : {}) });
  const exact = entries.filter(x => x.v.toLowerCase() === wanted);
  if (exact.length) return exact.slice(0, 10).map(toMatch);
  return entries.filter(x => x.v.length >= 8 && wanted.includes(x.v.toLowerCase())).slice(0, 10).map(toMatch);
}

export const idMatchText = (x: IdMatch) => `"${x.label}" (${x.id}${x.environment ? `, ${x.environment}` : ""}${x.provider || x.kind ? ` · ${[x.provider, x.kind].filter(Boolean).join(" ")}` : ""})`;
