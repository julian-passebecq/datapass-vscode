"""Executable V2.2 design fixtures, NOT the production DataPass importer.
Run: python contract_kit.py --out /tmp/datapass-contracts
Requires jsonschema >= 4. Draft JSON schemas are generated from this one source.
No networking, external processes, cloud operations, or scientific computation.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
from typing import Any
from jsonschema import Draft202012Validator, FormatChecker, ValidationError

VERSION = "0.1-draft"
LIMIT = 1_048_576

def obj(fields: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False, "properties": fields,
            "required": list(fields) if required is None else required}

def arr(item: dict[str, Any], maximum: int = 100, minimum: int = 0) -> dict[str, Any]:
    return {"type": "array", "items": item, "maxItems": maximum, "minItems": minimum}

def enum(*values: str) -> dict[str, Any]:
    return {"enum": list(values)}

TEXT = {"type": "string", "minLength": 1, "maxLength": 4000}
ID = {"type": "string", "pattern": "^[a-z][a-z0-9_.-]{0,79}$"}
DIGEST = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
TIME = {"type": "string", "format": "date-time"}
REFS = arr(ID)
HASH = obj({"algorithm": {"const": "sha256"}, "value": DIGEST})
BASIS = enum("source-reported", "assumption", "model-output", "measured", "target")
CLASS = enum("public", "internal", "confidential")
SOURCE = obj({"id": ID, "authority": TEXT, "recordRef": TEXT, "revision": TEXT,
              "observedAt": TIME, "classification": CLASS, "snapshotHash": HASH})
ARTIFACT = obj({"id": ID, "locatorRef": ID, "mediaType": TEXT, "schemaRef": TEXT,
                "byteHash": HASH, "inputRefs": REFS, "producerRef": ID})
PORT = obj({"id": ID, "direction": enum("in", "out"), "contractRef": ID,
            "dataMode": enum("snapshot", "stream", "request", "result"),
            "required": {"type": "boolean"}})
BASE = obj({"scopeRevision": TEXT, "manifestHash": HASH,
            "repositories": arr(obj({"repoRef": ID, "revision": TEXT,
                                     "workingTreeHash": HASH}), 30)})

def envelope(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    schema = obj({"format": {"const": "datapass." + kind},
        "contractVersion": {"const": VERSION}, "id": ID, "projectRef": ID,
        "scopeRef": ID, "base": BASE, "classification": CLASS,
        "createdAt": TIME, "sources": arr(SOURCE), "payload": payload})
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    return schema

SCHEMAS = {
 "io-contract": envelope("io-contract", obj({
    "schemaRef": TEXT, "compatibility": enum("exact", "backward", "assessment-required"),
    "grain": TEXT, "keys": arr(TEXT, 20), "units": arr(obj({"field": TEXT, "unit": TEXT}), 50),
    "timeSemantics": TEXT, "delivery": enum("snapshot", "at-least-once", "request-response"),
    "qualityChecks": arr(TEXT, 50), "retentionPolicyRef": ID, "ports": arr(PORT, 30)})),
 "app-exchange": envelope("app-exchange", obj({
    "direction": enum("request", "result"), "correlationId": ID,
    "appRef": ID, "operation": enum("prepare-candidate", "validate", "package", "describe"),
    "inputRefs": REFS, "outputArtifacts": arr(ARTIFACT, 50),
    "requestHash": {"anyOf": [HASH, {"type": "null"}]}, "resultState": enum("not-run", "succeeded", "failed", "partial"),
    "executionEvidenceRef": {"anyOf": [ID, {"type": "null"}]}})),
 "authority-snapshot": envelope("authority-snapshot", obj({
    "querySpecRef": ID, "querySpecHash": HASH, "asOf": TIME,
    "state": enum("complete", "partial", "empty", "error", "not-authorized"),
    "recordRefs": REFS, "omissions": arr(TEXT), "nextCursorAvailable": {"type": "boolean"},
    "encoding": enum("json", "mongodb-canonical-ejson"), "dataArtifactRef": {"anyOf": [ID, {"type": "null"}]}})),
 "architecture-view": envelope("architecture-view", obj({
    "semanticRevision": TEXT, "layoutRevision": TEXT,
    "mode": enum("active-engineering", "learning", "portfolio-reconstruction", "reference"),
    "nodes": arr(obj({"id": ID, "itemRef": ID, "label": TEXT,
                      "evidenceRefs": REFS, "state": enum("planned", "observed", "unknown")}), 200),
    "edges": arr(obj({"id": ID, "source": ID, "target": ID,
                      "relation": enum("consumes", "produces", "runsOn", "observedBy", "dependsOn")}), 500),
    "omissions": arr(TEXT), "publication": {"const": "not-authorized"}})),
 "publication-brief": envelope("publication-brief", obj({
    "audience": enum("internal", "named-reviewers", "public"),
    "purpose": TEXT, "outputFormats": arr(enum("pptx", "pdf", "docx", "web"), 4, 1),
    "claims": arr(obj({"id": ID, "statement": TEXT, "basis": BASIS, "sourceRefs": REFS,
                       "review": enum("draft", "approved", "rejected"),
                       "limitations": arr(TEXT), "allowedAudiences": arr(enum("internal", "named-reviewers", "public"), 3)})),
    "assetRefs": REFS, "releaseState": enum("draft", "reviewed-for-generation"),
    "publication": {"const": "not-authorized"}}))
}


def strict_json(raw: str) -> Any:
    if len(raw.encode("utf-8")) > LIMIT:
        raise ValueError("Design fixture exceeds one MiB")
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate JSON key: " + key)
            result[key] = value
        return result
    def nonfinite(value):
        raise ValueError("Nonfinite JSON value: " + value)
    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    def visit(x, depth=0):
        if depth > 30:
            raise ValueError("Depth limit")
        if isinstance(x, float) and not math.isfinite(x):
            raise ValueError("Nonfinite number")
        if isinstance(x, dict):
            for child in x.values(): visit(child, depth + 1)
        if isinstance(x, list):
            for child in x: visit(child, depth + 1)
    visit(value)
    return value


def validate(doc: dict[str, Any]) -> None:
    if not isinstance(doc, dict): raise ValueError("Envelope must be an object")
    kind = doc.get("format", "").removeprefix("datapass.")
    if kind not in SCHEMAS:
        raise ValueError("Unsupported format")
    Draft202012Validator(SCHEMAS[kind], format_checker=FormatChecker()).validate(doc)
    sources = [s["id"] for s in doc["sources"]]
    if len(set(sources)) != len(sources): raise ValueError("Duplicate source")
    p = doc["payload"]
    if kind == "architecture-view":
        nodes = [n["id"] for n in p["nodes"]]
        edges = [e["id"] for e in p["edges"]]
        if len(set(nodes)) != len(nodes) or len(set(edges)) != len(edges):
            raise ValueError("Duplicate graph identity")
        if any(e["source"] not in nodes or e["target"] not in nodes for e in p["edges"]):
            raise ValueError("Dangling graph endpoint")
    if kind == "app-exchange":
        if p["direction"] == "request" and (p["resultState"] != "not-run" or p["outputArtifacts"] or p["requestHash"] is not None):
            raise ValueError("Request is not an execution result")
        if p["direction"] == "result" and (p["resultState"] == "not-run" or p["requestHash"] is None):
            raise ValueError("Result must state its observed outcome")
        if p["resultState"] == "succeeded" and not p["executionEvidenceRef"]:
            raise ValueError("Success needs evidence reference")
    if kind == "authority-snapshot":
        if p["state"] == "empty" and p["recordRefs"]: raise ValueError("Empty contains records")
        if p["state"] in ["error", "not-authorized"] and p["recordRefs"]:
            raise ValueError("Failure cannot masquerade as records")
        if p["state"] == "partial" and not (p["omissions"] or p["nextCursorAvailable"]):
            raise ValueError("Partial coverage must be described")
    if kind == "publication-brief":
        for c in p["claims"]:
            if any(ref not in sources for ref in c["sourceRefs"]):
                raise ValueError("Unknown claim source")
            if p["releaseState"] == "reviewed-for-generation":
                if c["review"] != "approved" or not c["sourceRefs"] or p["audience"] not in c["allowedAudiences"]:
                    raise ValueError("Claim not reviewed for this audience")
        if p["audience"] == "public" and p["releaseState"] == "reviewed-for-generation":
            if doc["classification"] != "public" or any(s["classification"] != "public" for s in doc["sources"]):
                raise ValueError("Public brief has non-public sources")


def check_result(request_bytes: bytes, result):
    request = strict_json(request_bytes.decode("utf-8"))
    validate(request); validate(result)
    if request["format"] != "datapass.app-exchange" or result["format"] != "datapass.app-exchange":
        raise ValueError("Expected app-exchange envelopes")
    if request["payload"]["direction"] != "request" or result["payload"]["direction"] != "result":
        raise ValueError("Request/result direction mismatch")
    if result["payload"]["requestHash"]["value"] != hashlib.sha256(request_bytes).hexdigest():
        raise ValueError("Request byte digest mismatch")
    for key in ("projectRef", "scopeRef", "base"):
        if request[key] != result[key]: raise ValueError("Stale or cross-project result")
    for key in ("correlationId", "appRef", "operation", "inputRefs"):
        if request["payload"][key] != result["payload"][key]: raise ValueError("Wrong request context")
    # A matching hash is integrity/context evidence, not author identity or trust.


H = {"algorithm": "sha256", "value": hashlib.sha256(b"synthetic-fixture-not-a-real-source").hexdigest()}
T = "2026-09-24T00:00:00Z"

def sample(kind, payload, project="sample-retail"):
    return {"format": "datapass." + kind, "contractVersion": VERSION, "id": kind + "-example",
        "projectRef": project, "scopeRef": "analytics", "base": {"scopeRevision": "draft-1",
        "manifestHash": H, "repositories": [{"repoRef": "main", "revision": "fixture-revision", "workingTreeHash": H}]},
        "classification": "internal", "createdAt": T,
        "sources": [{"id": "source-1", "authority": "synthetic-example", "recordRef": "fixture-only",
                     "revision": "1", "observedAt": T, "classification": "internal", "snapshotHash": H}],
        "payload": payload}

EXAMPLES = {
 "io": sample("io-contract", {"schemaRef": "sample.orders/1", "compatibility": "exact", "grain": "one order line",
    "keys": ["order_id", "line_id"], "units": [{"field": "net_amount", "unit": "EUR"}],
    "timeSemantics": "business date UTC; no implicit local-time conversion", "delivery": "snapshot",
    "qualityChecks": ["unique composite key"], "retentionPolicyRef": "retention-1", "ports": []}),
 "app-request": sample("app-exchange", {"direction": "request", "correlationId": "request-1",
    "appRef": "external-streamlit", "operation": "prepare-candidate", "inputRefs": ["case-1"],
    "outputArtifacts": [], "requestHash": None, "resultState": "not-run", "executionEvidenceRef": None}, "foil-example"),
 "authority": sample("authority-snapshot", {"querySpecRef": "studies-summary", "querySpecHash": H,
    "asOf": T, "state": "partial", "recordRefs": ["study-1"], "omissions": ["full documents excluded"],
    "nextCursorAvailable": False, "encoding": "mongodb-canonical-ejson", "dataArtifactRef": "snapshot-1"}),
 "architecture": sample("architecture-view", {"semanticRevision": "candidate-1", "layoutRevision": "layout-1",
    "mode": "learning", "nodes": [{"id": "app", "itemRef": "app-1", "label": "External app", "evidenceRefs": [], "state": "planned"},
       {"id": "data", "itemRef": "data-1", "label": "Dataset", "evidenceRefs": [], "state": "unknown"}],
    "edges": [{"id": "edge-1", "source": "app", "target": "data", "relation": "produces"}],
    "omissions": ["private runtime details"], "publication": "not-authorized"}),
 "brief": sample("publication-brief", {"audience": "internal", "purpose": "Review a hypothetical programme",
    "outputFormats": ["pptx"], "claims": [{"id": "claim-1", "statement": "A test scenario is under review.",
    "basis": "assumption", "sourceRefs": ["source-1"], "review": "draft", "limitations": ["Not measured"],
    "allowedAudiences": ["internal"]}], "assetRefs": [], "releaseState": "draft", "publication": "not-authorized"})
}
EXAMPLES["app-result"] = copy.deepcopy(EXAMPLES["app-request"])
EXAMPLES["app-result"]["id"] = "result-example"
REQUEST_BYTES = (json.dumps(EXAMPLES["app-request"], indent=2) + "\n").encode("utf-8")
EXAMPLES["app-result"]["payload"].update(direction="result", resultState="succeeded", executionEvidenceRef="external-receipt-1",
    requestHash={"algorithm": "sha256", "value": hashlib.sha256(REQUEST_BYTES).hexdigest()},
    outputArtifacts=[{"id": "candidate-1", "locatorRef": "private-artifact-location", "mediaType": "application/json",
      "schemaRef": "sample.candidate/1", "byteHash": H, "inputRefs": ["case-1"], "producerRef": "external-streamlit"}])


def self_test() -> dict[str, int]:
    for schema in SCHEMAS.values(): Draft202012Validator.check_schema(schema)
    for example in EXAMPLES.values(): validate(strict_json(json.dumps(example)))
    check_result(REQUEST_BYTES, EXAMPLES["app-result"])
    negative = 0
    def reject(fn):
        nonlocal negative
        try: fn()
        except (ValueError, ValidationError, RecursionError): negative += 1
        else: raise AssertionError("Unsafe fixture unexpectedly passed")
    def bad(name, mutate):
        value = copy.deepcopy(EXAMPLES[name]); mutate(value); reject(lambda: validate(value))
    for raw in ['{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}', '{"x":1e999}', '"' + 'x' * LIMIT + '"']:
        reject(lambda raw=raw: strict_json(raw))
    reject(lambda: validate(None))
    reject(lambda: check_result(REQUEST_BYTES, EXAMPLES["io"]))
    bad("io", lambda d: d.update(contractVersion="999"))
    bad("io", lambda d: d.update(shell="echo untrusted"))
    bad("io", lambda d: d["sources"].append(copy.deepcopy(d["sources"][0])))
    bad("io", lambda d: d.update(createdAt="not-a-time"))
    bad("io", lambda d: d["base"]["manifestHash"].update(value="invalid"))
    bad("architecture", lambda d: d["payload"]["edges"][0].update(target="absent"))
    bad("architecture", lambda d: d["payload"]["nodes"].append(copy.deepcopy(d["payload"]["nodes"][0])))
    bad("architecture", lambda d: d["payload"].update(publication="authorized"))
    bad("app-request", lambda d: d["payload"].update(resultState="succeeded"))
    bad("app-result", lambda d: d["payload"].update(executionEvidenceRef=None))
    bad("authority", lambda d: d["payload"].update(state="empty"))
    bad("authority", lambda d: d["payload"].update(state="not-authorized"))
    bad("authority", lambda d: d["payload"].update(omissions=[]))
    bad("brief", lambda d: d["payload"].update(releaseState="reviewed-for-generation"))
    bad("brief", lambda d: d["payload"]["claims"][0].update(sourceRefs=["unknown-source"]))
    for change in (lambda d: d.update(projectRef="other-company"),
                   lambda d: d["base"].update(scopeRevision="newer"),
                   lambda d: d["payload"].update(inputRefs=["wrong-input"]),
                   lambda d: d["payload"]["requestHash"].update(value="a" * 64)):
        wrong = copy.deepcopy(EXAMPLES["app-result"]); change(wrong)
        reject(lambda wrong=wrong: check_result(REQUEST_BYTES, wrong))
    reject(lambda: check_result(REQUEST_BYTES + b" ", EXAMPLES["app-result"]))
    reject(lambda: check_result(REQUEST_BYTES, EXAMPLES["app-request"]))
    reviewed = copy.deepcopy(EXAMPLES["brief"])
    reviewed["payload"].update(releaseState="reviewed-for-generation")
    reviewed["payload"]["claims"][0].update(review="approved")
    validate(reviewed)
    reviewed["payload"].update(audience="public")
    reviewed["payload"]["claims"][0].update(allowedAudiences=["public"])
    reject(lambda: validate(reviewed))
    return {"schemas": len(SCHEMAS), "valid_examples": len(EXAMPLES), "valid_pairings": 1,
            "valid_reviewed_briefs": 1, "negative_cases_rejected": negative}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = self_test()
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        for name, value in SCHEMAS.items():
            (args.out / (name + ".schema.json")).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        for name, value in EXAMPLES.items():
            (args.out / (name + ".example.json")).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        (args.out / "validation-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))

if __name__ == "__main__": main()
