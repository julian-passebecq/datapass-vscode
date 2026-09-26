/** Structural equality for parsed JSON values (object key order is irrelevant). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => jsonEqual(v, bb[i]));
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const ak = Object.keys(ao), bk = Object.keys(bo);
  return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
}
