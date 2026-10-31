#!/usr/bin/env node
// Run after starting the two documented fresh fixtures. Wrap this command in the speed heavy slot.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from '../lib/paths.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [phase='after', output=(process.env.SPEED_SCRATCH??scratchDir('speed'))+'/'+phase] = process.argv.slice(2);
const [P0,P1]=(process.env.SPEED_PORTS??'5890,5891').split(',').map(Number);
if(phase==='all') { for(const part of ['before','after','phone']) { const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),part,resolve(output,part)],{cwd:root,stdio:'inherit'}); if(r.status!==0)process.exit(r.status??1); } process.exit(0); }
if (!['before','after','phone-before','phone'].includes(phase)) throw new Error('phase: all|before|after|phone-before|phone');
mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'build.json'),JSON.stringify({phase,at:new Date().toISOString(),indexSha256:createHash('sha256').update(readFileSync(resolve(root,'apps/web/dist/index.html'))).digest('hex')},null,2));
for (const [world, port] of [['mars',P0],['lm',P1]]) {
 const mobile=phase.startsWith('phone');
 const camera = world==='mars' ? 'eye=-66.958,30.320,81.837&at=0,0,0' : 'eye=-66.958,32.364,173.337&at=0,2.044,91.5';
 const url=`http://127.0.0.1:${port}/w/speed-${world}?dev=1&weather=clear&dpr=fixed&${camera}&loadqueue=${phase.endsWith('before')?'0':'1'}`;
 const args=[resolve(root,'tools/speed/probe.mjs'),url,'--seconds','4','--settle-max','120','--mbps','60','--label',phase,'--out',resolve(output,world)];
 if(mobile)args.push('--mobile');
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
