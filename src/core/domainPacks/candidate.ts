/**
 * Detached candidate revisions. Editing a pack form never mutates the accepted base:
 * it produces a candidate envelope with an RFC 6902 patch, the base byte digest and the
 * facets the patch touches. A failed validation leaves nothing behind.
 */
import { sha256Bytes, type Sha256 } from "../model/ids";
import { classifyChange, type FacetChange } from "../impact/facets";
import { EDITABLE_ROLES, type DomainPack, type PackField } from "./pack";

export interface FieldEdit { pointer: string; value: unknown }

export interface CandidateEnvelope {
  format: "datapass.candidate";
  contractVersion: "0.1-draft";
  id: string;
  packRef: string;
  formRef: string;
  nativeSchemaRef: string;
  base: { byteHash: Sha256; ref: string };
  patch: Array<{ op: "replace" | "add"; path: string; value: unknown }>;
  changedFacets: string[];
  createdAt: string;
  state: "candidate";
  note: string;
}

export class CandidateError extends Error {}

function decode(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function getPointer(doc: unknown, pointer: string): unknown {
  if (pointer === "") return doc;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const key = decode(raw);
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setPointer(doc: unknown, pointer: string, value: unknown): "replace" | "add" {
  const parts = pointer.slice(1).split("/").map(decode);
  const last = parts.pop();
  if (last === undefined || pointer === "") throw new CandidateError("Cannot replace the document root");
  let cur: unknown = doc;
  for (const key of parts) {
    if (cur === null || typeof cur !== "object") throw new CandidateError(`Path ${pointer} does not exist in the base`);
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur === null || typeof cur !== "object" || Array.isArray(cur)) throw new CandidateError(`Parent of ${pointer} is not an object`);
  const parent = cur as Record<string, unknown>;
  const op = Object.prototype.hasOwnProperty.call(parent, last) ? "replace" : "add";
  Object.defineProperty(parent, last, { value, enumerable: true, writable: true, configurable: true });
  return op;
}

export function checkFieldValue(field: PackField, value: unknown): string | undefined {
  switch (field.type) {
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) return `${field.label} must be a finite number`;
      if (field.type === "integer" && !Number.isInteger(value)) return `${field.label} must be an integer`;
      if (field.min !== undefined && value < field.min) return `${field.label} must be >= ${field.min}`;
      if (field.max !== undefined && value > field.max) return `${field.label} must be <= ${field.max}`;
      return undefined;
    case "boolean": return typeof value === "boolean" ? undefined : `${field.label} must be true or false`;
    case "string": return typeof value === "string" && value.length <= 4000 ? undefined : `${field.label} must be text`;
    case "enum": return typeof value === "string" && field.options?.includes(value) ? undefined : `${field.label} must be one of ${field.options?.join(", ")}`;
  }
}

export function createCandidate(opts: {
  id: string; pack: DomainPack; formId: string; baseRef: string; baseBytes: Uint8Array; base: unknown; edits: FieldEdit[]; createdAt: string;
}): { candidate: CandidateEnvelope; after: unknown; change: FacetChange } {
  const form = opts.pack.forms?.find(f => f.id === opts.formId);
  if (!form) throw new CandidateError(`Unknown form ${opts.formId}`);
  const fields = new Map(form.groups.flatMap(g => g.fields).map(f => [f.pointer, f]));
  if (!opts.edits.length) throw new CandidateError("No edits");
  const after = structuredClone(opts.base);
  const patch: CandidateEnvelope["patch"] = [];
  const errors: string[] = [];
  for (const edit of opts.edits) {
    const field = fields.get(edit.pointer);
    if (!field) { errors.push(`${edit.pointer} is not a field of form ${form.id}`); continue; }
    if (!EDITABLE_ROLES.has(field.role)) { errors.push(`${field.label} is ${field.role} and read-only`); continue; }
    const problem = checkFieldValue(field, edit.value);
    if (problem) { errors.push(problem); continue; }
    try {
      patch.push({ op: setPointer(after, edit.pointer, edit.value), path: edit.pointer, value: edit.value });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length) throw new CandidateError(errors.join("; "));
  const change = classifyChange(opts.base, after, opts.pack.facets);
  const uncoupled = opts.edits.map(e => fields.get(e.pointer)!).filter(f => f.coupledToModel === false);
  return {
    after,
    change,
    candidate: {
      format: "datapass.candidate",
      contractVersion: "0.1-draft",
      id: opts.id,
      packRef: `${opts.pack.namespace}@${opts.pack.version}`,
      formRef: form.id,
      nativeSchemaRef: form.schemaRef,
      base: { byteHash: sha256Bytes(opts.baseBytes), ref: opts.baseRef },
      patch,
      changedFacets: change.facets,
      createdAt: opts.createdAt,
      state: "candidate",
      note: [
        "Candidate only: not accepted, not validated by the owning kernel, not a new reference revision.",
        uncoupled.length ? `Not used by the current model: ${uncoupled.map(f => f.label).join(", ")}.` : ""
      ].filter(Boolean).join(" ")
    }
  };
}
