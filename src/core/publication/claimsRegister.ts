/**
 * Claims register: the reviewed list of statements (with sources, basis, audiences and
 * limitations) from which a PublicationBrief is selected. It lives in the repository
 * (default `.datapass/claims.json`) so claims are reviewed like any other change.
 * DataPass selects from it by rule; it never rewrites a claim.
 */
import { arr, constOf, enumOf, ID, obj, TEXT, validateSchema, type Schema } from "../contracts/schemaDsl";
import { BASIS_SCHEMA, SOURCE_SCHEMA, type BriefClaim, type SourceRef } from "../contracts/envelopes";
import { parseStrictJson } from "../model/strictJson";

export const CLAIMS_REGISTER_PATH = ".datapass/claims.json";

export const CLAIMS_REGISTER_SCHEMA: Schema = obj({
  format: constOf("datapass.claims-register"),
  version: constOf("0.1-draft"),
  sources: arr(SOURCE_SCHEMA, 500),
  claims: arr(obj({
    id: ID, statement: TEXT, basis: BASIS_SCHEMA, sourceRefs: arr(ID, 50),
    review: enumOf("draft", "approved", "rejected"),
    limitations: arr(TEXT, 30), allowedAudiences: arr(enumOf("internal", "named-reviewers", "public"), 3)
  }), 1000)
});

export interface ClaimsRegister {
  format: "datapass.claims-register";
  version: "0.1-draft";
  sources: SourceRef[];
  claims: BriefClaim[];
}

export function parseClaimsRegister(raw: string | Uint8Array): ClaimsRegister {
  const doc = parseStrictJson(raw, { maxBytes: 1_048_576 });
  const issues = validateSchema(CLAIMS_REGISTER_SCHEMA, doc);
  if (issues.length) throw new Error(`Invalid claims register: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}`);
  const reg = doc as ClaimsRegister;
  const dup = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
  const d1 = dup(reg.sources.map(s => s.id));
  if (d1) throw new Error(`Duplicate source id ${d1}`);
  const d2 = dup(reg.claims.map(c => c.id));
  if (d2) throw new Error(`Duplicate claim id ${d2}`);
  return reg;
}

export function emptyClaimsRegister(): ClaimsRegister {
  return { format: "datapass.claims-register", version: "0.1-draft", sources: [], claims: [] };
}
