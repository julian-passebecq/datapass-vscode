/**
 * Facts for capability preflight. Pure: derived from the manifest and from explicit file
 * observations, never from secrets, probes or the network (kept out of loader.ts so it can be
 * unit-tested without VS Code).
 *
 * Two kinds of facts:
 * - declarations: a name or identity (workspace name, bundle target, SSH alias, Airflow mode).
 *   Declaring it is the fact; DataPass cannot verify the remote side.
 * - file-backed facts: a path the manifest points to (bundle root, deploy config, PBIP folder, IaC
 *   root). A declared path is an expectation only; the fact holds when the file was observed.
 */
import type { ProjectContext } from "./loader";
import { hostLabel, safeAppUrl } from "../model/safeUrl";
import { declaredResources } from "../resources/resources";
import type { FactNote } from "../capabilities/preflight";
import type { DataPassProjectManifest } from "../projectManifestModel";

/** Where each fact comes from in .datapass/project.json, so a preflight can name a field a person can edit. */
export const FACT_MANIFEST_FIELDS: Readonly<Record<string, string>> = {
  "fabric.workspace": "platforms.fabric.workspaceName (or workspaceId)",
  "fabric.workspaceName": "platforms.fabric.workspaceName",
  "fabric.deployConfig": "platforms.fabric.deployment.configPath",
  "databricks.bundleRoot": "platforms.databricks.bundleRoot",
  "databricks.target": "platforms.databricks.defaultTarget",
  "grafana.repo": "platforms.grafana.watchPath (or generatorCommand)",
  "grafana.instance": "platforms.grafana.url",
  "infrastructure.root": "platforms.infrastructure.root",
  "vm.sshHost": "resources[].ssh.host (or platforms.oracle.sshHost)",
  "powerbi.pbip": "platforms.powerbi.projectRoot",
  "powerbi.semanticModel": "platforms.powerbi.projectRoot",
  "powerbi.reportPbir": "platforms.powerbi.projectRoot",
  "airflow.mode": "platforms.airflow.mode",
  "airflow.identity": "platforms.airflow.identity",
  "airflow.gitSync.repo": "platforms.airflow.gitSyncRepo",
  "airflow.workspaceGitAlm": "platforms.airflow.workspaceGitAlm",
  "app.repoUrl": "repositories.<name>.remote.url"
};

/** What to look at, relative to the project root (or absolute), to observe a file-backed fact. */
export type FileCheck =
  | { kind: "any-file"; paths: string[] }
  | { kind: "dir"; path: string }
  | { kind: "dir-has"; path: string; test: "pbip" | "semantic-model" | "report-pbir" | "iac" };

export interface FileFactPlan {
  fact: string;
  /** The declared value, for messages ("declared ../x"). */
  declared: string;
  check: FileCheck;
  /** Plain-language description of what must be there. */
  expects: string;
}

export interface FactObservation {
  state: "found" | "missing" | "unknown";
  /** Why it is missing or unknown (not found, unreadable, not checked in Restricted Mode…). */
  detail?: string;
}

const join = (dir: string, file: string) => (dir === "." || dir === "" ? file : `${dir.replace(/[\\/]+$/, "")}/${file}`);

/** The file-backed facts this manifest declares, and how to observe each. */
export function fileFactPlan(m: DataPassProjectManifest | undefined): FileFactPlan[] {
  const p = m?.platforms;
  const plan: FileFactPlan[] = [];
  const bundleRoot = p?.databricks?.bundleRoot || m?.repositories?.databricks?.path;
  if (bundleRoot) {
    plan.push({ fact: "databricks.bundleRoot", declared: bundleRoot, expects: "databricks.yml (or bundle.yml) in that folder",
      check: { kind: "any-file", paths: ["databricks.yml", "databricks.yaml", "bundle.yml", "bundle.yaml"].map(f => join(bundleRoot, f)) } });
  }
  const deployConfig = p?.fabric?.deployment?.configPath;
  if (deployConfig) plan.push({ fact: "fabric.deployConfig", declared: deployConfig, expects: "the deployment config file", check: { kind: "any-file", paths: [deployConfig] } });
  const pbi = p?.powerbi?.projectRoot;
  if (pbi) {
    plan.push({ fact: "powerbi.pbip", declared: pbi, expects: "a .pbip file in that folder", check: { kind: "dir-has", path: pbi, test: "pbip" } });
    plan.push({ fact: "powerbi.semanticModel", declared: pbi, expects: "a *.SemanticModel folder", check: { kind: "dir-has", path: pbi, test: "semantic-model" } });
    plan.push({ fact: "powerbi.reportPbir", declared: pbi, expects: "a *.Report folder with definition.pbir", check: { kind: "dir-has", path: pbi, test: "report-pbir" } });
  }
  if (p?.infrastructure) {
    const root = p.infrastructure.root || ".";
    plan.push({ fact: "infrastructure.root", declared: root, expects: "Terraform/OpenTofu (.tf) or Bicep files in that folder", check: { kind: "dir-has", path: root, test: "iac" } });
  }
  if (p?.grafana?.watchPath) plan.push({ fact: "grafana.repo", declared: p.grafana.watchPath, expects: "the dashboards folder", check: { kind: "dir", path: p.grafana.watchPath } });
  return plan;
}

