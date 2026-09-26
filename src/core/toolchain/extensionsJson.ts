/**
 * `.vscode/extensions.json` (workspace recommendations) compared with the toolchain's VS Code
 * extensions. Pure. The AI keeps the file in the repository; DataPass reads it, says what differs,
 * and offers VS Code's own "Show Recommended Extensions". It never writes the file and never
 * installs an extension.
 */
import { stripJsonc } from "../windows/company";
import { knownTools } from "./toolchain";
import type { ToolchainDecl } from "./toolchain";

export const EXTENSIONS_JSON = ".vscode/extensions.json";
export const MAX_EXTENSIONS_JSON_BYTES = 64 * 1024;
const EXTENSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type ExtensionsJsonObservation =
  | { state: "absent" }
  | { state: "invalid"; reason: string }
  | { state: "found"; recommendations: string[]; unwanted: string[] };

/** Parse the file (JSON with comments, like VS Code). Ids are kept as written; comparisons ignore case. */
export function parseExtensionsJson(bytes: Uint8Array | string): ExtensionsJsonObservation {
  const text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let doc: unknown;
  try { doc = JSON.parse(stripJsonc(text.replace(/^﻿/, ""))); } catch { return { state: "invalid", reason: "not valid JSON (comments are allowed)" }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { state: "invalid", reason: "must be an object with recommendations" };
  const d = doc as Record<string, unknown>;
  const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && EXTENSION_ID.test(x)).slice(0, 200) : [];
  if (d.recommendations !== undefined && !Array.isArray(d.recommendations)) return { state: "invalid", reason: "recommendations must be an array of extension ids" };
  return { state: "found", recommendations: list(d.recommendations), unwanted: list(d.unwantedRecommendations) };
}

export interface ExtensionsJsonView {
  state: ExtensionsJsonObservation["state"] | "no-toolchain";
  reason?: string;
  /** Toolchain extensions (this computer) and whether the file recommends them. */
  expected: Array<{ tool: string; label: string; extensionId: string; recommended: boolean; unwanted: boolean; optional: boolean }>;
  /** Recommended by the file but not in the toolchain (informational). */
  extra: string[];
}

export function compareExtensionsJson(toolchain: ToolchainDecl | undefined, obs: ExtensionsJsonObservation | undefined): ExtensionsJsonView {
  const catalog = knownTools();
  const expected = (toolchain?.tools ?? [])
    .filter(e => (e.where ?? "local") === "local")
    .map(e => ({ e, t: catalog.get(e.tool) }))
    .filter(({ t }) => t?.kind === "extension" && t.extensionIds?.length)
    .map(({ e, t }) => ({ e, t: t! }));
  if (!toolchain) return { state: "no-toolchain", expected: [], extra: [] };
  const found = obs?.state === "found" ? obs : undefined;
  const has = (list: readonly string[], ids: readonly string[]) => ids.some(id => list.some(x => x.toLowerCase() === id.toLowerCase()));
  const rows = expected.map(({ e, t }) => ({
    tool: t.id, label: t.label, extensionId: t.extensionIds![0]!, optional: e.optional === true,
    recommended: found ? has(found.recommendations, t.extensionIds!) : false,
    unwanted: found ? has(found.unwanted, t.extensionIds!) : false
  }));
  const allIds = expected.flatMap(({ t }) => t.extensionIds!.map(id => id.toLowerCase()));
  const extra = found ? found.recommendations.filter(r => !allIds.includes(r.toLowerCase())) : [];
  return { state: obs?.state ?? "absent", reason: obs?.state === "invalid" ? obs.reason : undefined, expected: rows, extra };
}

export function extensionsJsonText(v: ExtensionsJsonView): string {
  if (v.state === "no-toolchain") return "no toolchain declared";
  if (v.state === "invalid") return `could not be read: ${v.reason}`;
  if (!v.expected.length) return v.state === "absent" ? "absent · the toolchain names no VS Code extension" : `${v.extra.length} recommendation(s) · the toolchain names no VS Code extension`;
  const ok = v.expected.filter(x => x.recommended).length;
  if (v.state === "absent") return `absent · ${v.expected.length} toolchain extension(s) not recommended`;
  return `${ok}/${v.expected.length} toolchain extension(s) recommended${v.extra.length ? ` · ${v.extra.length} other` : ""}`;
}
