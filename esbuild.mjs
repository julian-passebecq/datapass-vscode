import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info"
});

// The Workbench webviews (editor tab, Architecture panel, Details side bar) run this in the browser sandbox.
await esbuild.build({
  entryPoints: ["src/webview/workbench.ts"],
  bundle: true,
  outfile: "dist/workbench.js",
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: false,
  logLevel: "info"
});
