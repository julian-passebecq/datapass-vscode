/**
 * Dockerfile and docker-compose checks, read only. A Dockerfile needs a `FROM` before anything
 * but `ARG`; its `COPY`/`ADD` sources must exist in the build context (assumed to be the
 * Dockerfile's folder, the common case). A compose file's `build.context`, `dockerfile` and
 * `env_file` paths must exist; env files are only stat'ed, never read.
 */
import { expandGlob } from "./dab";
import { hasGlob } from "./glob";
import { parseYaml } from "./syntax";
import { at, isMap, isSeq, keyOf, pairOf, str, valueOf } from "./yamlNodes";
import { baseOf, dirOf, finding, joinRel, type Budget, type CheckFs, type Finding } from "./types";

export const isDockerfile = (rel: string) => /^(dockerfile|containerfile)(\..+)?$|\.dockerfile$/i.test(baseOf(rel));
export const isCompose = (rel: string) => /^(docker-)?compose(\.[\w.-]+)?\.ya?ml$/i.test(baseOf(rel));

interface Instruction { name: string; args: string; line: number }

/** Logical instructions: comments dropped, line continuations joined, heredoc bodies skipped. */
export function instructions(text: string): Instruction[] {
  const lines = text.split(/\r?\n/);
  let escape = "\\";
  for (const l of lines) { // parser directives come first, before any instruction or comment
    const m = /^#\s*escape\s*=\s*([\\`])\s*$/i.exec(l);
    if (m) { escape = m[1]!; continue; }
    if (!/^#\s*\w+\s*=/.test(l)) break;
  }
  const out: Instruction[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i]!;
    if (/^\s*(#|$)/.test(first)) continue;
    const start = i;
    let body = first;
    while (body.trimEnd().endsWith(escape) && i + 1 < lines.length) {
      body = body.trimEnd().slice(0, -1) + " ";
      i++;
      while (i < lines.length && /^\s*#/.test(lines[i]!)) i++; // comments inside a continuation
      if (i < lines.length) body += lines[i]!;
    }
    const m = /^\s*([A-Za-z]+)\s*(.*)$/.exec(body);
    if (!m) continue;
    out.push({ name: m[1]!.toUpperCase(), args: m[2]!, line: start });
    for (const h of body.matchAll(/<<-?\s*["']?([A-Za-z_][\w]*)["']?/g)) { // heredoc: skip to its terminator
      const word = h[1]!;
      while (i + 1 < lines.length && lines[i + 1]!.trim() !== word) i++;
      i++;
    }
  }
  return out;
}

function sources(args: string): string[] | undefined {
  const a = args.trim();
  let parts: string[];
  if (a.startsWith("[")) {
    try { const v = JSON.parse(a); if (!Array.isArray(v) || !v.every(x => typeof x === "string")) return undefined; parts = v; } catch { return undefined; }
  } else parts = a.split(/\s+/).filter(Boolean);
  const flags = parts.filter(p => p.startsWith("--"));
  if (flags.some(f => f.startsWith("--from"))) return undefined; // from another stage or image
  const rest = parts.filter(p => !p.startsWith("--"));
  if (rest.some(p => p.startsWith("<<"))) return undefined; // heredoc content, not a file
  return rest.length >= 2 ? rest.slice(0, -1) : undefined;
}

export async function checkDockerfile(fs: CheckFs, file: string, text: string, budget: Budget): Promise<Finding[]> {
  const out: Finding[] = [];
  const ins = instructions(text);
  const firstFrom = ins.findIndex(i => i.name === "FROM");
  if (firstFrom < 0) out.push(finding(file, "docker.from", "error", "No `FROM` instruction: a Dockerfile must start from a base image.", { line: 0, col: 0 }));
  else {
    const early = ins.slice(0, firstFrom).find(i => i.name !== "ARG");
    if (early) out.push(finding(file, "docker.from", "error", `\`${early.name}\` comes before the first \`FROM\`; only \`ARG\` may.`, { line: early.line, col: 0, endCol: early.name.length }));
  }
  const context = dirOf(file);
  for (const i of ins) {
    if (i.name !== "COPY" && i.name !== "ADD") continue;
    for (const src of sources(i.args) ?? []) {
      if (src.includes("$") || /^[a-z][a-z0-9+.-]*:\/\//i.test(src) || src.startsWith("git@")) continue; // ARG, URL, Git
      const rel = joinRel(context, src.replace(/^\/+/, ""));
      if (rel === undefined) continue;
      const exists = hasGlob(src) ? (await expandGlob(fs, context, src.replace(/^\/+/, ""), budget)).files.length > 0 : !!(await fs.stat(rel));
      if (!exists) out.push(finding(file, "docker.copy-source", "warning",
        `\`${i.name} ${src}\`: \`${rel || "."}\` is not in the build context (taken as this Dockerfile's folder; a different context set by compose or CI is not checked).`,
        { line: i.line, col: 0, endCol: i.name.length }));
    }
  }
  return out;
}

export async function checkCompose(fs: CheckFs, file: string, text: string): Promise<Finding[]> {
  const parsed = parseYaml(file, text);
  if (!parsed.doc) return []; // yaml.syntax reports it
  const out: Finding[] = [];
  const dir = dirOf(file);
  const services = valueOf(parsed.doc.contents, "services");
  if (!isMap(services)) return out;
  const skip = (p: string) => p.includes("${") || p.includes("://") || p.startsWith("git@");
  for (const svc of services.items) {
    const name = keyOf(svc) ?? "?";
    const build = pairOf(svc.value, "build");
    if (build) {
      const ctxNode = isMap(build.value) ? valueOf(build.value, "context") : build.value;
      const ctx = str(ctxNode) ?? (isMap(build.value) ? "." : undefined);
      if (ctx !== undefined && !skip(ctx)) {
        const ctxRel = joinRel(dir, ctx);
        if (ctxRel !== undefined) {
          const s = await fs.stat(ctxRel);
          if (s?.type !== "dir") out.push(finding(file, "compose.build-context", "error", `Service \`${name}\`: build context \`${ctx}\` is not a folder next to this file.`, at(ctxNode ?? build.key, parsed.lines)));
          else if (isMap(build.value) && !pairOf(build.value, "dockerfile_inline")) {
            const dfNode = valueOf(build.value, "dockerfile");
            const df = str(dfNode) ?? (dfNode === undefined ? "Dockerfile" : undefined);
            const dfRel = df && !skip(df) ? joinRel(ctxRel, df) : undefined;
            if (dfRel !== undefined && (await fs.stat(dfRel))?.type !== "file" && (dfNode !== undefined || !(await fs.stat(joinRel(ctxRel, "Containerfile")!))))
              out.push(finding(file, "compose.build-context", "error", `Service \`${name}\`: Dockerfile \`${dfRel}\` does not exist.`, at(dfNode ?? build.key, parsed.lines)));
          }
        }
      }
    }
    const env = pairOf(svc.value, "env_file");
    if (env) {
      const items = isSeq(env.value) ? env.value.items : [env.value];
      for (const item of items) {
        const pathNode = isMap(item) ? valueOf(item, "path") : item;
        const required = isMap(item) ? (valueOf(item, "required") as { value?: unknown } | undefined)?.value !== false : true;
        const p = str(pathNode);
        if (!p || !required || skip(p)) continue;
        const rel = joinRel(dir, p);
        if (rel !== undefined && (await fs.stat(rel))?.type !== "file")
          out.push(finding(file, "compose.env-file", "error", `Service \`${name}\`: env_file \`${p}\` does not exist (DataPass checks the path only, never reads it). Use \`required: false\` if it is optional.`, at(pathNode, parsed.lines)));
      }
    }
  }
  return out;
}
