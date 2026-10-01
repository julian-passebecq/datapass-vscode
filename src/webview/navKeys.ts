/**
 * V4-NAV NAVKEYS1: plain keys inside the navigation webviews (mini-map, graph, table, code-steps…).
 * One shared helper so every nav webview reacts the same way: arrows move through the ladder and the
 * views, Home goes to the project, Backspace goes back (Alt+Left/Right stay VS Code's own Back/Forward). Keys typed in an input, a textarea,
 * a select or an editable element are never taken, and neither are chords with Ctrl/Cmd (the webview's
 * own copy/find and VS Code's keybindings keep them). The key map is data: a webview may pass its own.
 * Pure (no `vscode`, no DOM types): the caller passes the event and posts the returned command
 * as `{type:"nav", command}`.
 */
import type { NavCommand } from "../core/navigation/navStub";

/** The parts of a KeyboardEvent this helper reads. */
export interface NavKeyEvent {
  readonly key: string;
  readonly altKey?: boolean; readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly shiftKey?: boolean;
  readonly defaultPrevented?: boolean; readonly isComposing?: boolean;
  readonly target?: unknown;
}

/** A key map entry: `alt` = Alt (Option) must be held, else it must not be. Shift is never used. */
export interface NavKeyBinding { readonly key: string; readonly alt?: boolean; readonly command: NavCommand["type"] }

/** Default webview key map. Up = coarser level, Down = finer, Left/Right = previous/next view. */
export const DEFAULT_NAV_KEYS: readonly NavKeyBinding[] = [
  { key: "ArrowUp", command: "up" },
  { key: "ArrowDown", command: "down" },
  { key: "ArrowLeft", command: "left" },
  { key: "ArrowRight", command: "right" },
  { key: "Home", command: "home" },
  { key: "Backspace", command: "back" }
];

const SIMPLE = new Set<NavCommand["type"]>(["up", "down", "left", "right", "home", "back", "forward"]);
const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when the event's target takes typing (inputs, editable content, ARIA text boxes and grids). */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown; getAttribute?: (n: string) => string | null };
  if (typeof t.tagName === "string" && TEXT_TAGS.has(t.tagName.toUpperCase())) return true;
  if (t.isContentEditable === true) return true;
  const role = typeof t.getAttribute === "function" ? t.getAttribute("role") : null;
  return role === "textbox" || role === "combobox" || role === "searchbox" || role === "spinbutton" || role === "slider";
}

/**
 * The nav command for a key event, or null when the key is not ours (typing target, modifier chord,
 * IME composition, already handled, or not in the map). `childId` = the current selection, for Down.
 */
export function navCommandForKey(e: NavKeyEvent, childId?: string, keys: readonly NavKeyBinding[] = DEFAULT_NAV_KEYS): NavCommand | null {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (isTypingTarget(e.target)) return null;
  const hit = keys.find(k => k.key === e.key && !!k.alt === !!e.altKey && SIMPLE.has(k.command));
  if (!hit) return null;
  if (hit.command === "down") return childId ? { type: "down", childId } : { type: "down" };
  return { type: hit.command } as NavCommand;
}

/** Validates a key map from settings or the host (untrusted): unknown entries are dropped; empty → default. */
export function parseNavKeys(raw: unknown): readonly NavKeyBinding[] {
  if (!Array.isArray(raw)) return DEFAULT_NAV_KEYS;
  const out: NavKeyBinding[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { key, alt, command } = r as Record<string, unknown>;
    if (typeof key !== "string" || !key || key.length > 32 || typeof command !== "string" || !SIMPLE.has(command as NavCommand["type"])) continue;
    out.push({ key, alt: alt === true, command: command as NavCommand["type"] });
  }
  return out.length ? out : DEFAULT_NAV_KEYS;
}
