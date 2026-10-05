// Adapted from datapass-vscode-hub git-service @ 7dcd191841304454050ed9c3d9b831a30aa688f5.
/**
 * Path-only artifact family hint. It never reads file contents; HG1b maps changes to real
 * artifacts through the Common analyzers. The hint lets the dashboard group "what changed".
 */
import type { ArtifactKind } from './types';

/** Fabric item folders serialize as `<name>.<Type>/` (PROJECT_MODEL §3.2). */
const FABRIC_ITEM = /(^|\/)[^/]+\.(Lakehouse|Warehouse|DataPipeline|SemanticModel|Report|Environment|SparkJobDefinition|KQLDatabase|Eventhouse|Dataflow|MirroredDatabase|VariableLibrary)\//;
const FABRIC_NOTEBOOK = /(^|\/)[^/]+\.Notebook\//;

export function classifyPath(path: string): ArtifactKind {
  const p = path.replace(/\\/g, '/');
  const lower = p.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';

  if (FABRIC_NOTEBOOK.test(p) || ext === '.ipynb') return 'notebook';
  if (FABRIC_ITEM.test(p)) return 'fabric-item';
  if (base === 'databricks.yml' || base === 'databricks.yaml' || base === 'bundle.yml') return 'databricks-bundle';
  if (base === '.gitlab-ci.yml' || lower.startsWith('.github/workflows/') || /^azure-pipelines.*\.ya?ml$/.test(base)) {
    return 'ci';
  }
  if (['.tf', '.tfvars', '.bicep', '.hcl'].includes(ext) || base.endsWith('.tf.json')) return 'iac';
  if (ext === '.sql') return 'sql';
  if (ext === '.py') return /(^|\/)dags\//.test(lower) ? 'pipeline' : 'python';
  if (['.yml', '.yaml', '.json', '.toml', '.ini', '.cfg', '.env', '.properties'].includes(ext)) return 'config';
  if (['.md', '.rst', '.txt', '.adoc'].includes(ext)) return 'docs';
  return 'other';
}
