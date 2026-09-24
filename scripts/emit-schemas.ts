/**
 * Emit JSON Schema files from the TypeScript schema definitions so editors validate
 * .datapass files with the same rules the extension enforces. tests/schemas.test.ts fails
 * if the committed files drift from these definitions.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { emittedSchemaFiles } from "../src/core/contracts/schemaFiles";

for (const [file, schema] of Object.entries(emittedSchemaFiles())) {
  mkdirSync(file.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(file, JSON.stringify(schema, null, 2) + "\n");
  console.log(`wrote ${file}`);
}