/** Decide a `dir-has` test from one directory listing (name, isDirectory) and, for PBIR, the child listings. */
export function dirHas(test: "pbip" | "semantic-model" | "report-pbir" | "iac", entries: ReadonlyArray<{ name: string; dir: boolean; children?: string[] }>): boolean {
  switch (test) {
    case "pbip": return entries.some(e => !e.dir && /\.pbip$/i.test(e.name));
    case "semantic-model": return entries.some(e => e.dir && /\.SemanticModel$/i.test(e.name));
    case "report-pbir": return entries.some(e => e.dir && /\.Report$/i.test(e.name) && (e.children ?? []).some(c => c.toLowerCase() === "definition.pbir"));
    case "iac": return entries.some(e => !e.dir && /\.(tf|tofu|bicep)$|\.tf\.json$/i.test(e.name));
  }
}

/** Facts for capability preflight: declarations as declared, file-backed facts only when observed. */
export function projectFacts(ctx: Pick<ProjectContext, "manifest" | "root">, observed: ReadonlyMap<string, FactObservation> = new Map()): Map<string, string | boolean | undefined> {
  const m = ctx.manifest;
  const p = m?.platforms;
  const facts = new Map<string, string | boolean | undefined>();
  const seen = (fact: string) => (observed.get(fact)?.state === "found" ? true : undefined);
  facts.set("fabric.workspace", p?.fabric?.workspaceName || p?.fabric?.workspaceId);
  facts.set("fabric.workspaceName", p?.fabric?.workspaceName);
  facts.set("fabric.deployConfig", seen("fabric.deployConfig"));
  facts.set("databricks.bundleRoot", seen("databricks.bundleRoot"));
  facts.set("databricks.target", p?.databricks?.defaultTarget);
  // A generator command is a declaration; a watch path is a folder that must exist.
  facts.set("grafana.repo", p?.grafana?.watchPath ? seen("grafana.repo") : p?.grafana?.generatorCommand ? true : undefined);
  // The declared stack (host only). A declaration, not proof of access or a reachable datasource.
  const grafanaStack = safeAppUrl(p?.grafana?.url);
  facts.set("grafana.instance", grafanaStack ? hostLabel(grafanaStack) : undefined);
  facts.set("infrastructure.root", seen("infrastructure.root"));
  facts.set("vm.sshHost", declaredResources(m).find(r => r.ssh?.host)?.ssh?.host);
  facts.set("powerbi.pbip", seen("powerbi.pbip"));
  facts.set("powerbi.semanticModel", seen("powerbi.semanticModel"));
  facts.set("powerbi.reportPbir", seen("powerbi.reportPbir"));
  facts.set("airflow.mode", p?.airflow?.mode);
  facts.set("airflow.identity", p?.airflow?.identity);
  facts.set("airflow.gitSync.repo", p?.airflow?.gitSyncRepo);
  facts.set("airflow.workspaceGitAlm", p?.airflow?.workspaceGitAlm);
  facts.set("app.repoUrl", Object.values(m?.repositories ?? {}).some(r => r.remote?.url) ? true : undefined);
  return facts;
}

/** Explanations for declared-but-absent and unobservable file-backed facts. */
export function factNotes(m: DataPassProjectManifest | undefined, observed: ReadonlyMap<string, FactObservation>): Map<string, FactNote> {
  const notes = new Map<string, FactNote>();
  for (const plan of fileFactPlan(m)) {
    const o = observed.get(plan.fact);
    if (o?.state === "found") continue;
    if (!o || o.state === "unknown") notes.set(plan.fact, { state: "unknown", detail: `Declared "${plan.declared}", but DataPass could not check it${o?.detail ? ` (${o.detail})` : ""}; expected ${plan.expects}.` });
    else notes.set(plan.fact, { state: "missing", detail: `Declared "${plan.declared}", but ${plan.expects} was not found there${o.detail ? ` (${o.detail})` : ""}.` });
  }
  return notes;
}
