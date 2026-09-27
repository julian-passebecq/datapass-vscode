/**
 * V3-AIRFLOW: read an Airflow DAG out of a Python file's text, statically.
 *
 * Nothing is executed and no Python is started: a small tokenizer (strings and comments are
 * skipped, so text inside them never counts) builds logical lines, a tiny expression reader
 * understands the handful of shapes Airflow DAG files use (operator calls with `task_id=`,
 * TaskFlow `@task` functions and their calls, `>>` / `<<`, lists, `chain()`,
 * `cross_downstream()`, `set_upstream/set_downstream`, `with TaskGroup`, `@task_group`), and
 * everything else is reported as "not resolved statically" with its lines — never guessed.
 * Tasks built in loops, under conditions, in comprehensions or by plain helper functions are
 * reported, not drawn. Bounded: files over 512 KB are not read, at most 500 tasks are drawn.
 * Pure (no `vscode`, no `fs`).
 */

export const AIRFLOW_LIMITS = { maxBytes: 512 * 1024, maxTasks: 500 } as const;

export type TaskKind = "python" | "bash" | "databricks" | "spark" | "sql" | "sensor" | "container" | "notify" | "empty" | "trigger" | "other";

export interface DagTask {
  /** Airflow's task id (with its task-group prefix, as Airflow names it). */
  id: string;
  /** The task id without its group prefix. */
  label: string;
  /** Operator class, or `@task` / `@task.bash`… for TaskFlow. */
  operator: string;
  kind: TaskKind;
  /** 1-based lines of the code that defines the task. */
  startLine: number;
  endLine: number;
  /** TaskFlow: the line where the task is called (instantiated). */
  callLine?: number;
  group?: string;
  mapped?: boolean;
  taskflow?: boolean;
  /** Index in `dags`. */
  dag: number;
}

export interface DagEdge { from: string; to: string; line: number }
export interface Unresolved { startLine: number; endLine: number; reason: string }
export interface DagInfo { dagId?: string; schedule?: string; line: number }

export interface DagExtraction {
  detected: boolean;
  /** Why the file is not shown as a DAG (when `detected` is false). */
  reason?: string;
  dags: DagInfo[];
  tasks: DagTask[];
  edges: DagEdge[];
  unresolved: Unresolved[];
  truncated: boolean;
}

// ---------------------------------------------------------------- tokenizer

type TokType = "name" | "str" | "num" | "op";
interface Tok { t: TokType; v: string; s: number; e: number; line: number; endLine: number; fstr?: boolean; dynamic?: boolean }
interface Line { toks: Tok[]; indent: number; start: number; end: number }

