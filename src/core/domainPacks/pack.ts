/**
 * Declarative domain packs. A pack is data: vocabularies, form layout, facet mappings,
 * output dependency declarations and brief templates. It can never carry code, expressions,
 * shell strings or install instructions; unknown keys are rejected, not ignored.
 */
import { anyOf, arr, BOOL, constOf, enumOf, ID, obj, TEXT, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import type { FacetDeclaration, DependencyDeclaration } from "../impact/facets";

const POINTER: Schema = { type: "string", pattern: "^(/([^~/]|~[01])*)*$", maxLength: 400 };
const SHORT: Schema = { type: "string", minLength: 1, maxLength: 200 };
const NUM: Schema = { type: "number" };
const opt = (fields: Record<string, Schema>, required: string[]) => obj(fields, required);

const FIELD = opt({
  pointer: POINTER,
  label: SHORT,
  role: enumOf("reference", "assumption", "computed", "proposal", "unsupported"),
  type: enumOf("number", "integer", "string", "boolean", "enum"),
  unit: SHORT,
  min: NUM,
  max: NUM,
  options: arr(SHORT, 50),
  help: TEXT,
  facet: ID,
  coupledToModel: BOOL
}, ["pointer", "label", "role", "type"]);

export const PACK_SCHEMA: Schema = opt({
  format: constOf("datapass.domain-pack"),
  packVersion: constOf("0.1-draft"),
  namespace: { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$", maxLength: 80 },
  version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(-[a-z0-9.]+)?$" },
  title: SHORT,
  description: TEXT,
  mappingStatus: enumOf("reviewed", "draft-awaiting-owner-declaration", "synthetic-example"),
  acceptedSchemas: arr(SHORT, 20),
  views: arr(opt({ id: ID, title: SHORT, description: TEXT, itemKinds: arr(ID, 30), tags: arr(ID, 30) }, ["id", "title"]), 20),
  facets: arr(opt({ id: ID, label: SHORT, pointers: arr(POINTER, 50, 1), help: TEXT }, ["id", "label", "pointers"]), 50),
  forms: arr(opt({ id: ID, title: SHORT, schemaRef: SHORT, groups: arr(opt({ id: ID, title: SHORT, fields: arr(FIELD, 100) }, ["id", "title", "fields"]), 30) }, ["id", "title", "schemaRef", "groups"]), 20),
  outputs: arr(opt({ id: ID, label: SHORT, view: ID, producer: SHORT,
    dependsOn: arr(opt({ ref: ID, facets: anyOf(arr(ID, 50, 1), constOf("*")) }, ["ref", "facets"]), 30) }, ["id", "label", "dependsOn"]), 100),
  validators: arr(opt({ id: ID, label: SHORT, kind: enumOf("external-kernel", "native-tool", "manual-review"), owner: SHORT, capabilityRef: ID, instructions: TEXT }, ["id", "label", "kind", "owner"]), 20),
  briefTemplates: arr(opt({ id: ID, title: SHORT, audience: enumOf("internal", "named-reviewers", "public"), purpose: TEXT, sections: arr(SHORT, 30, 1) }, ["id", "title", "audience", "sections"]), 20),
  moneyKinds: arr(enumOf("unit-capex-assumption", "programme-budget", "funding-target", "funding-requested", "funding-committed", "funding-received", "cloud-spend", "other"), 10)
}, ["format", "packVersion", "namespace", "version", "title", "mappingStatus", "views", "facets", "outputs"]);

export interface PackField {
  pointer: string; label: string;
  role: "reference" | "assumption" | "computed" | "proposal" | "unsupported";
  type: "number" | "integer" | "string" | "boolean" | "enum";
  unit?: string; min?: number; max?: number; options?: string[]; help?: string; facet?: string; coupledToModel?: boolean;
}
export interface DomainPack {
  format: "datapass.domain-pack"; packVersion: "0.1-draft";
  namespace: string; version: string; title: string; description?: string;
  mappingStatus: "reviewed" | "draft-awaiting-owner-declaration" | "synthetic-example";
  acceptedSchemas?: string[];
  views: Array<{ id: string; title: string; description?: string; itemKinds?: string[]; tags?: string[] }>;
  facets: Array<FacetDeclaration & { label: string; help?: string }>;
  forms?: Array<{ id: string; title: string; schemaRef: string; groups: Array<{ id: string; title: string; fields: PackField[] }> }>;
  outputs: Array<{ id: string; label: string; view?: string; producer?: string; dependsOn: DependencyDeclaration[] }>;
  validators?: Array<{ id: string; label: string; kind: "external-kernel" | "native-tool" | "manual-review"; owner: string; capabilityRef?: string; instructions?: string }>;
  briefTemplates?: Array<{ id: string; title: string; audience: "internal" | "named-reviewers" | "public"; purpose?: string; sections: string[] }>;
  moneyKinds?: string[];
}

export const EDITABLE_ROLES = new Set(["assumption", "proposal"]);

// Free-text fields may describe things, but must not smuggle executable content.
const EXECUTABLE_HINTS = [/<script/i, /\bjavascript:/i, /\$\(\s*[a-z]/i, /`[^`]*`/, /\beval\s*\(/i, /\brequire\s*\(/i, /\bimport\s*\(/i, /\bcurl\s+-/i, /\|\s*(sh|bash|pwsh)\b/i];

export class PackError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

export function parseDomainPack(raw: string | Uint8Array): DomainPack {
  const doc = parseStrictJson(raw, { maxBytes: 512 * 1024 });
  return validateDomainPack(doc);
}

export function validateDomainPack(doc: unknown): DomainPack {
  const issues = validateSchema(PACK_SCHEMA, doc);
  if (issues.length) throw new PackError("Invalid domain pack", issues);
  const pack = doc as DomainPack;
  const strings: string[] = [];
  (function walk(v: unknown) {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  })(pack);
  const bad = strings.find(s => EXECUTABLE_HINTS.some(r => r.test(s)));
  if (bad) throw new PackError(`Pack text looks executable and is rejected: ${bad.slice(0, 60)}`);

  const unique = (ids: string[], what: string) => { if (new Set(ids).size !== ids.length) throw new PackError(`Duplicate ${what} id`); };
  unique(pack.views.map(v => v.id), "view");
  unique(pack.facets.map(f => f.id), "facet");
  unique(pack.outputs.map(o => o.id), "output");
  const facetIds = new Set(pack.facets.map(f => f.id));
  const viewIds = new Set(pack.views.map(v => v.id));
  for (const o of pack.outputs) {
    if (o.view && !viewIds.has(o.view)) throw new PackError(`Output ${o.id} references unknown view ${o.view}`);
    for (const d of o.dependsOn) {
      if (d.facets !== "*") for (const f of d.facets) if (!facetIds.has(f)) throw new PackError(`Output ${o.id} depends on unknown facet ${f}`);
    }
  }
  for (const form of pack.forms ?? []) {
    const pointers = form.groups.flatMap(g => g.fields.map(f => f.pointer));
    unique(pointers, `field pointer in form ${form.id}`);
    for (const field of form.groups.flatMap(g => g.fields)) {
      if (field.facet && !facetIds.has(field.facet)) throw new PackError(`Field ${field.pointer} references unknown facet ${field.facet}`);
      if (field.type === "enum" && !field.options?.length) throw new PackError(`Enum field ${field.pointer} needs options`);
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) throw new PackError(`Field ${field.pointer} has min > max`);
    }
  }
  return pack;
}
