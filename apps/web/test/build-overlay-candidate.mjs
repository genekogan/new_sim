// Build PM's installed web source (read-only) with App overlay files substituted, output under App's run dir.
// Usage: node apps/web/test/build-overlay-candidate.mjs <overlaySrcDir> <outDir>
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
// PM_WEB_DIR: the installed web tree to overlay (default: this checkout's apps/web).
const PMWEB=resolve(process.env.PM_WEB_DIR??fileURLToPath(new URL('..',import.meta.url))),PMSRC=PMWEB+'/src',[ov,out]=process.argv.slice(2).map(p=>resolve(p));
const require=createRequire(PMWEB+'/package.json'),{build}=await import(require.resolve('vite'));
const overlay={name:'app-overlay',enforce:'pre',
 async resolveId(src,importer){
  if(!importer)return null;
  const from=importer.startsWith(ov)?join(PMSRC,importer.slice(ov.length+'/apps/web/src'.length)):importer;
  if(!src.startsWith('.'))return importer.startsWith(ov)?this.resolve(src,from,{skipSelf:true}):null;
  const target=resolve(dirname(from),src);
  if(target.startsWith(PMSRC+'/')){const o=join(ov,'apps/web/src',target.slice(PMSRC.length+1));if(existsSync(o))return o;if(importer.startsWith(ov))return existsSync(target)?target:null;}
  return null;}};
await build({root:PMWEB,configFile:PMWEB+'/vite.config.ts',cacheDir:out+'-vite-cache',logLevel:'warn',plugins:[overlay],build:{outDir:out,emptyOutDir:true}});
console.log(JSON.stringify({built:out,overlay:ov}));
