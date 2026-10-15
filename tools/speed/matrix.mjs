#!/usr/bin/env node
// Run after starting the two documented fresh fixtures. Wrap this command in the speed heavy slot.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [phase='after', output='<team>/scratch/speed/'+phase] = process.argv.slice(2);
if (!['before','after','phone-before','phone'].includes(phase)) throw new Error('phase: before|after|phone-before|phone');
mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'build.json'),JSON.stringify({phase,at:new Date().toISOString(),indexSha256:createHash('sha256').update(readFileSync(resolve(root,'apps/web/dist/index.html'))).digest('hex')},null,2));
for (const [world, port] of [['mars',5890],['lm',5891]]) {
 const mobile=phase.startsWith('phone');
 const url=`http://127.0.0.1:${port}/w/speed-${world}?dev=1&weather=clear&dpr=fixed&loadqueue=${phase.endsWith('before')?'0':'1'}`;
 const args=[resolve(root,'tools/speed/probe.mjs'),url,'--seconds','4','--settle-max','120','--mbps','60','--label',phase,'--out',resolve(output,world)];
 if(mobile)args.push('--mobile');
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
