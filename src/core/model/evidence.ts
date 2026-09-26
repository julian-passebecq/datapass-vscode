/**
 * Evidence levels are deliberately separate. A copied command is not a submitted job,
 * a submitted job is not a completed run, and a completed run is not a validated result.
 */
export type ObservationKind =
  | "user-reported"          // user ticked a checklist item
  | "reported-by-external"   // AI/app says it did something
  | "file-received"          // bytes arrived
  | "hash-verified"          // bytes match a declared digest
  | "schema-validated"       // structure matches a contract
  | "command-copied"         // DataPass copied a command; nothing ran
  | "job-submitted"          // native tool accepted a submission
  | "runtime-observed"       // native tool reported a completed run
  | "scientific-validated"   // owning authority validated the result
  | "publication-approved";  // a human approved distribution to an audience

export interface Observation {
  kind: ObservationKind;
  subjectRef: string;
  observedAt: string;
  by: string;           // "datapass", "user", or the external producer's declared id
  method: string;
  limits: string;       // what this observation does NOT establish
  evidenceRef?: string;
}

const LIMITS: Record<ObservationKind, string> = {
  "user-reported": "User-reported progress; not proof that anything ran or is correct.",
  "reported-by-external": "Claim made by an external producer; not verified by DataPass.",
  "file-received": "Bytes were received; says nothing about their correctness or origin.",
  "hash-verified": "Bytes equal a declared digest; an untrusted producer's digest is not a signature.",
  "schema-validated": "Structure matches a contract; not semantic, scientific or runtime correctness.",
  "command-copied": "A command was copied to the clipboard; DataPass did not execute it.",
  "job-submitted": "A native tool accepted a submission; completion is not implied.",
  "runtime-observed": "A native tool reported completion; scientific validity is not implied.",
  "scientific-validated": "Validated by the owning authority for the stated revision only.",
  "publication-approved": "Approved for the stated audience and exact digest only."
};

export function observe(kind: ObservationKind, subjectRef: string, by: string, method: string, observedAt: string, evidenceRef?: string): Observation {
  return { kind, subjectRef, observedAt, by, method, limits: LIMITS[kind], ...(evidenceRef ? { evidenceRef } : {}) };
}

export function limitsOf(kind: ObservationKind): string {
  return LIMITS[kind];
}
