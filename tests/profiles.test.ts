import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateProjectProfile } from "../src/core/profiles";

test("profile validator accepts a simple project profile", () => {
  assert.deepEqual(
    validateProjectProfile({
      id:"foil",
      title:"FOIL",
      repoBindings:[{id:"control",label:"Control",setting:"foil.controlRoot"}],
      platformBindings:["fabric"]
    }),
    []
  );
});

test("profile validator detects duplicate binding ids", () => {
  const issues = validateProjectProfile({
    id:"x",
    title:"X",
    repoBindings:[
      {id:"repo",label:"One",setting:"a"},
      {id:"repo",label:"Two",setting:"b"}
    ],
    platformBindings:[]
  });
  assert.ok(issues.some(issue => issue.includes("Duplicate")));
});

// V1-FOILSURF (journey R04): searching Settings or the Command Palette for "foil" finds nothing.
test("no FOIL-named setting, command, menu entry or activation event is contributed", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const contributes = pkg.contributes;
  for (const [key, value] of Object.entries(contributes.configuration.properties as Record<string, unknown>)) {
    assert.doesNotMatch(`${key} ${JSON.stringify(value)}`, /foil/i, key);
  }
  for (const c of contributes.commands as Array<{ command: string; title: string }>) {
    assert.doesNotMatch(`${c.command} ${c.title}`, /foil/i, c.command);
  }
  for (const entries of Object.values(contributes.menus as Record<string, Array<{ command?: string }>>)) {
    for (const e of entries) assert.doesNotMatch(e.command ?? "", /foil/i, e.command);
  }
  for (const ev of (pkg.activationEvents ?? []) as string[]) assert.doesNotMatch(ev, /foil/i, ev);
});

// Old configurations may still set datapass.foil.controlRoot / databricksRoot / oracleSshHost:
// VS Code keeps unknown keys without error, and no source reads them any more, so they are ignored.
test("the retired datapass.foil.* settings are never read", () => {
  const files = (readdirSync("src", { recursive: true }) as string[]).filter(f => f.endsWith(".ts"));
  for (const f of files) {
    const code = readFileSync(join("src", f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /["'`]foil\.(controlRoot|databricksRoot|oracleSshHost)["'`]/, f);
    assert.doesNotMatch(code, /datapass\.(selectFoil|initializeFoil)/, f);
  }
});
