/** V4-NAV nav webview entry (dist/navView.js): mounts the one view renderer. */
import { mountNavView } from "./views/renderer";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const root = document.getElementById("nav-root");
if (root) mountNavView(root, m => vscode.postMessage(m));
