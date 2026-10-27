import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Only this worktree's changed/untracked sources and the renderer's build graph. */
export function sourceReceipt(root,webDir){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 const names=[...new Set([...git(['diff','--name-only','-z','HEAD']),...git(['ls-files','--others','--exclude-standard','-z'])])].sort();
 const sources=names.map(path=>{const file=resolve(root,path);if(!existsSync(file))return{path,deleted:true};const bytes=readFileSync(file);return{path,bytes:bytes.length,sha256:sha(bytes)};});
 const buildFiles=new Set(['context-view.html','.vite/manifest.json']);
 const manifestPath=resolve(webDir,'.vite/manifest.json');
 if(existsSync(manifestPath)){
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),seen=new Set();
  const visit=key=>{if(seen.has(key))return;seen.add(key);const row=manifest[key];if(!row)return;buildFiles.add(row.file);for(const path of [...(row.css??[]),...(row.assets??[])])buildFiles.add(path);for(const key of [...(row.imports??[]),...(row.dynamicImports??[])])visit(key);};
  visit('context-view.html');
 }
 const build=[...buildFiles].sort().map(path=>{const file=resolve(webDir,path);if(!existsSync(file))return{path,missing:true};const bytes=readFileSync(file);return{path,bytes:bytes.length,sha256:sha(bytes)};});
 return{contract:'context-source-receipt/1',head:git(['rev-parse','HEAD'])[0].trim(),sources,build,sha256:sha(Buffer.from(JSON.stringify({sources,build})))};
}
