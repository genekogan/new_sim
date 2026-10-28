// Optional server-owned art storage for original-image retrieval. No URL fetch,
// upload, render job, user-selected path or public storage discriminator.
import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { ART_LIMITS, validateUpload } from '../art/validate.ts';

export type ContextOriginal = { sha: string; ext: string; storage?: 'art' };
export type ArtOriginals = { dir: string; basePath: string };

/** Configuration comes from the server, never a request or entity field. */
export function checkArtOriginals(config: ArtOriginals | undefined) {
  if (!config) return;
  if (!isAbsolute(config.dir) || !(config.basePath === '' || /^\/[a-zA-Z0-9/_-]+$/.test(config.basePath) && !/\s/.test(config.basePath) && !config.basePath.endsWith('/') && !config.basePath.includes('//')))
    throw new Error('artOriginals requires an absolute directory and canonical local world basePath');
}

export function contextOriginal(media: unknown, artBasePath?: string): ContextOriginal | undefined {
  if (typeof media !== 'string') return;
  // Retain the existing asset-reference behavior when no art configuration exists.
  const asset = /^\/assets\/([a-f0-9]{64})\.(png|jpg)$/.exec(media);
  if (asset) return { sha: asset[1], ext: asset[2] };
  if (artBasePath === undefined) return;
  const prefix = `${artBasePath}/art/`;
  if (!media.startsWith(prefix)) return;
  const tail = media.slice(prefix.length), match = /^([a-f0-9]{64})\.(png|jpg|webp|gif)$/.exec(tail);
  // JS $ can match before a final newline; exact reconstruction forbids that too.
  if (!match || tail !== `${match[1]}.${match[2]}`) return;
  return { sha: match[1], ext: match[2], storage: 'art' };
}

/** Read only a regular bounded file selected by an already validated hash/ext.
 * O_NOFOLLOW forbids symlink substitution; O_NONBLOCK avoids blocking on a FIFO.
 * Preserve the exact original bytes (including painting publication metadata).
 */
export function readArtOriginal(config: ArtOriginals, original: ContextOriginal): { bytes: Uint8Array; type: string } | null {
  if (original.storage !== 'art' || original.sha.length !== 64 || !/^[a-f0-9]{64}$/.test(original.sha) || !['png', 'jpg', 'webp', 'gif'].includes(original.ext)) return null;
  let fd: number | undefined;
  try {
    fd = openSync(join(config.dir, `${original.sha}.${original.ext}`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > ART_LIMITS.imageBytes) return null;
    const buffer = Buffer.alloc(stat.size + 1); let length = 0;
    while (length < buffer.length) { const n = readSync(fd, buffer, length, buffer.length - length, length); if (!n) break; length += n; }
    if (length !== stat.size) return null;
    const bytes = buffer.subarray(0, length), upload = validateUpload(bytes);
    if (upload.kind !== 'image' || upload.format !== original.ext || createHash('sha256').update(bytes).digest('hex') !== original.sha) return null;
    return { bytes, type: upload.type };
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
