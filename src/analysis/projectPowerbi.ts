import type { Extractor, ExtractorGap } from '@juliandatapass-group/analyzers';
import { canonicalNodeId, canonicalDatasetIdentity, type LineageEvidence, type LineageNodeInput, type LineageEdgeInput } from '@juliandatapass-group/lineage-core';
import { digestExactBytes, unwrap } from '@juliandatapass-group/semantic-core';
import { analyzePbip } from '../core/powerbi/pbipGraph';

/** Host adapter over the existing PBIP discovery. It does not claim TMDL/DAX/visual lineage. */
export function createProjectPowerbiExtractor(): Extractor {
  const id = 'datapass.pbip-structure', version = '1.0.0';
  return { id, version, families: [{ familyId: 'powerbi.project-structure', globs: ['**/*.pbip', '**/*.pbir', '**/*.tmdl', '**/*.bim', '**/*.Report/**/*.json', '**/*.SemanticModel/**/*.json'], sniff: null, priority: 350 }],
    async extract(files, ctx) {
      if (ctx.cancelled()) throw new Error('cancelled');
      const byPath = new Map(files.map(f => [f.path, f]));
      const model = await analyzePbip([...byPath.keys()], async p => byPath.get(p)?.text);
      const evidence = (path: string): LineageEvidence[] => [{ origin: 'static', extractor: `${id}@${version}`, locator: { kind: 'file', path, startLine: 1, endLine: 1,
        sha: unwrap(digestExactBytes(new TextEncoder().encode(byPath.get(path)!.text))).value }, confidence: 1, runRef: null, proposalId: null, evidenceIds: [] }];
      const nodes: LineageNodeInput[] = [], edges: LineageEdgeInput[] = [], ids = new Map<string, string>();
      const add = (folder: string, kind: 'dataset' | 'dashboard', source: string) => {
        const nodeId = kind === 'dataset' ? unwrap(canonicalDatasetIdentity({ platform: 'powerbi', catalog: ctx.namespace, schema: 'semantic-model', name: folder, casePolicy: 'sensitive' })).id
          : unwrap(canonicalNodeId({ kind, scope: ctx.namespace, name: folder }));
        ids.set(folder, nodeId);
        nodes.push({ id: nodeId, kind, name: folder, parentId: null, path: null, aliases: [], evidence: evidence(source) });
      };
      for (const m of model.semanticModels) {
        const source = files.find(f => f.path.startsWith(m.folder + '/'));
        if (source && m.format !== 'unknown') add(m.folder, 'dataset', source.path);
      }
      for (const r of model.reports) {
        const source = byPath.get(`${r.folder}/definition.pbir`);
        if (!source) continue;
        add(r.folder, 'dashboard', source.path);
        if (r.datasetBinding.kind === 'byPath' && r.datasetBinding.exists) {
          const fromId = ids.get(r.datasetBinding.semanticModelFolder), toId = ids.get(r.folder)!;
          if (fromId) edges.push({ kind: 'exposes', fromId, toId, transform: null, transformText: null, volumetry: null, evidence: evidence(source.path) });
        }
      }
      const gaps: ExtractorGap[] = files.map(f => ({ path: f.path, kind: 'partial', reason: 'unsupported-syntax', code: 'powerbi.structure-only-no-expression-lineage', span: null, nextAction: 'update-analyzer' }));
      for (const _issue of model.issues) gaps.push({ path: files[0]!.path, kind: 'partial', reason: 'unresolved-reference', code: 'powerbi.structure-unresolved-reference', span: null, nextAction: 'supply-schema' });
      return { nodes, edges, gaps };
    }
  };
}
