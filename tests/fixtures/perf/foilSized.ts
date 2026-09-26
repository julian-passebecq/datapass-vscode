/**
 * V1-PERF fixture: a synthetic project the size of FOIL (no FOIL content). 8 repositories (the
 * coordination hub and 7 component repositories), 5,000 files in total, a graph of 60 components
 * with relations. Used by scripts/perf.ts to measure activation, the first refresh and what a
 * `git fetch` triggers.
 */
import type { DataPassProjectManifest } from "../../../src/core/projectManifestModel";

export const PERF_REPOS = ["ingest", "transform", "serving", "reports", "platform", "quality", "orchestration"] as const;
export const PERF_TOTAL_FILES = 5000;
export const PERF_COMPONENTS = 60;

const KINDS: Array<{ kind: string; provider: string; profile: string; entry: (root: string) => Record<string, string> }> = [
  { kind: "function", provider: "azure-functions", profile: "azure-functions.python", entry: r => ({ [`${r}/function_app.py`]: "import azure.functions as func\n\napp = func.FunctionApp()\n", [`${r}/host.json`]: "{\n  \"version\": \"2.0\"\n}\n" }) },
  { kind: "pipeline", provider: "azure-data-factory", profile: "adf.factory", entry: r => ({ [`${r}/pipeline/main.json`]: "{\n  \"name\": \"main\",\n  \"properties\": { \"activities\": [] }\n}\n" }) },
  { kind: "artifact-bundle", provider: "databricks", profile: "databricks.bundle", entry: r => ({ [`${r}/databricks.yml`]: `bundle:\n  name: ${r.replace(/\W/g, "_")}\n` }) },
  { kind: "database", provider: "cosmos-nosql", profile: "cosmos-nosql.container", entry: r => ({ [`${r}/containers/items.json`]: "{\n  \"id\": \"items\"\n}\n" }) },
  { kind: "infrastructure-definition", provider: "terraform", profile: "terraform", entry: r => ({ [`${r}/main.tf`]: "terraform {}\n" }) }
];

export interface PerfComponent { id: string; repo: string; root: string; kind: typeof KINDS[number] }

export function perfComponents(): PerfComponent[] {
  return Array.from({ length: PERF_COMPONENTS }, (_, i) => {
    const repo = PERF_REPOS[i % PERF_REPOS.length]!;
    return { id: `c${String(i + 1).padStart(2, "0")}`, repo, root: `components/c${String(i + 1).padStart(2, "0")}`, kind: KINDS[i % KINDS.length]! };
  });
}

export function perfManifest(): DataPassProjectManifest {
  return {
    schemaVersion: 3,
    project: { id: "perf-foil-sized", title: "Perf fixture (FOIL-sized)", description: "Synthetic: 8 repositories, 5,000 files, 60 components." },
    repositories: Object.fromEntries(PERF_REPOS.map(r => [r, { label: r, remote: { url: `https://github.com/example-org/perf-${r}`, branch: "main" } }])),
    environments: [{ id: "dev", title: "Development" }, { id: "prod", title: "Production", production: true }],
    graph: ".datapass/graph.json",
    scopes: PERF_REPOS.map(r => ({ id: r, title: r, repoRef: r, itemRefs: perfComponents().filter(c => c.repo === r).map(c => c.id) }))
  } as DataPassProjectManifest;
}

export function perfGraphJson(): Record<string, unknown> {
  const comps = perfComponents();
  return {
    format: "datapass.graph", version: "0.2",
    items: comps.map(c => ({
      id: c.id, kind: c.kind.kind, label: `Component ${c.id}`, provider: c.kind.provider,
      artifacts: { repoRef: c.repo, profile: c.kind.profile, root: c.root }
    })),
    relations: comps.slice(1).map((c, i) => ({ id: `r${i + 1}`, source: comps[i]!.id, target: c.id, relation: "produces" }))
  };
}

/** Files per repository (the hub's .datapass files included), 5,000 in total. */
export function perfFiles(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {
    hub: {
      ".datapass/project.json": JSON.stringify(perfManifest(), null, 2) + "\n",
      ".datapass/graph.json": JSON.stringify(perfGraphJson(), null, 2) + "\n",
      "README.md": "# Perf fixture (coordination)\n"
    }
  };
  for (const r of PERF_REPOS) out[r] = { "README.md": `# ${r}\n` };
  for (const c of perfComponents()) Object.assign(out[c.repo]!, c.kind.entry(c.root));
  // Fill up to the total with ordinary source files spread over the component folders.
  let count = Object.values(out).reduce((n, f) => n + Object.keys(f).length, 0);
  const comps = perfComponents();
  for (let i = 0; count < PERF_TOTAL_FILES; i++, count++) {
    const c = comps[i % comps.length]!;
    const n = Math.floor(i / comps.length);
    const file = n % 3 === 0 ? `${c.root}/src/mod_${n}.py` : n % 3 === 1 ? `${c.root}/sql/q_${n}.sql` : `${c.root}/data/d_${n}.json`;
    out[c.repo]![file] = n % 3 === 0 ? `def f_${n}():\n    return ${n}\n` : n % 3 === 1 ? `select ${n} as n;\n` : `{ "n": ${n} }\n`;
  }
  return out;
}
