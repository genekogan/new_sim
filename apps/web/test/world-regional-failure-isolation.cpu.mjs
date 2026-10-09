// Renderer assembly has Vite JSON imports; bundle the actual production modules
// with the qualified existing esbuild runtime instead of altering their source.
import {createRequire} from 'node:module';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),temp=await mkdtemp(join(tmpdir(),'eden-regional-isolation-'));
try{
 const result=await build({stdin:{contents:`import assert from 'node:assert/strict';import {Terrain} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts';import {createWorldEdenExpansion} from '../src/WorldEdenExpansion.ts';
const original=Terrain.prototype.build,warn=console.warn;let owner;const errors=[];Terrain.prototype.build=function(){throw Error('synthetic regional terrain build failure');};console.warn=(...args)=>errors.push(String(args[0]));
try{owner=createWorldEdenExpansion();assert.ok(owner.group.children.length>3);assert.equal(owner.sampleVisualGround(226,-22),null);assert.equal(owner.sampleVisualGround(14,4),0);assert.ok(errors.some(x=>x.includes('regional scenery unavailable')));owner.dispose();assert.equal(owner.group.children.length,0);assert.equal(owner.sampleVisualGround(14,4),null);}finally{owner?.dispose();Terrain.prototype.build=original;await new Promise(resolve=>setTimeout(resolve,0));console.warn=warn;}console.log('actual regional failure isolation PASS');`,resolveDir:here,sourcefile:'actual-regional-assembly-isolation.mjs',loader:'js'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const file=join(temp,'isolation.mjs');await writeFile(file,result.outputFiles[0].contents);await import(pathToFileURL(file).href);
}finally{await rm(temp,{recursive:true,force:true});}
