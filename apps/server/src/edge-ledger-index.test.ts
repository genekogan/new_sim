// PM-R049: index.html is re-read when it changes (frontend installs need no restart).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
test('web index reloads on change',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'edge-web-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'index.html'),'<p>one</p>');
 const f=fixture(':memory:');t.after(()=>{f.host.stop();f.db.close();});
 const app=buildApp({cfg:{...f.brain.cfg,webDir:dir,marsWebDir:join(dir,'none')},db:f.db,host:f.host,auth:f.auth,brain:f.brain,souls:f.souls,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
 assert.match(await (await app.request('/some/page')).text(),/one/);
 writeFileSync(join(dir,'index.html'),'<p>two</p>');const later=new Date(Date.now()+5000);utimesSync(join(dir,'index.html'),later,later);
 assert.match(await (await app.request('/some/page')).text(),/two/);
});
