/**
 * The subset of JSON Schema 2020-12 used by DataPass exchange contracts, plus a
 * small interpreter. The schema objects are the single source: they are emitted as
 * JSON Schema files and also used for validation at runtime, so the two cannot drift.
 */

export type Schema =
  | { type: "object"; additionalProperties: false; properties: Record<string, Schema>; required: string[]; $schema?: string }
  | { type: "array"; items: Schema; maxItems: number; minItems: number }
  | { type: "string"; minLength?: number; maxLength?: number; pattern?: string; format?: "date-time" }
  | { type: "boolean" }
  | { type: "null" }
  | { type: "integer"; minimum?: number; maximum?: number }
  | { type: "number"; minimum?: number; maximum?: number }
  | { enum: readonly (string | number | boolean | null)[] }
  | { const: string | number | boolean | null }
  | { anyOf: Schema[] };

export function obj(fields: Record<string, Schema>, required?: string[]): Schema {
  return { type: "object", additionalProperties: false, properties: fields, required: required ?? Object.keys(fields) };
}
export function arr(item: Schema, maximum = 100, minimum = 0): Schema {
  return { type: "array", items: item, maxItems: maximum, minItems: minimum };
}
export function enumOf(...values: string[]): Schema {
  return { enum: values };
}
export function constOf(value: string | number | boolean | null): Schema {
  return { const: value };
}
export function anyOf(...schemas: Schema[]): Schema {
  return { anyOf: schemas };
}

export const TEXT: Schema = { type: "string", minLength: 1, maxLength: 4000 };
export const ID: Schema = { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,79}$" };
export const DIGEST: Schema = { type: "string", pattern: "^[a-f0-9]{64}$" };
export const TIME: Schema = { type: "string", format: "date-time" };
export const BOOL: Schema = { type: "boolean" };
export const NULL: Schema = { type: "null" };

// RFC 3339 date-time (full-date "T" full-time), which is what JSON Schema's format means.
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;

export function isRfc3339(value: string): boolean {
  const m = RFC3339.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as number[];
  const leap = (year! % 4 === 0 && year! % 100 !== 0) || year! % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month! - 1];
  if (!days || day! < 1 || day! > days) return false;
  if (hour! > 23 || minute! > 59 || second! > 60) return false;
  if (m[9] !== undefined && (Number(m[9]) > 23 || Number(m[10]) > 59)) return false;
  return true;
}

export interface SchemaIssue {
  path: string;
  message: string;
}

const patternCache = new Map<string, RegExp>();
function re(pattern: string): RegExp {
  let r = patternCache.get(pattern);
  if (!r) { r = new RegExp(pattern, "u"); patternCache.set(pattern, r); }
  return r;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validateSchema(schema: Schema, value: unknown, path = "$", issues: SchemaIssue[] = []): SchemaIssue[] {
  if (issues.length >= 50) return issues;
  if ("anyOf" in schema) {
    if (!schema.anyOf.some(option => validateSchema(option, value, path, []).length === 0)) {
      issues.push({ path, message: "does not match any allowed alternative" });
    }
    return issues;
  }
  if ("const" in schema) {
    if (value !== schema.const) issues.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
    return issues;
  }
  if ("enum" in schema) {
    if (!schema.enum.includes(value as never)) issues.push({ path, message: `must be one of ${schema.enum.map(v => JSON.stringify(v)).join(", ")}` });
    return issues;
  }
  const actual = typeOf(value);
  switch (schema.type) {
    case "null":
    case "boolean":
      if (actual !== schema.type) issues.push({ path, message: `must be ${schema.type}` });
      return issues;
    case "integer":
    case "number": {
      if (actual !== "number" || !Number.isFinite(value as number) || (schema.type === "integer" && !Number.isInteger(value))) {
        issues.push({ path, message: `must be a finite ${schema.type}` });
        return issues;
      }
      const n = value as number;
      if (schema.minimum !== undefined && n < schema.minimum) issues.push({ path, message: `must be >= ${schema.minimum}` });
      if (schema.maximum !== undefined && n > schema.maximum) issues.push({ path, message: `must be <= ${schema.maximum}` });
      return issues;
    }
    case "string": {
      if (actual !== "string") { issues.push({ path, message: "must be a string" }); return issues; }
      const s = value as string;
      const len = [...s].length;
      if (schema.minLength !== undefined && len < schema.minLength) issues.push({ path, message: `must have at least ${schema.minLength} characters` });
      if (schema.maxLength !== undefined && len > schema.maxLength) issues.push({ path, message: `must have at most ${schema.maxLength} characters` });
      if (schema.pattern !== undefined && !re(schema.pattern).test(s)) issues.push({ path, message: `must match ${schema.pattern}` });
      if (schema.format === "date-time" && !isRfc3339(s)) issues.push({ path, message: "must be an RFC 3339 date-time" });
      return issues;
    }
    case "array": {
      if (actual !== "array") { issues.push({ path, message: "must be an array" }); return issues; }
      const a = value as unknown[];
      if (a.length > schema.maxItems) issues.push({ path, message: `must have at most ${schema.maxItems} items` });
      if (a.length < schema.minItems) issues.push({ path, message: `must have at least ${schema.minItems} items` });
      a.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`, issues));
      return issues;
    }
    case "object": {
      if (actual !== "object") { issues.push({ path, message: "must be an object" }); return issues; }
      const o = value as Record<string, unknown>;
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(o, key)) issues.push({ path: `${path}.${key}`, message: "is required" });
      }
      for (const key of Object.keys(o)) {
        const child = schema.properties[key];
        if (!child) issues.push({ path: `${path}.${key}`, message: "is not an allowed property" });
        else validateSchema(child, o[key], `${path}.${key}`, issues);
      }
      return issues;
    }
  }
}
