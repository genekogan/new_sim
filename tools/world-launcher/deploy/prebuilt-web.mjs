// Install a previously built web artifact only for its exact source and release flags.
// The build runs on Modal; this verifier keeps release.sh's normal checks in force.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function inventory(root, relative = '') {
  const rows = [];
  for (const name of readdirSync(join(root, relative)).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    const full = join(root, path), stat = lstatSync(full);
    if (stat.isDirectory()) rows.push(...inventory(root, path));
    else if (stat.isFile()) rows.push({ path, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
    else throw Error(`Unsupported web artifact entry: ${path}`);
  }
  return rows;
}

export function seal(root, identity) {
  if (!/^[a-f0-9]{40}$/.test(identity.sourceSha)) throw Error('Full source SHA required');
  const files = inventory(join(root, 'dist'));
  if (!files.some(f => f.path === 'index.html')) throw Error('Missing index.html');
  const receipt = { schema: 1, ...identity, files };
  writeFileSync(join(root, 'WEB-BUILD.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

export function install(root, destination, expected) {
  const receipt = JSON.parse(readFileSync(join(root, 'WEB-BUILD.json'), 'utf8'));
  if (receipt.schema !== 1) throw Error('Unsupported web build receipt');
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) throw Error(`Web build ${key} mismatch`);
  }
  const actual = inventory(join(root, 'dist'));
  if (JSON.stringify(actual) !== JSON.stringify(receipt.files)) throw Error('Web artifact inventory/hash mismatch');
  if (!actual.some(f => f.path === 'index.html')) throw Error('Missing index.html');
  if (existsSync(destination)) throw Error('Refusing to replace an existing web output');
  mkdirSync(destination, { recursive: true });
  for (const file of actual) {
    const target = join(destination, file.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, 'dist', file.path), target);
  }
  // Verify the copy, too, before any release can be uploaded.
  if (JSON.stringify(inventory(destination)) !== JSON.stringify(receipt.files)) throw Error('Installed web artifact differs');
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, root, destination, sourceSha, buildId, base, cdn, cdnOrigin, edenWorlds, arrivalUI, goatCounter, godUploadsCdn] = process.argv.slice(2);
  const identity = { sourceSha, buildId, base, cdn, cdnOrigin, edenWorlds, arrivalUI, goatCounter, godUploadsCdn };
  if (operation === 'install') install(root, destination, identity);
  else if (operation === 'seal') seal(root, identity);
  else throw Error('Expected install or seal');
  console.log(`Web artifact ${operation}: ${buildId}`);
}
