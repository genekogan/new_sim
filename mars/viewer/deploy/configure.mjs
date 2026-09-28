import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url),
  out = new URL('dist/server/', root);
await mkdir(out, { recursive: true });
const assets = await readFile(
  new URL('.cloudflare/large-assets.json', root),
  'utf8',
);
await copyFile(
  new URL('deploy/downloads.mjs', root),
  new URL('downloads.js', out),
);
await build({
  entryPoints: [new URL('simulation/worker.ts', root).pathname],
  outfile: new URL('simulation.js', out).pathname,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:workers', 'node:*'],
  target: 'es2022',
});
await writeFile(
  new URL('cloudflare-entry.js', out),
  `
import {handleSimulation} from './simulation.js';
export {MarsSimulation} from './simulation.js';
import {serveDownload} from './downloads.js';
const assets=${assets};
export default {async fetch(request,env,ctx){
 const result=await handleSimulation(request,env,ctx);if(result)return result;
 const url=new URL(request.url),path=url.pathname;
 if(Object.hasOwn(assets,path))return serveDownload(request,env.MODELS,assets[path]);
 if(path==='/questions')return Response.redirect(new URL('/questions/',url),301);
 if(path==='/questions/'){ // Gene's questions page (deploy/prepare.py stages docs/engineering/questions/)
  url.pathname='/questions/index.html';const response=await env.ASSETS.fetch(new Request(url,request));
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-cache');
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
 }
 if(['/', '/studio', '/studio/', '/simulation-guide', '/simulation-guide/', '/lab', '/lab/'].includes(path) || /^\\/studio\\/202[0-6]\\/?$/.test(path)){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  url.pathname='/index.html';const response=await env.ASSETS.fetch(new Request(url,request));
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-cache');
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
 }
 return new Response('Not found',{status:404});
}};
`,
);
const config = {
  name: 'mars-campus-2026',
  main: 'cloudflare-entry.js',
  compatibility_date: '2026-09-22',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: true,
  preview_urls: false,
  assets: {
    directory: '../client',
    binding: 'ASSETS',
    not_found_handling: 'none',
    html_handling: 'none',
  },
  r2_buckets: [{ binding: 'MODELS', bucket_name: 'mars-campus-2026-models' }],
  durable_objects: {
    bindings: [{ name: 'SIMULATIONS', class_name: 'MarsSimulation' }],
  },
  migrations: [
    { tag: 'simulation-v1', new_sqlite_classes: ['MarsSimulation'] },
  ],
  observability: { enabled: true, head_sampling_rate: 0.1 },
};
await writeFile(
  new URL('cloudflare.json', out),
  JSON.stringify(config, null, 2),
);
console.log('Static viewer and simulation Worker ready.');
