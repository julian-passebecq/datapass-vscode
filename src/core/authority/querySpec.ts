/**
 * Named, reviewed, bounded read queries for authority sources (Mongo first). A QuerySpec is
 * data, never JavaScript. Write stages and server-side JavaScript are rejected outright;
 * parameters are typed placeholders substituted structurally, never by string interpolation.
 */
import { canonicalDigest } from "../model/canonical";
import { isPlainObject } from "../model/strictJson";

export interface QuerySpec {
  format: "datapass.query-spec";
  version: "0.1-draft";
  id: string;
  revision: string;
  purpose: string;
  owner: string;
  sourceBinding: string;
  database: string;
  collection: string;
  operation: "find" | "aggregate";
  filter?: Record<string, unknown>;
  pipeline?: Array<Record<string, unknown>>;
  projection: Record<string, 0 | 1>;
  sort: Record<string, 1 | -1>;
  limit: number;
  maxTimeMS: number;
  maxBytes: number;
  parameters: Array<{ name: string; type: "string" | "int" | "bool" | "objectId" | "date" }>;
  sensitivity: "public" | "internal" | "confidential";
}

const FORBIDDEN_OPERATORS = new Set(["$where", "$function", "$accumulator", "$out", "$merge", "$eval", "$unionWith"]);
const ALLOWED_STAGES = new Set(["$match", "$project", "$sort", "$limit", "$skip", "$unwind", "$group", "$count", "$addFields", "$set", "$unset", "$sortByCount"]);
const NAME = /^[A-Za-z0-9_.-]{1,120}$/;

export function validateQuerySpec(raw: unknown): { spec: QuerySpec; issues: string[] } {
  const issues: string[] = [];
  const s = raw as QuerySpec;
  if (!isPlainObject(raw)) return { spec: s, issues: ["QuerySpec must be an object"] };
  const allowed = new Set(["format", "version", "id", "revision", "purpose", "owner", "sourceBinding", "database", "collection", "operation", "filter", "pipeline", "projection", "sort", "limit", "maxTimeMS", "maxBytes", "parameters", "sensitivity"]);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) issues.push(`Unexpected field ${k}`);
  if (s.format !== "datapass.query-spec" || s.version !== "0.1-draft") issues.push("format/version must be datapass.query-spec 0.1-draft");
  for (const k of ["id", "revision", "purpose", "owner", "sourceBinding"] as const) if (typeof s[k] !== "string" || !s[k]) issues.push(`${k} is required`);
  if (!NAME.test(String(s.database)) || !NAME.test(String(s.collection)) || String(s.collection).startsWith("system.")) issues.push("database/collection must be explicit names (no wildcards or system collections)");
  if (s.operation !== "find" && s.operation !== "aggregate") issues.push("operation must be find or aggregate");
  if (s.operation === "find" && s.pipeline !== undefined) issues.push("find cannot carry a pipeline");
  if (s.operation === "aggregate") {
    if (!Array.isArray(s.pipeline) || !s.pipeline.length) issues.push("aggregate needs a pipeline");
    else s.pipeline.forEach((stage, i) => {
      const keys = isPlainObject(stage) ? Object.keys(stage) : [];
      if (keys.length !== 1 || !ALLOWED_STAGES.has(keys[0]!)) issues.push(`pipeline[${i}] stage ${keys.join(",") || "?"} is not allowlisted`);
    });
  }
  if (!isPlainObject(s.projection) || !Object.keys(s.projection).length || Object.values(s.projection).some(v => v !== 0 && v !== 1)) issues.push("a fixed, non-empty projection is required");
  if (!isPlainObject(s.sort) || !Object.keys(s.sort).length || Object.values(s.sort).some(v => v !== 1 && v !== -1)) issues.push("a stable sort is required for pagination");
  const bounded = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (!bounded(s.limit, 1, 1000)) issues.push("limit must be 1..1000");
  if (!bounded(s.maxTimeMS, 1, 30000)) issues.push("maxTimeMS must be 1..30000");
  if (!bounded(s.maxBytes, 1, 5 * 1024 * 1024)) issues.push("maxBytes must be 1..5 MiB");
  if (!["public", "internal", "confidential"].includes(s.sensitivity)) issues.push("sensitivity is required");
  if (!Array.isArray(s.parameters)) issues.push("parameters must be an array");
  const paramNames = new Set((Array.isArray(s.parameters) ? s.parameters : []).map(p => p?.name));
  scanOperators({ filter: s.filter, pipeline: s.pipeline }, "$", issues, paramNames);
  return { spec: s, issues };
}

function scanOperators(value: unknown, path: string, issues: string[], params: Set<string | undefined>): void {
  if (Array.isArray(value)) { value.forEach((v, i) => scanOperators(v, `${path}[${i}]`, issues, params)); return; }
  if (!isPlainObject(value)) {
    if (typeof value === "string" && /\$\{|\bfunction\s*\(|=>/.test(value)) issues.push(`${path}: string looks like code or interpolation`);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_OPERATORS.has(k)) issues.push(`${path}.${k} is forbidden (write stage or server-side JavaScript)`);
    if (k === "$lookup" && isPlainObject(v) && "pipeline" in v) issues.push(`${path}.$lookup with a nested pipeline needs separate qualification`);
    if (k === "$param" && (typeof v !== "string" || !params.has(v))) issues.push(`${path}.$param references an undeclared parameter`);
    scanOperators(v, `${path}.${k}`, issues, params);
  }
}

export function querySpecHash(spec: QuerySpec) {
  return canonicalDigest(spec);
}

/** Substitute {"$param": name} placeholders with typed values. Throws on type mismatch. */
export function bindParameters(spec: QuerySpec, values: Record<string, unknown>): { filter?: unknown; pipeline?: unknown } {
  const types = new Map(spec.parameters.map(p => [p.name, p.type]));
  for (const name of Object.keys(values)) if (!types.has(name)) throw new Error(`Unknown parameter ${name}`);
  const check = (name: string, v: unknown) => {
    const t = types.get(name);
    const ok = t === "string" ? typeof v === "string" && v.length <= 500
      : t === "int" ? Number.isInteger(v)
      : t === "bool" ? typeof v === "boolean"
      : t === "objectId" ? typeof v === "string" && /^[a-f0-9]{24}$/.test(v)
      : t === "date" ? typeof v === "string" && !Number.isNaN(Date.parse(v))
      : false;
    if (!ok) throw new Error(`Parameter ${name} must be ${t}`);
    return t === "objectId" ? { $oid: v } : t === "date" ? { $date: v } : v;
  };
  const sub = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sub);
    if (isPlainObject(x)) {
      const keys = Object.keys(x);
      if (keys.length === 1 && keys[0] === "$param") {
        const name = x.$param as string;
        if (!(name in values)) throw new Error(`Missing parameter ${name}`);
        return check(name, values[name]);
      }
      return Object.fromEntries(keys.map(k => [k, sub(x[k])]));
    }
    return x;
  };
  return { filter: sub(spec.filter), pipeline: sub(spec.pipeline) };
}
