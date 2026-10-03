import { readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import assert from 'node:assert/strict';
export async function compressHttp(path = 'public/browser/campus.glb') {
  const source = await readFile(path),
    encoded = brotliCompressSync(source, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    });
  assert.deepEqual(brotliDecompressSync(encoded), source);
  await writeFile(path + '.br', encoded);
  console.log(
    JSON.stringify({
      httpEncoding: 'br',
      decodedBytes: source.length,
      transferBytes: encoded.length,
      losslessVerified: true,
    }),
  );
}
if (import.meta.url === new URL(process.argv[1], 'file:').href)
  await compressHttp();
