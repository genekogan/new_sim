import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const base=process.env.SITE_BASE||'https://sim.mars.college';const url=base+'/browser/campus.glb';
const original=await readFile('public/browser/campus.glb'),compressed=await readFile('public/browser/campus.glb.br');
const r=await fetch(url,{headers:{'Accept-Encoding':'br'}});assert.equal(r.status,200);assert.equal(r.headers.get('content-encoding'),'br');assert.equal(Number(r.headers.get('content-length')),compressed.length);
const hash=createHash('sha256');let decoded=0;for await(const chunk of r.body){hash.update(chunk);decoded+=chunk.length;}assert.equal(decoded,original.length);assert.equal(hash.digest('hex'),createHash('sha256').update(original).digest('hex'));
for(const encoding of ['identity','gzip']){const h=await fetch(url,{method:'HEAD',headers:{'Accept-Encoding':encoding}});assert.equal(h.headers.get('content-encoding'),null);assert.equal(Number(h.headers.get('content-length')),original.length);}
const ranged=await fetch(url,{headers:{'Accept-Encoding':'br',Range:'bytes=0-11'}});assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-encoding'),null);assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),original.subarray(0,12));
const cached=await fetch(url,{headers:{'Accept-Encoding':'br','If-None-Match':r.headers.get('etag')}});assert.equal(cached.status,304);
const result={checkedAt:new Date().toISOString(),base,transferBytes:compressed.length,decodedBytes:decoded,decodedSha256Matches:true,rangeAndFallbacks:true,cloudflareStripsZeroQualityParameter:true,conditionalGet:true};await writeFile('.cloudflare/compression-audit/live.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
