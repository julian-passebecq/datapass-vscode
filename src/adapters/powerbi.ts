import { detectCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { CatalogItemState, PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { supportedPowerBiAgenticPlugins } from "../core/powerbiAgentic";
import { anyWorkspaceFile, detectAnyExtension } from "../core/vscodeDetection";
import { analyzePbip, type PbiProjectGraph } from "../core/powerbi/pbipGraph";
import * as vscode from "vscode";
import { projectRoot } from "../core/workspace/root";

export class PowerBiAdapter implements PlatformAdapter {
  readonly id = "powerbi";
  readonly displayName = "Power BI";

  async detect(): Promise<PlatformState> {
    const [pbip, tmdl, pbir, copilot] = await Promise.all([
      anyWorkspaceFile(["**/*.pbip"]),
      anyWorkspaceFile(["**/*.tmdl"]),
      anyWorkspaceFile(["**/*.pbir"]),
      detectCli({ id: "copilot", label: "GitHub Copilot CLI", command: "copilot", args: ["--version"] })
    ]);

    // PBIP is the project; TMDL (vs model.bim) and PBIR (vs report.json) are formats inside it,
    // so their absence is information, not a missing prerequisite. Agentic helpers are optional.
    const tools: ToolProbe[] = [
      { id: "pbip", label: "PBIP project", available: pbip, detail: pbip ? "PBIP file detected" : "No PBIP file detected" },
      { id: "tmdl", label: "TMDL semantic model source", available: tmdl, optional: true, detail: tmdl ? "TMDL files detected" : "No TMDL files (model may use model.bim)" },
      { id: "pbir", label: "Report definition (definition.pbir)", available: pbir, optional: true, detail: pbir ? "definition.pbir detected" : "No definition.pbir detected" },
      detectAnyExtension(["analysis-services.TMDL", "CPIM.TMDL-language-support"], "TMDL language support (Microsoft)", { optional: true }),
      { id: "pbi-desktop", label: "Power BI Desktop", available: false, optional: true, detail: "Windows desktop app; not probed. Close it before editing PBIP files externally." },
      { ...copilot, optional: true }
    ];
    const configured = pbip || tmdl || pbir;
    const structure = pbip ? await inspectStructure() : undefined;
    const catalog: CatalogItemState[] = supportedPowerBiAgenticPlugins().map(plugin => ({
      id: plugin.id,
      name: plugin.label,
      category: "Agentic / Skills",
      kind: "Claude Code / Copilot CLI plugin",
      source: "data-goblin/power-bi-agentic-development",
      description: plugin.description,
      actions: [
        {
          id: `powerbi.installPlugin::${plugin.id}`,
          label: "Copy install (Copilot CLI)",
          enabled: copilot.available,
          kind: "copy",
          detail: copilot.available
            ? "Copy the Copilot CLI plugin install command. DataPass will not install it automatically."
            : "Install GitHub Copilot CLI first."
        },
        {
          id: `powerbi.installPluginClaude::${plugin.id}`,
          label: "Copy install (Claude Code)",
          enabled: true,
          kind: "copy",
          detail: "Copy the Claude Code plugin install command (claude plugin install …). DataPass will not install it automatically."
        },
        {
          id: "powerbi.openAgentic",
          label: "Open source",
          enabled: true,
          kind: "link"
        }
      ]
    }));

    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(tools, configured),
      summary: structure
        ? `${structure.reports.length} report(s) (${structure.reports.filter(r => r.format === "pbir").length} PBIR, ${structure.reports.filter(r => r.format === "pbir-legacy").length} legacy) · ${structure.semanticModels.length} semantic model(s) (${structure.semanticModels.filter(m => m.format === "tmdl").length} TMDL)${structure.issues.length ? ` · ${structure.issues.length} issue(s)` : ""}.`
        : configured
          ? "Power BI source markers detected. DataPass composes agentic/source tools while keeping specialized model/report editors external."
          : "No PBIP/TMDL/PBIR source detected in the current workspace.",
      tools,
      actions: [
        {
          id: "powerbi.addMarketplace",
          label: "Copy marketplace add",
          enabled: copilot.available,
          kind: "copy",
          detail: copilot.available
            ? "Copy the Data Goblin marketplace registration command for Copilot CLI."
            : "Install GitHub Copilot CLI first."
        },
        {
          id: "powerbi.addMarketplaceClaude",
          label: "Copy marketplace add (Claude Code)",
          enabled: true,
          kind: "copy",
          detail: "Copy the Data Goblin marketplace registration command for Claude Code."
        },
        { id: "powerbi.openAgentic", label: "Agentic development", enabled: true, kind: "link" },
        { id: "powerbi.openMacguyver", label: "MacGyver toolbox", enabled: true, kind: "link" }
      ],
      details: [
        ...(structure?.issues.slice(0, 5) ?? []),
        "Run \"DataPass: Inspect Power BI Project\" for the report → semantic model graph.",
        "Agentic plugins are user-wide in Copilot CLI; DataPass only copies install commands and does not install them automatically.",
        "Tabular Editor, Power BI Desktop and other specialized editors remain external peer tools."
      ],
      catalog: {
        title: "Power BI Agentic Modules",
        items: catalog
      }
    };
  }
}

/** Bounded structure scan used for the card summary; the full report is a Work command. */
async function inspectStructure(): Promise<PbiProjectGraph | undefined> {
  const root = projectRoot();
  if (!root) return undefined;
  try {
    const found = await vscode.workspace.findFiles("**/*.{pbip,pbir,pbism,tmdl,bim,json}", "**/{node_modules,.git,dist,out,.datapass}/**", 5000);
    const rel = found.map(u => vscode.workspace.asRelativePath(u, false)).filter(p => /\.(pbip|pbir|pbism|tmdl|bim)$|\.(Report|SemanticModel)\//.test(p));
    return await analyzePbip(rel, async p => {
      if (p.includes("..")) return undefined;
      try {
        const uri = vscode.Uri.joinPath(root, ...p.split("/"));
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > 512 * 1024) return undefined;
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        return undefined;
      }
    });
  } catch {
    return undefined;
  }
}
