import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'vendor/runtime');
const destination = resolve(root, 'dist/runtime');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = JSON.parse(await readFile(resolve(source, 'pin.json'), 'utf8'));
if (pin.schema !== 'datapass.runtime-payload/1' || pin.internalOnly !== true || !/^[a-z0-9-]+\.zip$/.test(pin.archive)) throw new Error('Invalid runtime pin');
const archivePath = resolve(source, pin.archive);
if ((await lstat(archivePath)).size > 32 * 1024 * 1024) throw new Error('Runtime archive exceeds limit');
const archive = await readFile(archivePath);
const manifestBytes = await readFile(resolve(source, 'manifest.json'));
if (hash(archive) !== pin.archiveSha256 || hash(manifestBytes) !== pin.manifestSha256) throw new Error('Runtime archive/manifest integrity mismatch');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (!Array.isArray(manifest.files) || manifest.files.length !== pin.files || pin.files > 4096) throw new Error('Invalid runtime inventory');
const expected = new Map(); let total = 0;
for (const file of manifest.files) {
  if (!/^[A-Za-z0-9_.\/-]+$/.test(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..') || expected.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 64 * 1024 * 1024) throw new Error('Invalid runtime entry');
  expected.set(file.path, file); total += file.bytes;
}
if (total !== pin.uncompressedBytes || total > 256 * 1024 * 1024) throw new Error('Invalid runtime size');
const zip = await new Promise((resolveZip, reject) => yauzl.fromBuffer(archive, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => err ? reject(err) : resolveZip(zip)));
const seen = new Set();
await mkdir(destination, { recursive: true });
await new Promise((done, reject) => {
  const fail = error => { zip.close(); reject(error); };
  zip.on('error', fail);
  zip.on('entry', entry => { void (async () => {
    const file = expected.get(entry.fileName);
    const type = (entry.externalFileAttributes >>> 16) & 0xf000;
    if (!file || seen.has(entry.fileName) || entry.uncompressedSize !== file.bytes || (type !== 0 && type !== 0x8000) || (entry.generalPurposeBitFlag & 1)) throw new Error('Unexpected runtime ZIP entry');
    seen.add(entry.fileName);
    const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (err, stream) => err ? rejectStream(err) : resolveStream(stream)));
    const chunks = []; let bytes = 0;
    for await (const chunk of stream) { bytes += chunk.length; if (bytes > file.bytes) throw new Error('Runtime entry exceeds limit'); chunks.push(chunk); }
    const content = Buffer.concat(chunks);
    if (content.length !== file.bytes || hash(content) !== file.sha256) throw new Error('Runtime entry integrity mismatch');
    const target = resolve(destination, file.path);
    if (!target.startsWith(destination + sep)) throw new Error('Runtime path escape');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
    zip.readEntry();
  })().catch(fail); });
  zip.on('end', done); zip.readEntry();
});
if (seen.size !== expected.size) throw new Error('Missing runtime ZIP entry');
await writeFile(resolve(root, 'dist/runtime-manifest.json'), manifestBytes);
console.log(`Prepared ${seen.size} pinned runtime files (${total} bytes); no network acquisition`);
