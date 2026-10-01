/**
 * V4-NAV NAVREN3 — "diff-history" layout kind (go/NAV-contract.md). Pure (no `vscode`): the HTML of a
 * revision list (date, author, message, files). Selecting a row posts `{type:"open-diff", rev}` from the
 * webview; the host side (NAVHIST1) validates it with `vetOpenDiff` and opens VS Code's diff editor.
 * Rows come from `git log` (see core/git/fileVersions.ts); nothing here runs Git. Labels are data.
 */
import { escapeHtml } from "./metrics";

export interface HistoryCommit {
  /** Full 40-hex sha. */
  readonly rev: string;
  /** ISO 8601. */
  readonly date: string;
  readonly author: string;
  readonly message: string;
  readonly files: readonly string[];
}

export interface DiffHistoryLabels {
  readonly empty: string;
  readonly files: string;
  readonly noMessage: string;
  readonly openDiff: string;
}

export const DEFAULT_DIFF_HISTORY_LABELS: DiffHistoryLabels = {
  empty: "No history for this location.",
  files: "files",
  noMessage: "(no message)",
  openDiff: "Open diff"
};

/** Files listed per row before collapsing into "+N". */
export const FILES_SHOWN = 5;

const SHA = /^[0-9a-f]{40}$/;

export function renderCommitRow(c: HistoryCommit, labels: DiffHistoryLabels = DEFAULT_DIFF_HISTORY_LABELS, selected = false): string {
  if (!SHA.test(c.rev)) return "";
  const files = c.files.slice(0, FILES_SHOWN).map(f => `<li>${escapeHtml(f)}</li>`).join("");
  const more = c.files.length > FILES_SHOWN ? `<li class="more">+${c.files.length - FILES_SHOWN}</li>` : "";
  return `<li class="nav-commit${selected ? " selected" : ""}" data-rev="${c.rev}" tabindex="0" role="button" aria-label="${escapeHtml(labels.openDiff)}: ${escapeHtml(c.message || labels.noMessage)}">`
    + `<div class="nav-commit-head"><span class="nav-commit-msg">${escapeHtml(c.message || labels.noMessage)}</span>`
    + `<span class="nav-commit-sha">${c.rev.slice(0, 7)}</span></div>`
    + `<div class="nav-commit-meta">${escapeHtml(c.date.slice(0, 10))} · ${escapeHtml(c.author)} · ${c.files.length} ${escapeHtml(labels.files)}</div>`
    + (c.files.length ? `<ul class="nav-commit-files">${files}${more}</ul>` : "")
    + `</li>`;
}

export function renderDiffHistory(commits: readonly HistoryCommit[], selectedRev?: string, labels: DiffHistoryLabels = DEFAULT_DIFF_HISTORY_LABELS): string {
  const rows = commits.map(c => renderCommitRow(c, labels, c.rev === selectedRev)).filter(Boolean);
  if (!rows.length) return `<div class="nav-history empty">${escapeHtml(labels.empty)}</div>`;
  return `<ul class="nav-history">${rows.join("")}</ul>`;
}

/** Host-side check of the untrusted webview message. */
export function vetOpenDiff(raw: unknown): { type: "open-diff"; rev: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  return m.type === "open-diff" && typeof m.rev === "string" && SHA.test(m.rev) ? { type: "open-diff", rev: m.rev } : undefined;
}

/** Webview-side script (inline, CSP nonce by the host): click or Enter on a row posts open-diff. */
export const DIFF_HISTORY_SCRIPT = `(function(){const vs=acquireVsCodeApi();
function pick(el){const r=el&&el.closest&&el.closest(".nav-commit");if(!r)return;
document.querySelectorAll(".nav-commit.selected").forEach(e=>e.classList.remove("selected"));r.classList.add("selected");
vs.postMessage({type:"open-diff",rev:r.dataset.rev});}
document.addEventListener("click",e=>pick(e.target));
document.addEventListener("keydown",e=>{if(e.key==="Enter")pick(e.target);});})();`;

export const DIFF_HISTORY_CSS = `
.nav-history{list-style:none;margin:0;padding:0}
.nav-commit{padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border);cursor:pointer}
.nav-commit:hover,.nav-commit:focus{background:var(--vscode-list-hoverBackground);outline:none}
.nav-commit.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.nav-commit-head{display:flex;justify-content:space-between;gap:8px}
.nav-commit-msg{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav-commit-sha{font-family:var(--vscode-editor-font-family);opacity:.7}
.nav-commit-meta{font-size:.8em;opacity:.75}
.nav-commit-files{margin:2px 0 0 12px;padding:0;font-size:.8em;opacity:.8}
`;
