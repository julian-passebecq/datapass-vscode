/**
 * DBTMAT1 (TL-5 complement): the `datapass.dbt.materialize` command. Pick model(s), a target and an environment, read
 * dbt's own artefacts (`target/manifest.json`, `target/compiled/`) and `.datapass/dbt-materialize.json`, show the MAT1
 * preview diff, and write the files only after an explicit modal confirmation. The Git steps (branch → commit → push → MR)
 * are listed as arguments for the person to run; this command never runs dbt, the notebook, Git writes or a deployment.
 */
import * as vscode from "vscode";
import { gitRunner } from "../work/session";
import { previewDbtDiff, readDbtArtifacts, type DbtFile } from "../core/materialize/dbtNotebook";
import { materializeDbt as materializeDbtTarget, previewDbtSparkJobDiff } from "../core/materialize/dbtSparkJob";
import { DBT_MATERIALIZE_COMMAND, DBT_MATERIALIZE_CONFIG, dbtMaterializePreview, parseDbtMaterializeConfig, type DbtMaterializeConfig } from "../core/materialize/dbtMaterialize";
import { materializationGitPlan } from "../core/materialize/flow";
import { chooseTarget, materializationTargetCard, parseTargetCardSettings, targetCardLines, targetCardPicks } from "../core/materialize/targetCard";

const MAX_FILES = 2000;
const EXCLUDE = "**/{node_modules,dbt_packages,.git}/**";

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { return undefined; }
}

const rel = (root: vscode.Uri, uri: vscode.Uri): string => uri.path.slice(root.path.replace(/\/$/, "").length + 1);
const now = (): string => new Date().toISOString().replace(/\.\d+Z$/, "Z");

async function dbtFiles(root: vscode.Uri): Promise<DbtFile[]> {
  const uris = [
    ...await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/target/manifest.json"), EXCLUDE, 50),
    ...await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/target/compiled/**/*.sql"), EXCLUDE, MAX_FILES)
  ];
  const out: DbtFile[] = [];
  for (const uri of uris) {
    const text = await readText(uri);
    if (text !== undefined) out.push({ path: rel(root, uri), text });
  }
  return out;
}

async function config(root: vscode.Uri): Promise<DbtMaterializeConfig | undefined> {
  const text = await readText(vscode.Uri.joinPath(root, ...DBT_MATERIALIZE_CONFIG.split("/")));
  if (text !== undefined) {
    const r = parseDbtMaterializeConfig(text);
    if (r.ok) {
      for (const w of r.warnings) void vscode.window.showWarningMessage(w);
      return r.config;
    }
    void vscode.window.showErrorMessage(r.reason);
    return undefined;
  }
  // No config yet: one lakehouse for a single "default" environment; the file is how a project keeps several.
  const lakehouse = await vscode.window.showInputBox({
    title: "Materialize dbt models: Fabric lakehouse",
    prompt: `No ${DBT_MATERIALIZE_CONFIG}: name the lakehouse the notebooks write to (add the file to map several environments).`,
    validateInput: v => (/^[A-Za-z_][\w]*$/.test(v.trim()) ? undefined : "A lakehouse name (letters, digits, underscore).")
  });
  return lakehouse ? { environments: { default: { lakehouse: lakehouse.trim() } }, rootDirectory: "fabric" } : undefined;
}

