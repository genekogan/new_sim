// Resident looks v2: the automatic portrait. A humanoid look gets a server-rendered (CPU, no browser) straight-on
// portrait stored as the Soul's profile photo; a new look redraws it; an owner upload wins; clearing it goes back to auto.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {deflateSync} from 'node:zlib';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import {Hono} from 'hono';
import {AutoPortraits,AUTO_PORTRAIT_STYLE} from './portrait/auto-portraits.ts';import {SoulProfiles} from './soul-profile.ts';import {validateProfilePNG} from './profile-png.ts';

function png(w:number,h:number,rgb:[number,number,number]){const crcT=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const crc=(d:Buffer)=>{let n=0xffffffff;for(const b of d)n=crcT[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
 const chunk=(t:string,d:Buffer)=>{const o=Buffer.alloc(12+d.length);o.writeUInt32BE(d.length,0);o.write(t,4,'ascii');d.copy(o,8);o.writeUInt32BE(crc(o.subarray(4,8+d.length)),8+d.length);return o;};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)raw.set(rgb,y*(w*3+1)+1+x*3);
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');}

test('PORTRAIT: auto portrait drawn for a look, redrawn on change, custom photo wins, reset returns to auto',{timeout:120000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'body-portrait-')),f=fixture(join(dir,'sim.db'),factory,{durableClockV1:true});f.brain.quiesce();
 const portraits=new AutoPortraits(f.host,{enabled:true,sweepMs:0}),profiles=new SoulProfiles(f.host,f.souls);profiles.autoBytes=(id,h)=>portraits.bytes(id,h);
 t.after(()=>{portraits.dispose();f.host.stop();if(f.db.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});});
 await invite(f,'a');const row=await accept(f.host,f.souls.create('dev:a',{name:'Portrait A',description:'scripted portrait test'}));
 const token=f.souls.pairExchange(f.souls.pairCode(row,'http://127.0.0.1:6361').code,'scripted').token;
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
 const put=async(body:unknown)=>{const r=await accept(f.host,Promise.resolve(app.request('/v1/edge/body',{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}))) as Response;assert.equal(r.status,200,await r.clone().text());return (await r.json()).body;};
 // no humanoid look yet (an unparameterised body): no automatic portrait, nothing queued
 portraits.sweep();await portraits.drain();assert.equal(f.host.profilePhoto(row.id),null);assert.equal(f.host.profilePhotoSource(row.id),null);
 // a look: the applied assignment queues a portrait; it becomes the profile photo
 const b1=await put({look:{frame:'fem',hair:'bob',hat:'sunhat',glasses:'round',skin:'#8f5b3f',top1:'#a03a3a'}});
 await new Promise(r=>setTimeout(r,10));await portraits.drain(60000);
 const p1=f.host.profilePhoto(row.id);assert.ok(p1,'auto portrait stored');assert.equal(f.host.profilePhotoSource(row.id),'auto');assert.equal(p1!.width,256);assert.equal(p1!.height,256);
 assert.ok(portraits.current(row.id));assert.match(p1!.url,new RegExp(`/v1/souls/${row.id}/profile-photo/${p1!.hash}$`));
 const bytes=profiles.photoBytes(row.id,p1!.hash);assert.ok(bytes,'served by the existing photo route');assert.equal(validateProfilePNG('data:image/png;base64,'+Buffer.from(bytes!).toString('base64')).photo.hash,p1!.hash);
 const card=f.host.publicSoul(f.host.minds.get(row.id)!);assert.equal(card.profilePhoto?.hash,p1!.hash,'the public Soul card carries it');assert.equal(profiles.view(row.id).photoSource,'auto');
 const stored=f.db.db.prepare('SELECT look_key FROM soul_auto_portraits_v1 WHERE soul_id=?').get(row.id) as {look_key:string};assert.equal(stored.look_key,`${AUTO_PORTRAIT_STYLE}:${b1.model}`);
 // a new look redraws it (different pixels, same single row)
 await put({look:{hat:'none',hair1:'#ddc28e'}});await new Promise(r=>setTimeout(r,10));await portraits.drain(60000);
 const p2=f.host.profilePhoto(row.id)!;assert.notEqual(p2.hash,p1!.hash);assert.equal((f.db.db.prepare('SELECT COUNT(*) n FROM soul_auto_portraits_v1').get() as {n:number}).n,1);
 assert.equal(profiles.photoBytes(row.id,p1!.hash),null,'the old portrait is gone');
 // a custom upload always wins; the automatic portrait stays in reserve
 const custom=await accept(f.host,profiles.photo(row.owner,row.id,{dataUrl:png(4,4,[200,40,40])}));assert.equal(custom.photoSource,'custom');
 assert.notEqual(f.host.profilePhoto(row.id)!.hash,p2.hash);assert.equal(f.host.profilePhotoSource(row.id),'custom');
 await put({look:{hat:'cap'}});await new Promise(r=>setTimeout(r,10));await portraits.drain(60000);
 assert.equal(f.host.profilePhotoSource(row.id),'custom','a look change never replaces an uploaded photo');assert.ok(portraits.current(row.id),'the reserve portrait follows the look');
 // back to auto
 const reset=await accept(f.host,profiles.clearPhoto(row.owner,row.id));assert.equal(reset.photoSource,'auto');assert.equal(f.host.profilePhoto(row.id)!.hash,portraits.photo(row.id)!.hash);
 const again=await accept(f.host,profiles.clearPhoto(row.owner,row.id));assert.equal(again.revision,reset.revision,'reset is idempotent');
 // a non-humanoid body (a creature) has no automatic portrait; the viewer's own render is used
 const r=await accept(f.host,Promise.resolve(app.request('/v1/edge/body',{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({preset:'duck'})}))) as Response;
 if(r.status===200){assert.equal(f.host.profilePhoto(row.id),null);assert.equal(f.host.profilePhotoSource(row.id),null);}
});
