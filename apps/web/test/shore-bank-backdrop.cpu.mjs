// swimwall: the Eden expansion replaces the flat backdrop, and with it the captured pond's north/south bank closure
// (a brown wall up to 3.5 m above the expansion's own banks). Bundles the actual modules like the regional test.
import {createRequire} from 'node:module';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),temp=await mkdtemp(join(tmpdir(),'eden-shore-bank-backdrop-'));
try{
 const result=await build({stdin:{contents:`import assert from 'node:assert/strict';import {WorldGeometry} from '../src/WorldGeometry.ts';import {createWorldEdenExpansion} from '../src/WorldEdenExpansion.ts';import {SHORE_BANK_EDGE_NAME,isFlatBackdrop} from '../src/WorldShoreBankEdges.ts';
// the exact connected commons shore ground (fixture of graphics-water-leaves-twilight.test.ts): bed -3.5 m west, 0 east
const row=[-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.2,-2.9,-2.6,-2.3,-2,-1.87,-1.74,-1.6099999999999999,-1.48,-1.35,-1.22,-1.0899999999999999,-0.96,-0.8300000000000001,-0.7,-0.5700000000000001,-0.43999999999999995,-0.31000000000000005,-0.17999999999999994,-0.050000000000000044,0,0,0];
const terrain={id:'commons-shore-terrain/1',diagonal:'min-min/max-max',originXZ:[-62,-12],spacingMetres:1,columns:35,rows:25,heightMetres:Array.from({length:25},()=>[...row])},water={id:'commons-shore-water/1',datumY:-2,wetBoundsXZ:[-62,-12,-46,12]};
const geometry=new WorldGeometry(null,'grass',undefined,{profile:'connected-commons-shore/1',metadata:{terrain,water}});
const named=n=>{const out=[];geometry.group.traverse(o=>{if(o.name===n)out.push(o);});return out;};
const [bank]=named(SHORE_BANK_EDGE_NAME),outside=named('outside-ground'),bed=named(terrain.id)[0],surface=named(water.id)[0];
assert.ok(bank&&outside.length===4&&bed&&surface);
const flat=[];geometry.group.traverse(o=>{if(isFlatBackdrop(o))flat.push(o);});assert.deepEqual(new Set(flat),new Set([bank,...outside]));
const shown=()=>[bank.visible,outside.every(o=>o.visible),bed.visible,surface.visible];
assert.deepEqual(shown(),[true,true,true,true]);                 // plain old Eden: closure joins the bed to the flat backdrop
// the expansion's packs fetch site-relative assets, which node cannot; their "unavailable" notes are not this test's
const quiet={warn:console.warn,error:console.error};console.warn=console.error=()=>{};let expansion;
try{
 expansion=createWorldEdenExpansion();
 expansion.replaceCosmeticBackdrop(geometry.group);assert.deepEqual(shown(),[false,false,true,true]);  // expansion banks: no wall
}finally{expansion?.dispose();await new Promise(resolve=>setTimeout(resolve,0));Object.assign(console,quiet);}
assert.deepEqual(shown(),[true,true,true,true]);                 // disposal (like a history frame) gives both back
console.log('shore bank closure follows the replaced backdrop PASS');`,resolveDir:here,sourcefile:'shore-bank-backdrop.mjs',loader:'js'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',banner:{js:"globalThis.location=new URL('http://127.0.0.1/w/eden');"}});
 const file=join(temp,'shore-bank-backdrop.mjs');await writeFile(file,result.outputFiles[0].contents);await import(pathToFileURL(file).href);
}finally{await rm(temp,{recursive:true,force:true});}
