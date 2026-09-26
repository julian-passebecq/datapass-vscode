/**
 * Discover a Power BI Project's structure: PBIP entry -> report(s) -> semantic model(s).
 * PBIP is packaging, PBIR is the report definition format, TMDL describes semantic models.
 * Pure: the caller provides the file list and a reader for the small JSON pointer files.
 */
import * as path from "node:path";
import { parseStrictJson } from "../model/strictJson";

export interface PbiReport {
  folder: string;
  format: "pbir" | "pbir-legacy" | "unknown";
  datasetBinding: { kind: "byPath"; semanticModelFolder: string; exists: boolean } | { kind: "byConnection" } | { kind: "missing" };
  pageCount: number;
}

export interface PbiSemanticModel {
  folder: string;
  format: "tmdl" | "tmsl" | "unknown";
  tmdlFiles: number;
  tables: string[];
  consumers: string[];
}

export interface PbiProjectGraph {
  entries: Array<{ pbip: string; reports: string[] }>;
  reports: PbiReport[];
  semanticModels: PbiSemanticModel[];
  issues: string[];
}

const posix = (p: string) => p.replace(/\\/g, "/");

export async function analyzePbip(files: string[], readJson: (rel: string) => Promise<string | undefined>): Promise<PbiProjectGraph> {
  const all = new Set(files.map(posix));
  const issues: string[] = [];
  const reportFolders = new Set<string>();
  const modelFolders = new Set<string>();
  for (const f of all) {
    const m = /^(.*?[^/]+\.Report)\//.exec(f);
    if (m) reportFolders.add(m[1]!);
    const s = /^(.*?[^/]+\.SemanticModel)\//.exec(f);
    if (s) modelFolders.add(s[1]!);
  }

  const entries: PbiProjectGraph["entries"] = [];
  for (const pbip of [...all].filter(f => f.endsWith(".pbip")).sort()) {
    const reports: string[] = [];
    const raw = await readJson(pbip);
    try {
      const doc = raw ? parseStrictJson(raw, { maxBytes: 262_144 }) as { artifacts?: Array<{ report?: { path?: string } }> } : undefined;
      for (const a of doc?.artifacts ?? []) {
        if (typeof a.report?.path !== "string") continue;
        const folder = posix(path.posix.normalize(path.posix.join(path.posix.dirname(pbip), a.report.path)));
        reports.push(folder);
        if (!reportFolders.has(folder)) issues.push(`${pbip} points to missing report folder ${folder}`);
      }
    } catch (error) {
      issues.push(`${pbip}: unreadable (${error instanceof Error ? error.message : String(error)})`);
    }
    entries.push({ pbip, reports });
  }

  const models: PbiSemanticModel[] = [...modelFolders].sort().map(folder => {
    const tmdl = [...all].filter(f => f.startsWith(folder + "/definition/") && f.endsWith(".tmdl"));
    const tmsl = all.has(`${folder}/model.bim`);
    if (tmdl.length && tmsl) issues.push(`${folder} contains both TMDL and model.bim; only one representation should be authoritative`);
    return {
      folder,
      format: tmdl.length ? "tmdl" : tmsl ? "tmsl" : "unknown",
      tmdlFiles: tmdl.length,
      tables: tmdl.filter(f => f.startsWith(folder + "/definition/tables/")).map(f => path.posix.basename(f, ".tmdl")).sort(),
      consumers: []
    };
  });
  const modelByFolder = new Map(models.map(m => [m.folder, m]));

  const reports: PbiReport[] = [];
  for (const folder of [...reportFolders].sort()) {
    const pbir = all.has(`${folder}/definition/report.json`) || all.has(`${folder}/definition/version.json`);
    const legacy = all.has(`${folder}/report.json`);
    if (pbir && legacy) issues.push(`${folder} has both PBIR and PBIR-legacy definitions`);
    let binding: PbiReport["datasetBinding"] = { kind: "missing" };
    const raw = await readJson(`${folder}/definition.pbir`);
    if (raw) {
      try {
        const doc = parseStrictJson(raw, { maxBytes: 262_144 }) as { datasetReference?: { byPath?: { path?: string } | null; byConnection?: unknown } };
        const byPath = doc.datasetReference?.byPath?.path;
        if (typeof byPath === "string") {
          const target = posix(path.posix.normalize(path.posix.join(folder, byPath)));
          const exists = modelByFolder.has(target);
          binding = { kind: "byPath", semanticModelFolder: target, exists };
          if (exists) modelByFolder.get(target)!.consumers.push(folder);
          else issues.push(`${folder} references semantic model ${target}, which is not in the workspace`);
        } else if (doc.datasetReference?.byConnection) {
          binding = { kind: "byConnection" };
        }
      } catch (error) {
        issues.push(`${folder}/definition.pbir: unreadable (${error instanceof Error ? error.message : String(error)})`);
      }
    } else {
      issues.push(`${folder} has no definition.pbir`);
    }
    reports.push({
      folder,
      format: pbir ? "pbir" : legacy ? "pbir-legacy" : "unknown",
      datasetBinding: binding,
      pageCount: new Set([...all].filter(f => f.startsWith(`${folder}/definition/pages/`)).map(f => f.split("/definition/pages/")[1]!.split("/")[0])).size
    });
  }
  for (const m of models) if (m.format === "unknown") issues.push(`${m.folder} has neither TMDL definition files nor model.bim`);
  return { entries, reports, semanticModels: models, issues };
}
