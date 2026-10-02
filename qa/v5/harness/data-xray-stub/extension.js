// V5E2E1 QA stand-in for the separate Data X-Ray extension (never packaged). It answers
// `datapass.dataXray._sample(uri, maxRows)` with a `datapass.xray-sample/1` read by a plain CSV
// reader (the acceptance spec's fallback when DQ2's DuckDB preview is not merged). It reads only
// the file the person picked; it executes nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function splitCsvLine(line) {
  const out = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c; }
    else if (c === '"') quoted = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand("datapass.dataXray._sample", (uri, maxRows) => {
    const file = uri && uri.fsPath ? uri.fsPath : String(uri);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.trim());
    const columns = splitCsvLine(lines[0] || "");
    const limit = Number.isInteger(maxRows) ? maxRows : 50;
    const rows = lines.slice(1, 1 + limit).map(splitCsvLine);
    return { format: "datapass.xray-sample/1", file: path.basename(file), engine: "CSV reader", columns, rows, truncated: lines.length - 1 > limit };
  }));
}
module.exports = { activate, deactivate() {} };