export async function materializeDbt(root: vscode.Uri | undefined, out: vscode.OutputChannel): Promise<void> {
  if (!root) { void vscode.window.showWarningMessage("Open a DataPass project first."); return; }
  if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage("Materializing dbt models reads the dbt revision from Git: trust this workspace first."); return; }
  const files = await dbtFiles(root);
  const { projects, holes } = readDbtArtifacts(files);
  const project = projects.find(p => p.projectDir === ".") ?? projects[0];
  if (!project) { void vscode.window.showWarningMessage(holes[0]?.nextAction ?? "No dbt manifest found."); return; }
  const own = project.models.filter(m => !project.projectName || m.packageName === project.projectName);
  const models = await vscode.window.showQuickPick(own.map(m => ({ label: m.name, description: m.materialized, detail: m.uniqueId, picked: true, id: m.uniqueId })), {
    title: `Materialize dbt models (${project.projectName ?? project.projectDir})`, canPickMany: true, placeHolder: "Models to materialize"
  });
  if (!models?.length) return;
  const cfg = await config(root);
  if (!cfg) return;
  const envIds = Object.keys(cfg.environments);
  const environment = envIds.length === 1 ? envIds[0] : (await vscode.window.showQuickPick(envIds, { title: "Environment (table names come from the config)" }));
  if (!environment) return;
  // SJDMAT1 step 3: the EXEC1c target card. DataPass recommends, the person picks; both options are always offered.
  const cardSettings = parseTargetCardSettings(cfg.targetCard);
  const proposed = materializationTargetCard({ modelCount: models.length, environment, unitTestsWanted: cardSettings.unitTestsWanted }, cardSettings.policy, cardSettings.text);
  out.clear();
  for (const l of targetCardLines(proposed, cardSettings.text)) out.appendLine(l);
  out.show(true);
  const pick = await vscode.window.showQuickPick(targetCardPicks(proposed, cardSettings.text), { title: proposed.question, placeHolder: proposed.recommendation.reasons.join(" ") });
  if (!pick) return;
  const card = chooseTarget(proposed, pick.target);

  const dir = vscode.Uri.joinPath(root, ...(project.projectDir === "." ? [] : project.projectDir.split("/")));
  const rev = await gitRunner(["log", "-1", "--format=%H", "--", "."], dir.fsPath, 10_000);
  const dbtRevision = rev.ok ? rev.stdout.trim() : "";
  if (!dbtRevision) { void vscode.window.showWarningMessage("The dbt project has no committed revision: commit it first, the notebooks are stamped with that exact SHA."); return; }
  const user = await gitRunner(["config", "--get", "user.name"], root.fsPath, 5_000).then(r => (r.ok ? r.stdout.trim() : ""), () => "");

  const result = materializeDbtTarget({
    files, environment, environments: cfg.environments, dbtRevision, models: models.map(m => m.id),
    rootDirectory: cfg.rootDirectory, notebookPrefix: cfg.notebookPrefix, pipelineName: cfg.pipelineName,
    target: card.choice!.target, actor: user ? { kind: "human", id: user } : undefined, at: now()
  });
  const existing = new Map<string, string>();
  for (const f of result.files) {
    const text = await readText(vscode.Uri.joinPath(root, ...f.path.split("/")));
    if (text !== undefined) existing.set(f.path, text);
  }
  const diff = result.target === "spark-job-definition" ? previewDbtSparkJobDiff(result, existing) : previewDbtDiff(result, existing);
  const preview = dbtMaterializePreview(result, diff);
  out.clear();
  for (const l of targetCardLines(card, cardSettings.text)) out.appendLine(l);
  out.appendLine("");
  for (const l of preview.lines) out.appendLine(l);
  out.show(true);
  if (preview.blocked) { void vscode.window.showWarningMessage("Nothing to write: see the DataPass dbt output for holes and unchanged or kept files."); return; }
  const ok = await vscode.window.showWarningMessage(
    `Write ${preview.writes.length} file(s) of the dbt materialization proposal?`,
    { modal: true, detail: "The preview is in the DataPass dbt output. Files are written to the working tree only; nothing is run or deployed. The Git steps to a review branch are listed after writing, for you to run." },
    "Write"
  );
  if (ok !== "Write") return;
  const byPath = new Map(result.files.map(f => [f.path, f.content]));
  for (const p of preview.writes) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...p.split("/")), new TextEncoder().encode(byPath.get(p)!));

  const head = await gitRunner(["rev-parse", "--abbrev-ref", "HEAD"], root.fsPath, 5_000);
  const baseBranch = head.ok ? head.stdout.trim() : "main";
  try {
    const plan = materializationGitPlan({
      userAction: "user-confirmed", branch: `datapass/materialize-dbt-${environment}`, baseBranch,
      candidate: result.candidate, files: result.files, diff, issues: result.issues, openMergeRequest: false
    });
    out.appendLine("");
    out.appendLine("Git steps (run them yourself, after review):");
    for (const c of plan.commands) out.appendLine(`  ${c.label}: ${c.tool} ${c.args.map(a => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  } catch (e) {
    out.appendLine(`Git steps not planned: ${(e as Error).message}`);
  }
  if (result.target === "spark-job-definition" && result.nextActions.length) {
    out.appendLine("");
    out.appendLine("Next (outside DataPass):");
    for (const a of result.nextActions) out.appendLine(`  ${a}`);
  }
  void vscode.window.showInformationMessage(`${preview.writes.length} file(s) written. The Git steps are in the DataPass dbt output.`);
}

export function registerDbtMaterialize(context: vscode.ExtensionContext, root: () => vscode.Uri | undefined): void {
  const out = vscode.window.createOutputChannel("DataPass dbt");
  context.subscriptions.push(out, vscode.commands.registerCommand(DBT_MATERIALIZE_COMMAND, () => materializeDbt(root(), out)));
}
