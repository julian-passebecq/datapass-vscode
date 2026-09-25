/**
 * Facts for capability preflight. Pure: derived from declared manifest bindings only, never from
 * secrets, probes or the network (kept out of loader.ts so it can be unit-tested without VS Code).
 */
import type { ProjectContext } from "./loader";
import { hostLabel, safeAppUrl } from "../model/safeUrl";
import { declaredResources } from "../resources/resources";

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

/** Facts for capability preflight, derived from declared bindings only (never from secrets). */
export function projectFacts(ctx: Pick<ProjectContext, "manifest" | "root">): Map<string, string | boolean | undefined> {
  const m = ctx.manifest;
  const p = m?.platforms;
  const facts = new Map<string, string | boolean | undefined>();
  facts.set("fabric.workspace", p?.fabric?.workspaceName || p?.fabric?.workspaceId);
  facts.set("fabric.workspaceName", p?.fabric?.workspaceName);
  facts.set("fabric.deployConfig", p?.fabric?.deployment?.configPath ? true : undefined);
  facts.set("databricks.bundleRoot", p?.databricks?.bundleRoot || (m?.repositories?.databricks?.path ? true : undefined));
  facts.set("databricks.target", p?.databricks?.defaultTarget);
  facts.set("grafana.repo", p?.grafana?.watchPath || p?.grafana?.generatorCommand ? true : undefined);
  // The declared stack (host only). A declaration, not proof of access or a reachable datasource.
  const grafanaStack = safeAppUrl(p?.grafana?.url);
  facts.set("grafana.instance", grafanaStack ? hostLabel(grafanaStack) : undefined);
  facts.set("infrastructure.root", p?.infrastructure?.root || (ctx.root ? true : undefined));
  facts.set("vm.sshHost", declaredResources(m).find(r => r.ssh?.host)?.ssh?.host);
  facts.set("powerbi.pbip", p?.powerbi?.projectRoot ? true : undefined);
  facts.set("powerbi.semanticModel", p?.powerbi?.projectRoot ? true : undefined);
  facts.set("powerbi.reportPbir", p?.powerbi?.projectRoot ? true : undefined);
  facts.set("airflow.mode", p?.airflow?.mode);
  facts.set("airflow.identity", p?.airflow?.identity);
  facts.set("airflow.gitSync.repo", p?.airflow?.gitSyncRepo);
  facts.set("airflow.workspaceGitAlm", p?.airflow?.workspaceGitAlm);
  facts.set("app.repoUrl", Object.values(m?.repositories ?? {}).some(r => r.remote?.url) ? true : undefined);
  return facts;
}
