/**
 * Validation for the external web apps DataPass links to (DiagramCloud, Grafana).
 * Pure. A valid URL is only a well-formed, credential-free destination: it is not permission,
 * reachability, authentication or evidence that the service is healthy.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_URL_LENGTH = 2048;

/**
 * https://…, or http:// on a loopback host for a local dev server. Credentials, query strings
 * and fragments are refused (they are where tokens and project data end up), as are whitespace,
 * backslashes, control/bidi characters and percent-encoded control bytes. Returns the normalized
 * href, or undefined.
 */
export function safeAppUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > MAX_URL_LENGTH) return undefined;
  if (/[\s\\?#]/u.test(value) || /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u.test(value)) return undefined;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.username || url.password || !url.hostname || url.search || url.hash) return undefined;
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return url.href;
  return undefined;
}

/** The href without a trailing slash, for appending fixed path segments. */
export function baseOf(href: string): string {
  return href.replace(/\/+$/, "");
}

/** Host (and non-default port) for short labels; never the path, which can carry names. */
export function hostLabel(href: string): string {
  try { return new URL(href).host; } catch { return "invalid URL"; }
}
