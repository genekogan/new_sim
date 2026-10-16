// The shared library's one moderation seam (lane C16 `library`, backlog M4).
//
// Every contribution to the shared library (each def body as JSON, each model file) passes ONE call,
// `validateUpload(bytes, policy)`, before the library stores anything. The signature is the subset of lane C2
// `moderation`'s `apps/server/src/moderation/validate.ts` `validateUpload(input, policy)` the library uses, so the
// server wires the real gate in (`new SharedLibrary(dir, { gate: validateUpload })`) once that lane merges; the CLI and
// the tests use this local stand-in, which checks the format by magic bytes, the size, JSON shape and GLB container
// layout, and refuses external or data URIs inside a GLB. It never rewrites bytes (the real gate may strip metadata:
// the library then stores and references the gate's output sha, so a stripped file stays content-addressed).
import { createHash } from 'node:crypto';

export type UploadFormat = 'glb' | 'png' | 'jpg' | 'json';
export type LibraryUploadPolicy = { formats: UploadFormat[]; maxBytes: number };
export type GatedUpload = { format: UploadFormat; sha: string; bytes: Uint8Array };
export type UploadGate = (bytes: Uint8Array, policy: LibraryUploadPolicy) => GatedUpload;

export class LibraryUploadRejected extends Error {
  readonly code: string;
  constructor(code: string, msg: string) { super(`${code}: ${msg}`); this.code = code; }
}

/** Def JSON: small. Model files: the default per-world asset budget (the target world re-checks its own on upload). */
export const DEF_POLICY: LibraryUploadPolicy = { formats: ['json'], maxBytes: 256 * 1024 };
export const ASSET_POLICY: LibraryUploadPolicy = { formats: ['glb', 'png', 'jpg', 'json'], maxBytes: 32 * 1024 * 1024 };

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function sniff(b: Uint8Array): UploadFormat | 'unknown' {
  if (b.length >= 12 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) return 'glb';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  const first = b.find((c) => c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09);
  if (first === 0x7b || first === 0x5b) return 'json';
  return 'unknown';
}

/** The local stand-in for lane C2's gate (same call shape). Pure; throws LibraryUploadRejected. */
export function validateUpload(bytes: Uint8Array, policy: LibraryUploadPolicy): GatedUpload {
  if (!bytes.byteLength) throw new LibraryUploadRejected('upload.empty', 'nothing to store');
  if (bytes.byteLength > policy.maxBytes) throw new LibraryUploadRejected('upload.size', `${bytes.byteLength} bytes > ${policy.maxBytes}`);
  const format = sniff(bytes);
  if (format === 'unknown' || !policy.formats.includes(format)) throw new LibraryUploadRejected('upload.format', `a ${format} file is not accepted here (${policy.formats.join(', ')})`);
  if (format === 'json') {
    try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new LibraryUploadRejected('upload.malformed', 'the JSON does not parse'); }
  }
  if (format === 'glb') {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== bytes.byteLength) throw new LibraryUploadRejected('upload.malformed', 'GLB header length or version is wrong');
    const jsonLen = v.getUint32(12, true);
    if (v.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > bytes.byteLength) throw new LibraryUploadRejected('upload.malformed', 'GLB has no JSON chunk');
    let gltf: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    try { gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))); }
    catch { throw new LibraryUploadRejected('upload.malformed', 'GLB JSON chunk does not parse'); }
    for (const x of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) if (x.uri) throw new LibraryUploadRejected('upload.external', 'a GLB in the library must be self-contained (no external or data URIs)');
  }
  return { format, sha: sha256(bytes), bytes };
}
