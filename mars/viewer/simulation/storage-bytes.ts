/** UTF-8 accounting is shared by SQLite persistence and its admission caps. */
export const CHUNK_BYTES = 512 * 1024;
export const MAX_BLOB_BYTES = 8 * 1024 * 1024;
export const MAX_ROOM_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
export const utf8Bytes = (text: string): number => encoder.encode(text).byteLength;

/** Split at Unicode code-point boundaries, never between a surrogate pair. */
export function* utf8Chunks(text: string, cap = CHUNK_BYTES): Generator<string> {
  if (!Number.isSafeInteger(cap) || cap < 4) throw new RangeError('UTF-8 chunk cap must be an integer of at least 4 bytes');
  let start = 0, bytes = 0;
  for (let i = 0; i < text.length;) {
    const point = text.codePointAt(i)!;
    const width = point > 0xffff ? 2 : 1;
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes + size > cap) {
      yield text.slice(start, i);
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += width;
  }
  if (start < text.length || text.length === 0) yield text.slice(start);
}

export class StorageCapacityError extends Error {
  code = 'room.storage-bytes';
}