const OPS3 = [">>=", "<<=", "**=", "//=", "..."];
const OPS2 = [">>", "<<", "**", "//", "->", ":=", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@="];
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;

function tokenize(src: string): Line[] {
  const lines: Line[] = [];
  let i = 0, line = 1, depth = 0;
  let cur: Tok[] = [];
  let lineStartCol = 0, curIndent = 0, atLineStart = true;
  const flush = () => {
    if (cur.length) lines.push({ toks: cur, indent: curIndent, start: cur[0]!.line, end: cur[cur.length - 1]!.endLine });
    cur = [];
  };
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === "\n") {
      line++; i++; lineStartCol = i;
      if (depth === 0) { flush(); atLineStart = true; }
      continue;
    }
    if (c === "\r" || c === " " || c === "\t" || c === "\f") { i++; continue; }
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      i += src[i + 1] === "\n" ? 2 : 3; line++; lineStartCol = i; continue;
    }
    if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
    if (atLineStart) { curIndent = i - lineStartCol; atLineStart = false; }
    // Strings, with their prefixes.
    const pm = /^([rRbBuUfF]{0,2})(['"])/.exec(src.slice(i, i + 3));
    if (pm && (pm[1] === "" || !NAME_PART.test(src[i - 1] ?? " "))) {
      const prefix = pm[1]!.toLowerCase();
      const q = pm[2]!;
      const start = i, startLine = line;
      i += pm[1]!.length;
      const triple = src.startsWith(q.repeat(3), i);
      const close = triple ? q.repeat(3) : q;
      i += close.length;
      const bodyStart = i;
      let bodyEnd = -1;
      while (i < n) {
        const d = src[i]!;
        if (d === "\\") { if (src[i + 1] === "\n") line++; i += 2; continue; }
        if (d === "\n") { if (!triple) break; line++; i++; continue; }
        if (src.startsWith(close, i)) { bodyEnd = i; i += close.length; break; }
        i++;
      }
      if (bodyEnd < 0) bodyEnd = i;
      const body = src.slice(bodyStart, bodyEnd);
      const fstr = prefix.includes("f");
      cur.push({ t: "str", v: prefix.includes("r") ? body : unescape(body), s: start, e: i, line: startLine, endLine: line, fstr, dynamic: fstr && /\{[^{]/.test(body.replace(/\{\{/g, "")) });
      continue;
    }
    if (NAME_START.test(c)) {
      const s = i;
      while (i < n && NAME_PART.test(src[i]!)) i++;
      cur.push({ t: "name", v: src.slice(s, i), s, e: i, line, endLine: line });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const s = i;
      while (i < n && /[0-9a-zA-Z_.]/.test(src[i]!)) i++;
      cur.push({ t: "num", v: src.slice(s, i), s, e: i, line, endLine: line });
      continue;
    }
    const op = OPS3.find(o => src.startsWith(o, i)) ?? OPS2.find(o => src.startsWith(o, i)) ?? c;
    if (op === "(" || op === "[" || op === "{") depth++;
    else if ((op === ")" || op === "]" || op === "}") && depth > 0) depth--;
    cur.push({ t: "op", v: op, s: i, e: i + op.length, line, endLine: line });
    i += op.length;
  }
  flush();
  return lines;
}

function unescape(s: string): string {
  return s.replace(/\\(["'\\nt])/g, (_, ch: string) => ch === "n" ? "\n" : ch === "t" ? "\t" : ch);
}

// ---------------------------------------------------------------- expressions

type Node =
  | { t: "name"; v: string; s: number; e: number; line: number }
  | { t: "attr"; obj: Node; v: string; s: number; e: number; line: number }
  | { t: "call"; fn: Node; args: Node[]; kw: Array<{ k: string; v: Node }>; s: number; e: number; line: number; endLine: number }
  | { t: "list"; items: Node[]; s: number; e: number; line: number }
  | { t: "str"; tok: Tok; s: number; e: number; line: number }
  | { t: "shift"; op: ">>" | "<<"; l: Node; r: Node; s: number; e: number; line: number }
  | { t: "sub"; base: Node; s: number; e: number; line: number }
  | { t: "other"; s: number; e: number; line: number; hasTaskId: boolean };

const CLOSERS = new Set([")", "]", "}"]);

class Parser {
  i = 0;
  constructor(private readonly toks: Tok[], private readonly from = 0, private readonly to = toks.length) { this.i = from; }
  peek(k = 0): Tok | undefined { return this.i + k < this.to ? this.toks[this.i + k] : undefined; }
  isOp(v: string, k = 0) { const t = this.peek(k); return !!t && t.t === "op" && t.v === v; }
  done() { return this.i >= this.to; }

  /** Skip to the next top-level `,` or closer (or the end), returning an opaque node. */
  skip(startTok: Tok | undefined): Node {
    const s = startTok?.s ?? 0, line = startTok?.line ?? 0;
    let depth = 0, hasTaskId = false, e = s;
    while (!this.done()) {
      const t = this.peek()!;
      if (t.t === "op") {
        if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
        else if (CLOSERS.has(t.v)) { if (depth === 0) break; depth--; }
        else if (t.v === "," && depth === 0) break;
      }
      if (t.t === "name" && t.v === "task_id") hasTaskId = true;
      e = t.e; this.i++;
    }
    return { t: "other", s, e, line, hasTaskId };
  }

  expr(): Node {
    const start = this.peek();
    let left = this.primary();
    while (this.isOp(">>") || this.isOp("<<")) {
      const op = this.peek()!.v as ">>" | "<<";
      this.i++;
      const right = this.primary();
      left = { t: "shift", op, l: left, r: right, s: left.s, e: right.e, line: left.line };
    }
    const next = this.peek();
    if (next && !(next.t === "op" && (next.v === "," || CLOSERS.has(next.v) || next.v === "=" || next.v === ":")) && !(next.t === "name" && next.v === "as")) {
      // Another operator (`+`, `if`, `for`, …): not a shape DataPass reads.
      const rest = this.skip(start) as Extract<Node, { t: "other" }>;
      return { ...rest, hasTaskId: rest.hasTaskId || containsTaskId(left) };
    }
    return left;
  }

  primary(): Node {
    const t = this.peek();
    if (!t) return { t: "other", s: 0, e: 0, line: 0, hasTaskId: false };
    let node: Node;
    if (t.t === "name" && !KEYWORDS.has(t.v)) { this.i++; node = { t: "name", v: t.v, s: t.s, e: t.e, line: t.line }; }
    else if (t.t === "str") {
      this.i++;
      let tok = t;
      while (this.peek()?.t === "str") { const x = this.toks[this.i++]!; tok = { ...tok, v: tok.v + x.v, e: x.e, dynamic: tok.dynamic || x.dynamic }; } // implicit concatenation
      node = { t: "str", tok, s: t.s, e: tok.e, line: t.line };
    }
    else if (t.t === "op" && (t.v === "[" || t.v === "(")) {
      const close = t.v === "[" ? "]" : ")";
      this.i++;
      const items: Node[] = [];
      let comma = false;
      while (!this.done() && !this.isOp(close)) {
        if (this.isOp(",")) { this.i++; comma = true; continue; }
        const before = this.i;
        items.push(this.expr());
        if (this.i === before) { items.push(this.skip(this.peek())); if (this.i === before) this.i++; }
      }
      const end = this.peek();
      if (end) this.i++;
      node = t.v === "(" && items.length === 1 && !comma ? items[0]! : { t: "list", items, s: t.s, e: end?.e ?? t.e, line: t.line };
    }
    else return this.skip(t);
    for (;;) {
      if (this.isOp(".") && this.peek(1)?.t === "name") {
        const nameTok = this.peek(1)!;
        this.i += 2;
        node = { t: "attr", obj: node, v: nameTok.v, s: node.s, e: nameTok.e, line: node.line };
      } else if (this.isOp("(")) {
        this.i++;
        const args: Node[] = [], kw: Array<{ k: string; v: Node }> = [];
        while (!this.done() && !this.isOp(")")) {
          if (this.isOp(",")) { this.i++; continue; }
          const before = this.i;
          const a = this.peek()!;
          if (a.t === "name" && this.isOp("=", 1)) { this.i += 2; kw.push({ k: a.v, v: this.expr() }); }
          else if (a.t === "op" && (a.v === "*" || a.v === "**")) { this.i++; args.push(this.skip(a)); }
          else args.push(this.expr());
          if (this.i === before) { args.push(this.skip(this.peek())); if (this.i === before) this.i++; }
        }
        const end = this.peek();
        if (end) this.i++;
        node = { t: "call", fn: node, args, kw, s: node.s, e: end?.e ?? node.e, line: node.line, endLine: end?.endLine ?? node.line };
      } else if (this.isOp("[")) {
        const s = this.peek()!;
        let depth = 0;
        while (!this.done()) { const x = this.toks[this.i++]!; if (x.t === "op" && x.v === "[") depth++; else if (x.t === "op" && x.v === "]" && --depth === 0) break; }
        node = { t: "sub", base: node, s: node.s, e: s.e, line: node.line };
      } else break;
    }
    return node;
  }
}

const KEYWORDS = new Set(["lambda", "not", "if", "else", "for", "in", "and", "or", "await", "yield", "return", "is"]);

function containsTaskId(n: Node): boolean {
  switch (n.t) {
    case "call": return n.kw.some(k => k.k === "task_id") || containsTaskId(n.fn) || n.args.some(containsTaskId) || n.kw.some(k => containsTaskId(k.v));
    case "attr": return containsTaskId(n.obj);
    case "sub": return containsTaskId(n.base);
    case "list": return n.items.some(containsTaskId);
    case "shift": return containsTaskId(n.l) || containsTaskId(n.r);
    case "other": return n.hasTaskId;
    default: return false;
  }
}

const dotted = (n: Node): string | undefined =>
  n.t === "name" ? n.v : n.t === "attr" ? (dotted(n.obj) ? `${dotted(n.obj)}.${n.v}` : undefined) : undefined;
const lastSeg = (s: string) => s.slice(s.lastIndexOf(".") + 1);

// ---------------------------------------------------------------- evaluation

type Val =
  | { k: "tasks"; ids: string[]; xcom?: boolean }
  | { k: "group"; name: string }
  | { k: "list"; items: Val[] }
  | { k: "dag"; index: number }
  | { k: "tfn"; fn: TaskflowFn }
  | { k: "gfn"; fn: GroupFn }
  | { k: "factory"; name: string; start: number; end: number }
  | { k: "dagfn" }
  | { k: "unknown"; why?: string; line?: number; quiet?: boolean };

interface TaskflowFn { name: string; taskId: string; operator: string; kind: TaskKind; start: number; end: number; calls: number; dynamicId?: boolean }
interface GroupFn { name: string; groupId?: string; start: number; end: number; bodyFrom: number; bodyTo: number; calls: number }

interface Ctx { dag?: number; group?: string; env: Env }
class Env {
  private readonly vars = new Map<string, Val>();
  constructor(private readonly parent?: Env) {}
  get(k: string): Val | undefined { return this.vars.get(k) ?? this.parent?.get(k); }
  set(k: string, v: Val) { this.vars.set(k, v); }
}

type Endpoint = { task: string } | { group: string };
interface RawEdge { from: Endpoint; to: Endpoint; line: number }

const UNKNOWN: Val = { k: "unknown" };
const DYNAMIC_HEADERS = new Set(["for", "while", "if", "elif", "else", "try", "except", "finally", "match", "case"]);
const LINK_FUNCS = new Set(["chain", "chain_linear", "cross_downstream"]);

class Extractor {
  readonly dags: DagInfo[] = [];
  readonly tasks: DagTask[] = [];
  readonly unresolved: Unresolved[] = [];
  readonly groups = new Set<string>();
  private readonly edges: RawEdge[] = [];
  private readonly taskIds = new Set<string>();
  truncated = false;

  constructor(private readonly src: string, private readonly lines: Line[]) {}

  run(): void {
    this.block(0, this.lines.length, { env: new Env() });
  }

  private unresolvedAt(start: number, end: number, reason: string) {
    if (!this.unresolved.some(u => u.startLine === start && u.reason === reason)) this.unresolved.push({ startLine: start, endLine: end, reason });
  }

  /** Index of the first line after the block whose header is `lines[h]`. */
  private blockEnd(h: number, to: number): number {
    const ind = this.lines[h]!.indent;
    let j = h + 1;
    while (j < to && this.lines[j]!.indent > ind) j++;
    return j;
  }

  private text(s: number, e: number): string { return this.src.slice(s, e).replace(/\s+/g, " ").trim(); }

  /** Whether the lines [from, to) build tasks or wire them (so skipping them hides something). */
  private buildsTasks(from: number, to: number, env: Env): boolean {
    for (let j = from; j < to; j++) if (tokensBuildTasks(this.lines[j]!.toks, env)) return true;
    return false;
  }


  private block(from: number, to: number, ctx: Ctx): void {
    let decorators: Array<{ line: Line; node: Node }> = [];
    for (let i = from; i < to;) {
      const ln = this.lines[i]!;
      const first = ln.toks[0]!;
      if (first.t === "op" && first.v === "@") {
        const p = new Parser(ln.toks, 1);
        decorators.push({ line: ln, node: p.expr() });
        i++;
        continue;
      }
      const kw = first.t === "name" ? (first.v === "async" ? ln.toks[1]?.v : first.v) : undefined;
      const end = this.blockEnd(i, to);
      const lastLine = this.lines[end - 1]!.end;
      if (kw === "def" || kw === "class") {
        const nameTok = ln.toks[first.v === "async" ? 2 : 1];
        const startLine = decorators[0]?.line.start ?? ln.start;
        if (kw === "def" && nameTok?.t === "name") this.def(nameTok.v, decorators, ln, i + 1, end, startLine, lastLine, ctx);
        decorators = [];
        i = end;
        continue;
      }
      decorators = [];
      if (kw === "with") { this.withBlock(ln, i + 1, end, ctx); i = end; continue; }
      if (kw && DYNAMIC_HEADERS.has(kw)) {
        const isMain = kw === "if" && ln.toks.some(t => t.t === "name" && t.v === "__name__");
        if (!isMain && this.buildsTasks(i, end, ctx.env)) {
          const loop = kw === "for" || kw === "while";
          this.unresolvedAt(ln.start, lastLine, loop ? `Tasks or dependencies built in a \`${kw}\` loop` : `Tasks or dependencies under \`${kw}\``);
        }
        i = end;
        continue;
      }
      if (kw === "from" || kw === "import" || kw === "return" || kw === "pass" || kw === "global" || kw === "nonlocal" || kw === "assert" || kw === "raise" || kw === "del") { i = end; continue; }
      this.statement(ln, ctx);
      i = end;
    }
  }

  private def(name: string, decorators: Array<{ line: Line; node: Node }>, header: Line, bodyFrom: number, bodyTo: number, startLine: number, endLine: number, ctx: Ctx): void {
    for (const d of decorators) {
      const callee = d.node.t === "call" ? d.node.fn : d.node;
      const full = dotted(callee) ?? "";
      const kwOf = (k: string) => d.node.t === "call" ? d.node.kw.find(x => x.k === k)?.v : undefined;
      const segs = full.split(".");
      if (lastSeg(full) === "dag" && segs.length <= 2) {
        const index = this.addDag(d.node.t === "call" ? d.node : undefined, header.start, name);
        ctx.env.set(name, { k: "dagfn" });
        this.block(bodyFrom, bodyTo, { dag: index, group: undefined, env: new Env(ctx.env) });
        return;
      }
      if (lastSeg(full) === "task_group") {
        const g = kwOf("group_id") ?? (d.node.t === "call" ? d.node.args[0] : undefined);
        const groupId = g?.t === "str" && !g.tok.dynamic ? g.tok.v : g ? undefined : name;
        ctx.env.set(name, { k: "gfn", fn: { name, groupId, start: startLine, end: endLine, bodyFrom, bodyTo, calls: 0 } });
        return;
      }
      const ti = segs.indexOf("task");
      if (ti >= 0 && ti >= segs.length - 2) {
        const flavour = segs[ti + 1];
        const idNode = kwOf("task_id");
        const dynamicId = !!idNode && !(idNode.t === "str" && !idNode.tok.dynamic);
        const taskId = idNode?.t === "str" && !idNode.tok.dynamic ? idNode.tok.v : name;
        const operator = flavour ? `@task.${flavour}` : "@task";
        ctx.env.set(name, { k: "tfn", fn: { name, taskId, operator, kind: kindOf(flavour ?? "python"), start: startLine, end: endLine, calls: 0, dynamicId } });
        return;
      }
    }
    // A plain function that creates or wires tasks: its tasks exist only when it is called.
    if (this.buildsTasks(bodyFrom, bodyTo, ctx.env) || this.lines.slice(bodyFrom, bodyTo).some(l => l.toks.some(t => t.t === "name" && /Operator$|Sensor$/.test(t.v)))) {
      ctx.env.set(name, { k: "factory", name, start: startLine, end: endLine });
    }
  }

  private withBlock(ln: Line, bodyFrom: number, bodyTo: number, ctx: Ctx): void {
    const toks = ln.toks;
    const colon = topLevelIndex(toks, ":", 1);
    const p = new Parser(toks, 1, colon < 0 ? toks.length : colon);
    let inner: Ctx = { ...ctx };
    while (!p.done()) {
      if (p.isOp(",")) { p.i++; continue; }
      const before = p.i;
      const node = p.expr();
      let asName: string | undefined;
      if (p.peek()?.t === "name" && p.peek()!.v === "as" && p.peek(1)?.t === "name") { asName = p.peek(1)!.v; p.i += 2; }
      if (node.t === "call") {
        const last = lastSeg(dotted(node.fn) ?? "");
        if (last === "DAG") {
          const index = this.addDag(node, node.line);
          inner = { ...inner, dag: index };
          if (asName) ctx.env.set(asName, { k: "dag", index });
        } else if (last === "TaskGroup") {
          const g = node.kw.find(x => x.k === "group_id")?.v ?? node.args[0];
          if (!(g?.t === "str" && !g.tok.dynamic)) {
            this.unresolvedAt(ln.start, this.lines[bodyTo - 1]!.end, "Task group whose name is computed");
            return;
          }
          const name = inner.group ? `${inner.group}.${g.tok.v}` : g.tok.v;
          this.groups.add(name);
          inner = { ...inner, group: name };
          if (asName) ctx.env.set(asName, { k: "group", name });
        }
      }
      if (p.i === before) p.i++;
    }
    if (colon >= 0 && colon < toks.length - 1) this.statement({ toks: toks.slice(colon + 1), indent: ln.indent + 1, start: toks[colon + 1]!.line, end: ln.end }, inner);
    this.block(bodyFrom, bodyTo, inner);
  }

  private addDag(call: Extract<Node, { t: "call" }> | undefined, line: number, fnName?: string): number {
    const info: DagInfo = { line };
    const idNode = call?.kw.find(x => x.k === "dag_id")?.v ?? call?.args[0];
    if (idNode?.t === "str" && !idNode.tok.dynamic) info.dagId = idNode.tok.v;
    else if (!idNode && fnName) info.dagId = fnName;
    const sched = call?.kw.find(x => x.k === "schedule" || x.k === "schedule_interval" || x.k === "timetable")?.v;
    if (sched) {
      const raw = sched.t === "str" && !sched.tok.dynamic ? sched.tok.v : this.text(sched.s, sched.e);
      info.schedule = raw === "None" ? "None (runs only when triggered)" : raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
    }
    this.dags.push(info);
    return this.dags.length - 1;
  }

  private statement(ln: Line, ctx: Ctx): void {
    const toks = ln.toks;
    if (toks.some(t => t.t === "name" && (t.v === "for" || t.v === "lambda")) && tokensBuildTasks(toks, ctx.env)) {
      this.unresolvedAt(ln.start, ln.end, "Tasks built in a comprehension or lambda");
      return;
    }
    // Targets of `a = b = expr`.
    const targets: string[] = [];
    let from = 0, tupleTarget = false;
    for (;;) {
      const eq = topLevelIndex(toks, "=", from);
      if (eq < 0) break;
      const target = toks.slice(from, eq);
      if (target.length === 1 && target[0]!.t === "name") targets.push(target[0]!.v);
      else tupleTarget = true;
      from = eq + 1;
    }
    if (from >= toks.length) return;
    const p = new Parser(toks, from);
    const vals: Val[] = [];
    while (!p.done()) {
      if (p.isOp(",")) { p.i++; continue; }
      const before = p.i;
      const node = p.expr();
      if (node.t === "other" && node.hasTaskId) { this.unresolvedAt(ln.start, ln.end, "Task defined in an expression DataPass does not read"); return; }
      vals.push(this.eval(node, ctx, ln));
      if (p.i === before) p.i++;
    }
    const val: Val = vals.length === 1 ? vals[0]! : { k: "list", items: vals };
    for (const t of targets) ctx.env.set(t, val);
    if (tupleTarget && (val.k === "tasks" || val.k === "list")) this.unresolvedAt(ln.start, ln.end, "Tasks unpacked into several names");
  }

  private eval(n: Node, ctx: Ctx, stmt: Line): Val {
    switch (n.t) {
      case "name": {
        const v = ctx.env.get(n.v);
        return !v || (v.k === "unknown" && !v.why && !v.quiet) ? { k: "unknown", why: n.v, line: n.line } : v;
      }
      case "list": return { k: "list", items: n.items.map(x => this.eval(x, ctx, stmt)) };
      case "shift": {
        const l = this.eval(n.l, ctx, stmt);
        // `a >> Label("why") >> b`: the label names the edge, the dependency is a >> b.
        if (n.r.t === "call" && lastSeg(dotted(n.r.fn) ?? "") === "Label") return l;
        const r = this.eval(n.r, ctx, stmt);
        const [a, b] = n.op === ">>" ? [l, r] : [r, l];
        if (a.k === "list" && b.k === "list") { this.unresolvedAt(stmt.start, stmt.end, "A list cannot be linked to a list with >> (Airflow refuses it)"); return r; }
        this.link(a, b, n.line, stmt);
        return r;
      }
      case "call": return this.call(n, ctx, stmt);
      case "attr": {
        // `op.output` is the task's XCom: passing it to another task makes a dependency.
        const o = this.eval(n.obj, ctx, stmt);
        return n.v === "output" && o.k === "tasks" ? { ...o, xcom: true } : UNKNOWN;
      }
      case "sub": {
        // `extract()["key"]` is still the extract task; an item of a list is not known.
        const b = this.eval(n.base, ctx, stmt);
        return b.k === "tasks" && b.ids.length === 1 ? b : b.k === "unknown" ? b : { k: "unknown", why: this.text(n.s, n.e), line: n.line };
      }
      case "other": if (n.hasTaskId) this.unresolvedAt(stmt.start, stmt.end, "Task defined in an expression DataPass does not read"); return UNKNOWN;
      default: return UNKNOWN;
    }
  }

  private call(n: Extract<Node, { t: "call" }>, ctx: Ctx, stmt: Line): Val {
    const fn = n.fn;
    // x.set_downstream(y) / x.set_upstream(y)
    if (fn.t === "attr" && (fn.v === "set_downstream" || fn.v === "set_upstream")) {
      const self = this.eval(fn.obj, ctx, stmt), other = n.args[0] ? this.eval(n.args[0], ctx, stmt) : UNKNOWN;
      if (fn.v === "set_downstream") this.link(self, other, n.line, stmt); else this.link(other, self, n.line, stmt);
      return UNKNOWN;
    }
    // Dynamic task mapping: X(...).expand(...), X.partial(...).expand(...), fn.expand(...).
    let mapped = false;
    let core: Extract<Node, { t: "call" }> = n;
    const extraArgs: Node[] = [];
    if (fn.t === "attr" && (fn.v === "expand" || fn.v === "expand_kwargs")) {
      mapped = true;
      extraArgs.push(...n.args, ...n.kw.map(k => k.v));
      if (fn.obj.t === "call") core = fn.obj;
      else core = { ...n, fn: fn.obj, args: [], kw: [] };
    }
    if (core.fn.t === "attr" && core.fn.v === "partial") { mapped = true; core = { ...core, fn: core.fn.obj }; }
    // fn.override(task_id=…)(args)
    let override: Node | undefined;
    if (core.fn.t === "call" && core.fn.fn.t === "attr" && core.fn.fn.v === "override") {
      override = core.fn.kw.find(k => k.k === "task_id")?.v;
      core = { ...core, fn: core.fn.fn.obj };
    }
    const name = dotted(core.fn) ?? "";
    const last = lastSeg(name);
    const target = core.fn.t === "name" ? ctx.env.get(core.fn.v) : undefined;

    if (LINK_FUNCS.has(last) && !target) {
      const vals = n.args.map(a => this.eval(a, ctx, stmt));
      if (last === "cross_downstream") { if (vals[0] && vals[1]) this.link(vals[0], vals[1], n.line, stmt); return UNKNOWN; }
      for (let i = 0; i + 1 < vals.length; i++) {
        const a = vals[i]!, b = vals[i + 1]!;
        if (last === "chain" && a.k === "list" && b.k === "list") {
          if (a.items.length !== b.items.length) { this.unresolvedAt(stmt.start, stmt.end, "chain() of two lists of different lengths"); continue; }
          a.items.forEach((x, j) => this.link(x, b.items[j]!, n.line, stmt));
        } else this.link(a, b, n.line, stmt);
      }
      return UNKNOWN;
    }
    if (target?.k === "tfn") {
      const f = target.fn;
      const args = [...core.args, ...core.kw.map(k => k.v), ...extraArgs].map(a => this.eval(a, ctx, stmt));
      let id: string | undefined;
      if (override) id = override.t === "str" && !override.tok.dynamic ? override.tok.v : undefined;
      else if (!f.dynamicId) id = f.calls === 0 ? f.taskId : `${f.taskId}__${f.calls}`;
      f.calls++;
      if (!id) { this.unresolvedAt(stmt.start, stmt.end, `Task id of ${f.name}() is computed`); return UNKNOWN; }
      const created = this.addTask(id, f.operator, f.kind, f.start, f.end, ctx, { callLine: n.line, mapped, taskflow: true });
      if (!created) return UNKNOWN;
      for (const a of args) this.link(a, created, n.line, stmt, true);
      return created.k === "tasks" ? { ...created, xcom: true } : created;
    }
    if (target?.k === "gfn") {
      const g = target.fn;
      g.calls++;
      if (g.calls > 1 || !g.groupId) { this.unresolvedAt(stmt.start, stmt.end, g.groupId ? `Task group ${g.name}() used more than once` : `Task group ${g.name}() has a computed name`); return UNKNOWN; }
      const group = ctx.group ? `${ctx.group}.${g.groupId}` : g.groupId;
      this.groups.add(group);
      this.block(g.bodyFrom, g.bodyTo, { dag: ctx.dag, group, env: new Env(ctx.env) });
      const val: Val = { k: "group", name: group };
      for (const a of [...core.args, ...core.kw.map(k => k.v)]) this.link(this.eval(a, ctx, stmt), val, n.line, stmt, true);
      return val;
    }
    if (target?.k === "factory") {
      this.unresolvedAt(stmt.start, stmt.end, `Tasks built by ${target.name}() (lines ${target.start}–${target.end})`);
      return { k: "unknown", quiet: true };
    }
    if (target?.k === "dagfn") return UNKNOWN;
    if (last === "DAG") { const index = this.addDag(core, core.line); return { k: "dag", index }; }
    if (last === "TaskGroup") {
      const g = core.kw.find(x => x.k === "group_id")?.v ?? core.args[0];
      if (g?.t === "str" && !g.tok.dynamic) { const gname = ctx.group ? `${ctx.group}.${g.tok.v}` : g.tok.v; this.groups.add(gname); return { k: "group", name: gname }; }
      this.unresolvedAt(stmt.start, stmt.end, "Task group whose name is computed");
      return UNKNOWN;
    }
    const idNode = core.kw.find(k => k.k === "task_id")?.v;
    if (idNode) {
      if (!(idNode.t === "str" && !idNode.tok.dynamic)) { this.unresolvedAt(stmt.start, stmt.end, "Task whose task_id is computed"); return UNKNOWN; }
      const operator = last || "Operator";
      const groupKw = core.kw.find(k => k.k === "task_group")?.v;
      const groupVal = groupKw ? this.eval(groupKw, ctx, stmt) : undefined;
      const dagKw = core.kw.find(k => k.k === "dag")?.v;
      const dagVal = dagKw ? this.eval(dagKw, ctx, stmt) : undefined;
      const local: Ctx = { ...ctx, ...(groupVal?.k === "group" ? { group: groupVal.name } : {}), ...(dagVal?.k === "dag" ? { dag: dagVal.index } : {}) };
      const startLine = Math.min(stmt.start, core.line);
      const created = this.addTask(idNode.tok.v, operator, kindOf(operator), startLine, Math.max(core.endLine, n.endLine), local, { mapped });
      if (!created) return UNKNOWN;
      // XCom arguments (`t.output`, a TaskFlow result) make the task depend on their producer.
      const xcoms = (v: Val): Val[] => v.k === "tasks" && v.xcom ? [v] : v.k === "list" ? v.items.flatMap(xcoms) : [];
      const inputs = [...core.args, ...core.kw.filter(k => !["task_id", "task_group", "dag"].includes(k.k)).map(k => k.v), ...extraArgs];
      for (const a of inputs) for (const x of xcoms(this.eval(a, ctx, stmt))) this.link(x, created, n.line, stmt, true);
      return created;
    }
    return UNKNOWN;
  }

  private addTask(label: string, operator: string, kind: TaskKind, startLine: number, endLine: number, ctx: Ctx, extra: { callLine?: number; mapped?: boolean; taskflow?: boolean }): Val | undefined {
    if (this.tasks.length >= AIRFLOW_LIMITS.maxTasks) { this.truncated = true; return undefined; }
    const id = ctx.group ? `${ctx.group}.${label}` : label;
    if (this.taskIds.has(id)) { this.unresolvedAt(startLine, endLine, `Task id "${id}" is defined twice`); return { k: "tasks", ids: [id] }; }
    this.taskIds.add(id);
    const t: DagTask = { id, label, operator, kind, startLine, endLine, dag: ctx.dag ?? -1 };
    if (ctx.group) t.group = ctx.group;
    if (extra.callLine !== undefined) t.callLine = extra.callLine;
    if (extra.mapped) t.mapped = true;
    if (extra.taskflow) t.taskflow = true;
    this.tasks.push(t);
    return { k: "tasks", ids: [id] };
  }

  private endpoints(v: Val, line: number, stmt: Line, quiet: boolean): Endpoint[] {
    switch (v.k) {
      case "tasks": return v.ids.map(task => ({ task }));
      case "group": return [{ group: v.name }];
      case "list": return v.items.flatMap(x => this.endpoints(x, line, stmt, quiet));
      case "unknown":
        if (!quiet && v.why) this.unresolvedAt(stmt.start, stmt.end, `\`${v.why}\` is not a task DataPass could read statically`);
        return [];
      default: return [];
    }
  }

  /** `quiet`: TaskFlow call arguments (plain values are normal there, only tasks count). */
  private link(from: Val, to: Val, line: number, stmt: Line, quiet = false): void {
    const a = this.endpoints(from, line, stmt, quiet), b = this.endpoints(to, line, stmt, quiet);
    for (const x of a) for (const y of b) this.edges.push({ from: x, to: y, line });
  }

  /** Task-level edges, with task groups expanded to their first / last tasks. */
  finalEdges(): DagEdge[] {
    const key = (e: DagEdge) => `${e.from}\u0000${e.to}`;
    const out = new Map<string, DagEdge>();
    const members = (g: string) => this.tasks.filter(t => t.group === g || t.group?.startsWith(`${g}.`)).map(t => t.id);
    const add = (e: DagEdge) => { if (e.from !== e.to && this.taskIds.has(e.from) && this.taskIds.has(e.to) && !out.has(key(e))) out.set(key(e), e); };
    for (const e of this.edges) if ("task" in e.from && "task" in e.to) add({ from: e.from.task, to: e.to.task, line: e.line });
    // Deeper groups first, so an outer group's roots see its inner groups' edges.
    const depth = (p: Endpoint) => "group" in p ? p.group.split(".").length : 0;
    const groupEdges = this.edges.filter(e => "group" in e.from || "group" in e.to).sort((x, y) => Math.max(depth(y.from), depth(y.to)) - Math.max(depth(x.from), depth(x.to)));
    for (const e of groupEdges) {
      const side = (p: Endpoint, leaves: boolean): string[] => {
        if ("task" in p) return [p.task];
        const m = new Set(members(p.group));
        const inner = [...out.values()].filter(x => m.has(x.from) && m.has(x.to));
        return [...m].filter(id => !inner.some(x => (leaves ? x.from : x.to) === id));
      };
      for (const f of side(e.from, true)) for (const t of side(e.to, false)) add({ from: f, to: t, line: e.line });
    }
    return [...out.values()];
  }
}

/** Whether these tokens create or wire tasks. */
function tokensBuildTasks(toks: readonly Tok[], env: Env): boolean {
  for (const t of toks) {
    if (t.t === "name" && (t.v === "task_id" || LINK_FUNCS.has(t.v) || t.v === "set_upstream" || t.v === "set_downstream" || t.v === "TaskGroup" || t.v === "expand")) return true;
    if (t.t === "op" && (t.v === ">>" || t.v === "<<")) return true;
    if (t.t === "name") { const v = env.get(t.v); if (v && (v.k === "tfn" || v.k === "gfn" || v.k === "factory")) return true; }
  }
  return false;
}

function topLevelIndex(toks: Tok[], op: string, from: number): number {
  let depth = 0;
  for (let i = from; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t !== "op") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
    else if (CLOSERS.has(t.v)) depth--;
    else if (depth === 0 && t.v === op) return i;
  }
  return -1;
}

/** Operator (or TaskFlow flavour) → the icon family shown in the view. */
export function kindOf(operator: string): TaskKind {
  const o = operator.toLowerCase();
  if (o.includes("sensor")) return "sensor";
  if (o.includes("databricks")) return "databricks";
  if (/spark|dataproc|emr|glue|livy/.test(o)) return "spark";
  if (/sql|postgres|mysql|snowflake|bigquery|mssql|oracle|redshift|trino|presto|hive|athena|sqlite|vertica/.test(o)) return "sql";
  if (/docker|kubernetes|pod|ecs|container|gke|aks/.test(o)) return "container";
  if (/email|slack|teams|http|webhook|sns|notif/.test(o)) return "notify";
  if (/empty|dummy/.test(o)) return "empty";
  if (/trigger/.test(o)) return "trigger";
  if (/bash|shell|ssh/.test(o)) return "bash";
  if (/python|virtualenv|branch|short_?circuit|pyspark/.test(o)) return o.includes("pyspark") ? "spark" : "python";
  return "other";
}

/** Detect and read the DAG(s) of a Python file's text. Never executes anything. */
export function extractDag(text: string): DagExtraction {
  const empty = (reason: string): DagExtraction => ({ detected: false, reason, dags: [], tasks: [], edges: [], unresolved: [], truncated: false });
  if (Buffer.byteLength(text, "utf8") > AIRFLOW_LIMITS.maxBytes) return empty(`The file is larger than ${AIRFLOW_LIMITS.maxBytes / 1024} KB; DataPass does not read it.`);
  const lines = tokenize(text);
  const importsAirflow = lines.some(l => {
    const [a, b] = l.toks;
    return a?.t === "name" && (a.v === "from" || a.v === "import") && b?.t === "name" && (b.v === "airflow" || b.v.startsWith("airflow"));
  });
  if (!importsAirflow) return empty("No `airflow` import: not an Airflow DAG file.");
  const x = new Extractor(text, lines);
  x.run();
  if (x.dags.length === 0) return empty("Imports Airflow but defines no DAG (no `DAG(...)` and no `@dag`).");
  const dagOf = (t: DagTask) => t.dag >= 0 ? t.dag : 0;
  const tasks = x.tasks.map(t => ({ ...t, dag: dagOf(t) }));
  if (x.truncated) x.unresolved.push({ startLine: 1, endLine: 1, reason: `More than ${AIRFLOW_LIMITS.maxTasks} tasks: the rest are not drawn` });
  return { detected: true, dags: x.dags, tasks, edges: x.finalEdges(), unresolved: x.unresolved.sort((a, b) => a.startLine - b.startLine), truncated: x.truncated };
}

// ---------------------------------------------------------------- layout

export interface PlacedTask { id: string; layer: number; order: number }
/** An edge and the slots it passes through in the layers it skips. */
export interface DagRoute { from: string; to: string; via: Array<{ layer: number; order: number }> }
export interface DagLayout { placed: PlacedTask[]; routes: DagRoute[]; /** Slots per layer (tasks and passing edges). */ width: Map<number, number> }

/**
 * Layered layout: each task sits one layer below its deepest upstream task (longest path);
 * tasks in a cycle (Airflow refuses cycles, but a file can still contain one) go below the rest.
 * A task with upstream tasks is pulled down next to its first downstream task. Edges that skip
 * layers get a slot in each layer they cross. Within a layer, tasks follow the mean position of
 * their upstream tasks (or slots), then source order.
 */
export function layoutDag(tasks: readonly DagTask[], edges: readonly DagEdge[]): DagLayout {
  const ids = tasks.map(t => t.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const ups = new Map<string, string[]>(ids.map(id => [id, []]));
  const downs = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const e of edges) if (idx.has(e.from) && idx.has(e.to)) { ups.get(e.to)!.push(e.from); downs.get(e.from)!.push(e.to); }
  const indeg = new Map(ids.map(id => [id, ups.get(id)!.length]));
  const layer = new Map<string, number>();
  const queue = ids.filter(id => indeg.get(id) === 0);
  for (const id of queue) layer.set(id, 0);
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q]!;
    for (const d of downs.get(id)!) {
      layer.set(d, Math.max(layer.get(d) ?? 0, layer.get(id)! + 1));
      indeg.set(d, indeg.get(d)! - 1);
      if (indeg.get(d) === 0) queue.push(d);
    }
  }
  // Pull a task down next to its first downstream task (roots stay on top), so short side
  // branches do not leave long edges crossing the layers between.
  const order = [...queue];
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const next = downs.get(id)!.filter(d => layer.has(d) && indeg.get(d) === 0);
    if (ups.get(id)!.length && next.length) layer.set(id, Math.max(layer.get(id)!, Math.min(...next.map(d => layer.get(d)!)) - 1));
  }
  let max = Math.max(-1, ...layer.values());
  for (const id of ids) if (!layer.has(id) || indeg.get(id)! > 0) layer.set(id, ++max);
  // Edges that skip layers pass through reserved slots (never through another task's box).
  const slots = new Map<string, { layer: number; up: string }>();
  const chains: Array<{ from: string; to: string; via: string[] }> = [];
  const lastSlot = new Map<string, string>();
  const rowIds = [...ids];
  for (const e of edges) {
    if (!idx.has(e.from) || !idx.has(e.to)) continue;
    const via: string[] = [];
    let prev = e.from;
    for (let l = layer.get(e.from)! + 1; l < layer.get(e.to)!; l++) {
      const d = `\u0000${e.from}\u0000${e.to}\u0000${l}`;
      slots.set(d, { layer: l, up: prev });
      via.push(d); rowIds.push(d); prev = d;
    }
    lastSlot.set(`${e.from}\u0000${e.to}`, prev);
    chains.push({ from: e.from, to: e.to, via });
  }
  const upsOf = (id: string) => slots.has(id) ? [slots.get(id)!.up] : ups.get(id)!.map(u => lastSlot.get(`${u}\u0000${id}`) ?? u);
  const rank = (id: string) => idx.get(slots.get(id)?.up ?? id) ?? 0;
  const byLayer = new Map<number, string[]>();
  for (const id of rowIds) { const l = slots.get(id)?.layer ?? layer.get(id)!; if (!byLayer.has(l)) byLayer.set(l, []); byLayer.get(l)!.push(id); }
  const pos = new Map<string, { layer: number; order: number }>();
  const placed: PlacedTask[] = [];
  for (const l of [...byLayer.keys()].sort((x, y) => x - y)) {
    const row = byLayer.get(l)!;
    const score = (id: string) => { const u = upsOf(id).filter(x => pos.has(x)); return u.length ? u.reduce((s, x) => s + pos.get(x)!.order, 0) / u.length : rank(id); };
    const scores = new Map(row.map(id => [id, score(id)]));
    row.sort((x, y) => scores.get(x)! - scores.get(y)! || rank(x) - rank(y));
    row.forEach((id, i) => { pos.set(id, { layer: l, order: i }); if (!slots.has(id)) placed.push({ id, layer: l, order: i }); });
  }
  const routes = chains.map(c => ({ from: c.from, to: c.to, via: c.via.map(d => pos.get(d)!) }));
  const width = new Map<number, number>([...byLayer].map(([l, row]) => [l, row.length]));
  return { placed, routes, width };
}
