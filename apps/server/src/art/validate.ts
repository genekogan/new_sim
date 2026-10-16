// W6 upload seam: the one place art uploads are checked before they are stored. Lane C2 (moderation) owns upload
// validation, veto and the classifier hook; when its `moderation/intake.ts` lands on main, call `intakeUpload` from
// here (surface 'art') for images and keep the video checks below. Until then this does the minimum: sniff the real
// format from the bytes (never trust the content-type), cap sizes and image dimensions, refuse anything else.
export type ArtFormat = 'png' | 'jpg' | 'webp' | 'gif' | 'mp4' | 'webm';
export const ART_TYPES: Record<ArtFormat, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' };
export const ART_LIMITS = { imageBytes: 4 * 1024 * 1024, videoBytes: 16 * 1024 * 1024, imagePx: 4096 };
export class ArtRejected extends Error { readonly status: number; readonly code: string; constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; } }

export function sniffArt(b: Uint8Array): ArtFormat | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length < 16) return null;
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return 'mp4';   // ISO BMFF 'ftyp' box (mp4, m4v, mov-compatible)
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'webm';   // EBML header
  return null;
}
/** Width × height for PNG/GIF/JPEG/WebP(VP8X, VP8, VP8L); null when the header cannot be read (refused). */
export function imageSize(b: Uint8Array, f: ArtFormat): [number, number] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (f === 'png') return [dv.getUint32(16), dv.getUint32(20)];
    if (f === 'gif') return [dv.getUint16(6, true), dv.getUint16(8, true)];
    if (f === 'webp') {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
      if (kind === 'VP8 ') return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff];
      if (kind === 'VP8L') { const v = dv.getUint32(21, true); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
      return null;
    }
    if (f === 'jpg') {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1], len = dv.getUint16(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
        i += 2 + len;
      }
    }
  } catch { return null; }
  return null;
}

/** The seam: check one art upload. Returns the sniffed format; throws ArtRejected with a plain reason. */
export function validateUpload(bytes: Uint8Array): { format: ArtFormat; type: string; kind: 'image' | 'video'; size?: [number, number] } {
  if (!bytes.byteLength) throw new ArtRejected(400, 'art.empty', 'send the file as the raw request body');
  const format = sniffArt(bytes);
  if (!format) throw new ArtRejected(415, 'art.type', 'art must be a PNG, JPEG, WebP or GIF image, or an MP4 or WebM video');
  const kind = format === 'mp4' || format === 'webm' ? 'video' : 'image';
  const max = kind === 'video' ? ART_LIMITS.videoBytes : ART_LIMITS.imageBytes;
  if (bytes.byteLength > max) throw new ArtRejected(413, 'art.too-big', `${kind}s may be at most ${max / 1024 / 1024} MB`);
  if (kind === 'image') {
    const size = imageSize(bytes, format);
    if (!size || !(size[0] > 0 && size[1] > 0)) throw new ArtRejected(422, 'art.malformed', 'the image header could not be read');
    if (Math.max(...size) > ART_LIMITS.imagePx) throw new ArtRejected(413, 'art.too-large', `images may be at most ${ART_LIMITS.imagePx} px on a side`);
    return { format, type: ART_TYPES[format], kind, size };
  }
  return { format, type: ART_TYPES[format], kind };
}
