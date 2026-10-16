#!/usr/bin/env node
// Compare the copied character response before (identity) and after gzip, byte for byte.
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const [base = 'http://127.0.0.1:5890', out] = process.argv.slice(2);
const u = new URL(base);
if (!['localhost','127.0.0.1'].includes(u.hostname) || +u.port < 5890 || +u.port > 5899) throw new Error('speed lane ports only');
function read(path, encoding) { return new Promise((resolve, reject) => {
  const start = performance.now();
  const req = request(new URL(path, base), { headers: { 'accept-encoding': encoding } }, res => {
    const chunks = []; res.on('data', d => chunks.push(d));
    res.on('end', () => resolve({ body: Buffer.concat(chunks), status: res.statusCode, headers: res.headers, ms: performance.now()-start }));
  }); req.on('error', reject); req.end();
}); }
const results = [];
for (const name of ['casual','punk','woman']) {
  const path = `/modular/environment/animated-${name}.glb`;
  const a = await read(path, 'identity'), b = await read(path, 'gzip');
  if (a.status !== 200 || b.status !== 200 || b.headers['content-encoding'] !== 'gzip' || !gunzipSync(b.body).equals(a.body)) throw new Error(`invalid gzip response ${path}`);
  results.push({ path, identityBytes:a.body.length, gzipBytes:b.body.length, savedPct:+(100*(1-b.body.length/a.body.length)).toFixed(2), identityMs:+a.ms.toFixed(1), gzipMs:+b.ms.toFixed(1), decodedIdentical:true, vary:b.headers.vary, mime:b.headers['content-type'] });
}
if (out) writeFileSync(out, JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
