/**
 * Synthetic V3 project B (not FOIL, no Azure, no Mongo): one repository, a Python cleaning script
 * that feeds PostgreSQL tables on a Neon test branch. Shared by unit tests and the desktop fixture.
 */
import type { DataPassProjectManifest } from "../../../src/core/projectManifestModel";

export function manifestB(): DataPassProjectManifest {
  return {
    schemaVersion: 3,
    project: { id: "catalog-import", title: "Supplier catalogue import", description: "Clean a supplier CSV and load it into PostgreSQL." },
    environments: [{ id: "test", title: "Neon test branch" }],
    docs: [{ label: "How the import works", path: "docs/IMPORT.md" }],
    graph: ".datapass/graph.json",
    scopes: [{ id: "import", title: "Clean and load the catalogue", objective: "A clean catalogue table, reloaded weekly", itemRefs: ["clean", "db"],
      checklist: [{ id: "sample", label: "Get a sample CSV from the supplier" }] }]
  };
}

export function graphBJson(): Record<string, unknown> {
  return {
    format: "datapass.graph", version: "0.2",
    items: [
      { id: "clean", kind: "script", label: "Clean the CSV", provider: "python", description: "Normalises columns and drops duplicates.",
        artifacts: { profile: "python.script", root: "etl", entry: "clean.py", files: ["tests/test_clean.py"] } },
      { id: "db", kind: "database", label: "Catalogue tables", provider: "neon",
        artifacts: { profile: "postgres.migrations", root: "db" },
        operations: [{ capability: "postgres.browse" }, { capability: "postgres.migrations.apply", environment: "test", target: { branch: "test" } }] }
    ],
    relations: [{ id: "load", source: "clean", target: "db", relation: "feeds" }]
  };
}

/** Files of the monorepo (relative path → content). */
export function filesB(): Record<string, string> {
  return {
    ".datapass/project.json": JSON.stringify(manifestB(), null, 2) + "\n",
    ".datapass/graph.json": JSON.stringify(graphBJson(), null, 2) + "\n",
    "docs/IMPORT.md": "# Catalogue import\n\nSynthetic example.\n",
    "etl/clean.py": "def clean(rows):\n    return rows\n",
    "etl/tests/test_clean.py": "from clean import clean\n\ndef test_clean():\n    assert clean([]) == []\n",
    "db/001_catalogue.sql": "CREATE TABLE catalogue (sku text primary key, name text not null);\n",
    "db/002_prices.sql": "ALTER TABLE catalogue ADD COLUMN price numeric;\n"
  };
}
