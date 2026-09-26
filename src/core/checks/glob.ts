/**
 * Minimal glob matching for include lists and COPY sources: `*` and `?` stay within one path
 * segment, `**` spans segments, `[abc]` is a character class. Nothing else is interpreted.
 */
import { SKIPPED_DIRS, type Budget, type CheckFs } from "./types";

export const hasGlob = (p: string) => /[*?[]/.test(p);

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close < 0) re += "\\[";
      else { re += "[" + glob.slice(i + 1, close).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]"; i = close; }
    } else re += /[.+^${}()|\\]/.test(c) ? "\\" + c : c;
  }
  return new RegExp("^" + re + "$");
}

/**
 * Files under `dir` (relative to the folder), bounded by the budget. `truncated` says the walk
 * stopped early, so a pattern that matched nothing may still match a file it did not reach.
 */
export async function listFiles(fs: CheckFs, dir: string, budget: Budget, counter = { n: 0 }): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue: Array<[string, number]> = [[dir, 0]];
  while (queue.length) {
    const [d, depth] = queue.shift()!;
    const entries = await fs.list(d);
    if (!entries) continue;
    for (const e of entries) {
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.type === "dir") {
        if (!SKIPPED_DIRS.has(e.name) && depth + 1 <= budget.maxDepth) queue.push([rel, depth + 1]);
      } else {
        if (++counter.n > budget.maxFiles) return { files, truncated: true };
        files.push(rel);
      }
    }
  }
  return { files, truncated: false };
}
