/**
 * Backups of the project files DataPass writes (0.15). Pure naming and pruning; the session writes
 * them under `.datapass/local/backups/`, which ignores itself in Git.
 *
 * Git stays the real history (commit and push are the person's). These copies cover what Git does
 * not see yet: a decision recorded or an AI answer imported and not committed, then overwritten.
 */
export const BACKUP_SUBDIR = "backups";
export const BACKUPS_KEPT = 20;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "20260925-143012-512__.datapass~options.json": sortable, one flat folder, the original path readable. */
export function backupFileName(target: string, at: Date): string {
  const stamp = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}-${pad(at.getUTCMilliseconds(), 3)}`;
  return `${stamp}__${target.replace(/\\/g, "/").replace(/\//g, "~")}`;
}

export function parseBackupName(name: string): { at: string; target: string } | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})__(.+)$/.exec(name);
  if (!m) return undefined;
  const target = m[8]!.replace(/~/g, "/");
  if (target.includes("..") || target.startsWith("/")) return undefined;
  return { at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`, target };
}

/** Backups of `target` beyond the newest `keep`, oldest first: the ones to delete. */
export function backupsToPrune(names: readonly string[], target: string, keep = BACKUPS_KEPT): string[] {
  const mine = names.filter(n => parseBackupName(n)?.target === target).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}
