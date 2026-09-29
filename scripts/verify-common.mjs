import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'vendor/common/manifest.json'), 'utf8'));
if (manifest.schema !== 'datapass.vendored-common/1' || manifest.internalOnly !== true) throw new Error('Unrecognized Common candidate manifest');
for (const artifact of manifest.artifacts) {
  if (!/^[a-z0-9.-]+\.tgz$/.test(artifact.file) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('Unsafe Common artifact reference');
  const digest = createHash('sha256').update(readFileSync(resolve(root, 'vendor/common', artifact.file))).digest('hex');
  if (digest !== artifact.sha256) throw new Error(`Common candidate digest mismatch: ${artifact.file}`);
}
console.log(`Verified ${manifest.artifacts.length} pinned internal Common tarballs`);
