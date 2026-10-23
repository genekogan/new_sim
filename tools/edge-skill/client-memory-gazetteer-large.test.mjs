import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClientMemory,gazetteerChunks} from './client-memory.mjs';
// LIVE4H 2026-10-22: eden-2026 has 1,505 places; a single gazetteer record (<= 1000 places / 64 KB) was refused on every boot.
const place=i=>({id:`eden-2026-place-${String(i).padStart(5,'0')}`,name:`Place ${i} `+'with a long descriptive name '.repeat(i%7?1:9),walkable:i%3!==0,kind:'room',goodFor:['read','talk','rest','paint','sing','listen','cook','eat','swim','dance','sleep','think','walk','extra'].slice(0,1+i%14)});
const allText=dir=>readdirSync(dir).map(f=>join(dir,f)).map(p=>statSync(p).isDirectory()?allText(p):readFileSync(p,'utf8')).join('\n');
for(const n of [1505,5000])test(`gazetteer of ${n} places saves in bounded chunks and replays whole after a cold restart`,t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-memory-gazetteer-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const problems=[];const now=()=>'2026-10-22T12:00:00.000Z';const cache={places:Array.from({length:n},(_,i)=>place(i))};
 let memory=openClientMemory(root,{scope:'synthetic',now,onProblem:e=>problems.push(String(e?.message??e))});memory.catalogue(cache);
 assert.deepEqual(problems,[]);
 const chunks=gazetteerChunks(cache.places.map(p=>({id:p.id,name:p.name,goodFor:p.goodFor})));
 assert.equal(chunks.flat().length,n);assert.ok(chunks.length>=Math.ceil(n/1000));
 for(const c of chunks){assert.ok(c.length<=1000);assert.ok(Buffer.byteLength(JSON.stringify(c))<60*1024);assert.ok(c.every(p=>p.goodFor.length<=12&&p.name.length<=100));}
 const text=allText(join(root,'memory'));for(const i of [0,999,1000,n-1])assert.ok(text.includes(place(i).id),`place ${i} in memory`);
 memory=openClientMemory(root,{scope:'synthetic',now,onProblem:e=>problems.push(String(e?.message??e))});memory.catalogue(cache);
 assert.deepEqual(problems,[]);assert.equal(allText(join(root,'memory')),text);
});
