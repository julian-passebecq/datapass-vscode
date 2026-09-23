import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { anyWorkspaceFile } from "../core/vscodeDetection";

export class PowerBiAdapter implements PlatformAdapter {
  readonly id = "powerbi";
  readonly displayName = "Power BI";

  async detect(): Promise<PlatformState> {
    const [pbip, tmdl, pbir] = await Promise.all([
      anyWorkspaceFile(["**/*.pbip"]),
      anyWorkspaceFile(["**/*.tmdl"]),
      anyWorkspaceFile(["**/*.pbir"])
    ]);
    const tools: ToolProbe[] = [
      { id: "pbip", label: "PBIP source", available: pbip, detail: pbip ? "PBIP file detected" : "No PBIP file detected" },
      { id: "tmdl", label: "TMDL source", available: tmdl, detail: tmdl ? "TMDL file detected" : "No TMDL file detected" },
      { id: "pbir", label: "PBIR source", available: pbir, detail: pbir ? "PBIR file detected" : "No PBIR file detected" }
    ];
    const configured = pbip || tmdl || pbir;
    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(tools, configured),
      summary: configured
        ? "Power BI source engineering markers detected. DataPass keeps specialized model/report editors external."
        : "No PBIP/TMDL/PBIR source detected in the current workspace.",
      tools,
      actions: [
        { id: "powerbi.openAgentic", label: "Agentic development", enabled: true, kind: "link" },
        { id: "powerbi.openMacguyver", label: "MacGyver toolbox", enabled: true, kind: "link" },
        { id: "powerbi.openPbiBench", label: "PbiBench donor", enabled: true, kind: "link" }
      ]
    };
  }
}
