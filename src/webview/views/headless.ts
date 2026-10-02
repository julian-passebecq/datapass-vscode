/**
 * V5 EXPLAIN1 (TL-8): the view renderer in headless mode. The same node tree `screenModel` and every layout kind
 * build (`model.ts`) is serialised to static HTML instead of DOM elements, so an export reuses the renderer rather
 * than being a second one. Text and attribute values are escaped; `on` actions are dropped (a static page has no
 * host to post to). Inline SVG needs no namespace attribute in HTML, so none is written.
 */
import type { VNode } from "./model";

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "col", "wbr"]);
const TAG = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ATTR = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Node tree → HTML string. Unsafe tag or attribute names (and `on*` handlers) are never written. */
export function toHtml(n: VNode, inSvg = false): string {
  if (!TAG.test(n.tag)) return "";
  const svg = inSvg || n.tag === "svg";
  const attrs: [string, string][] = [];
  if (n.cls) attrs.push(["class", n.cls]);
  for (const [k, v] of Object.entries(n.attrs ?? {})) if (ATTR.test(k) && !/^on/i.test(k) && k !== "xmlns") attrs.push([k, v]);
  const open = `<${n.tag}${attrs.map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join("")}`;
  const kids = n.children ?? [];
  if (!svg && VOID.has(n.tag)) return `${open}>`;
  if (svg && n.text === undefined && !kids.length) return `${open}/>`;
  return `${open}>${n.text !== undefined ? escapeHtml(n.text) : ""}${kids.map(c => toHtml(c, svg)).join("")}</${n.tag}>`;
}
