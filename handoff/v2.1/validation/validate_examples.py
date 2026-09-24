"""Offline validation of design fixtures, not provider/runtime qualification.

Requires jsonschema >= 4.18. Does not fetch schemas, execute project code,
import DAGs, contact providers or accept these files as production manifests.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates)


def main() -> None:
    schema = load(ROOT / "contracts" / "portable-item.schema.json")
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    docs = [load(p) for p in sorted((ROOT / "examples").glob("*.item.json"))]
    assert len(docs) == 3, "Expected three documented design fixtures"
    for doc in docs:
        validator.validate(doc)
        ids = [profile["id"] for profile in doc["targetProfiles"]]
        assert len(ids) == len(set(ids)), "Duplicate target profile identity"
        assert doc["exampleOnly"] is True
    assert len({doc["id"] for doc in docs}) == len(docs)
    by_kind = {doc["kind"]: doc for doc in docs}
    assert len(by_kind["notebook"]["targetProfiles"]) == 2
    assert by_kind["workflow"]["native"]["engine"] == "airflow"
    assert len(by_kind["workflow"]["targetProfiles"]) == 3
    pack = by_kind["domain-config"]["extensions"]["com.foil.experiment"]
    assert pack["parameterValuesIncluded"] is False
    assert pack["promotionToCoreTruthAllowed"] is False
    negative = []
    bad = copy.deepcopy(docs[0]); bad["contractVersion"] = "1"; negative.append(bad)
    bad = copy.deepcopy(docs[0]); bad["shell"] = "not executable"; negative.append(bad)
    bad = copy.deepcopy(docs[0]); bad["exampleOnly"] = False; negative.append(bad)
    bad = copy.deepcopy(by_kind["notebook"]); bad["kind"] = "notebook/databricks/ml"; negative.append(bad)
    bad = copy.deepcopy(by_kind["workflow"]); bad["targetProfiles"][0]["actionState"] = "verified"; negative.append(bad)
    for bad in negative:
        assert not validator.is_valid(bad), "Invalid fixture was accepted"
    try:
        json.loads('{"key": 1, "key": 2}', object_pairs_hook=reject_duplicates)
        raise AssertionError("Duplicate keys accepted")
    except ValueError:
        pass
    print("PASS: 3 design fixtures; facet/identity checks; 5 invalid variants; duplicate-key rejection.")
    print("NOT TESTED: production parser, native providers, cloud runs, desktop UI or scientific validity.")


if __name__ == "__main__":
    main()
