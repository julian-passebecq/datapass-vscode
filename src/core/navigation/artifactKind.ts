// NAVLOC1: classify one file into the navigation ARTIFACT_KINDS. Static only (path + decoded head),
// never runs client code. When the evidence is not there the answer is "other", never a guess.
import { classifyAsset } from "../inventory/inventory";
import type { ArtifactKind } from "./navTypes";

export interface ArtifactKindHints {
  /** Repository-relative POSIX path of the enclosing dbt project root ("" = repo root), when known. */
  dbtProjectRoot?: string;
}

/** Spark usage visible in source text: session, pyspark imports, spark.* calls, Spark cell magics. */
const SPARK = /\bSparkSession\b|^\s*(?:from|import)\s+pyspark\b|\bspark\s*\.\s*(?:sql|read|readStream|table|createDataFrame|range|conf|catalog|sparkContext)\b|^\s*(?:#\s*MAGIC\s+)?%%?(?:pyspark|spark|sql)\b|\bsc\s*\.\s*(?:parallelize|textFile)\b/m;
const PY_MAIN = /^if\s+__name__\s*==\s*["']__main__["']\s*:/m;
const DBT_JINJA = /\{\{\s*(?:ref|source|config)\s*\(/;
const CONFIG_EXT = /\.(?:ya?ml|toml|ini|cfg|conf|env|properties)$/i;
const FABRIC_PART = /(?:^|\/)[^/]+\.(Notebook|SparkJobDefinition|DataPipeline|SemanticModel|Report|ApacheAirflowJob)\//;

const base = (p: string) => (p.split("/").pop() ?? p).toLowerCase();

/** Notebook text: .ipynb JSON cell sources or a Databricks/Fabric .py notebook. */
function notebookKind(head: string | undefined): ArtifactKind {
  if (head === undefined) return "other";
  let text = head;
  if (head.trimStart().startsWith("{")) {
    try {
      const doc = JSON.parse(head) as { cells?: { source?: string | string[] }[]; metadata?: { kernelspec?: { name?: string } } };
      const cells = Array.isArray(doc.cells) ? doc.cells : [];
      text = cells.map((c) => (Array.isArray(c.source) ? c.source.join("") : String(c.source ?? ""))).join("\n");
      if (/spark/i.test(doc.metadata?.kernelspec?.name ?? "")) return "spark-notebook";
    } catch { /* truncated head: scan the raw text */ }
  }
  return SPARK.test(text) ? "spark-notebook" : "python-notebook";
}

export function classifyArtifactKind(path: string, head?: string, hints: ArtifactKindHints = {}): ArtifactKind {
  const p = path.replace(/\\/g, "/");
  const name = base(p);

  const fabric = FABRIC_PART.exec(p)?.[1];
  if (fabric === "SparkJobDefinition") return "spark-job";
  if (fabric === "DataPipeline") return "pipeline";
  if (fabric === "SemanticModel" || fabric === "Report") return "powerbi";
  if (fabric === "ApacheAirflowJob") return "airflow-dag";
  if (fabric === "Notebook" && /^notebook-content\./.test(name)) return notebookKind(head);

  const asset = classifyAsset(p, head);
  switch (asset?.kind) {
    case "notebook": return notebookKind(head);
    case "databricks-notebook": return notebookKind(head);
    case "airflow-dag": return "airflow-dag";
    case "adf-pipeline": return "pipeline";
    case "pbip": return "powerbi";
    case "iac": return "iac";
    case "databricks-bundle": return "config";
    default: break;
  }

  if (/\.(?:pbix|pbit|bim|tmdl)$/.test(name)) return "powerbi";
  if (/\.(?:tf|tofu|bicep)$/.test(name) || name === "dockerfile") return "iac";
  if (name.endsWith(".sql")) {
    const root = hints.dbtProjectRoot;
    const inDbt = root !== undefined && (root === "" ? p : p.startsWith(`${root}/`) ? p.slice(root.length + 1) : undefined)?.startsWith("models/");
    if (inDbt || (head !== undefined && DBT_JINJA.test(head) && /(?:^|\/)models\//.test(p))) return "dbt-model";
    return "sql-script";
  }
  if (name.endsWith(".py") && head !== undefined && SPARK.test(head) && PY_MAIN.test(head)) return "spark-job";
  if (name.endsWith(".json") && head !== undefined) {
    try {
      const doc = JSON.parse(head) as { properties?: { activities?: unknown } };
      if (Array.isArray(doc?.properties?.activities)) return "pipeline";
    } catch { /* not JSON we can read */ }
  }
  if (CONFIG_EXT.test(name)) return "config";
  return "other";
}
