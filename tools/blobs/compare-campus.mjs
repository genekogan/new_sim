#!/usr/bin/env node
// Lane BLOBS: does the shrunk campus look the same? Renders the original and the candidate GLB with three's GLTFLoader
// (+ MeshoptDecoder, the app's backdrop path incl. the Float32 dequantize step) from fixed cameras at dpr 1 and 2 in real
// Chrome (GPU, Chrome lease), and compares every named node's world bounding box and the viewer's hide set.
//   node tools/blobs/compare-campus.mjs <original.glb> <candidate.glb> <outDir> [port 5930]
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { findPlaywright } from '../god-skill/lib/look.mjs';
import { chromeLease } from '../god-skill/lib/chrome-lease.mjs';
const [orig, cand, outArg, portArg] = process.argv.slice(2);
const out = resolve(outArg); mkdirSync(out, { recursive: true }); const port = Number(portArg || 5930);
const THREE_DIR = resolve(dirname(createRequire(new URL('../../apps/server/package.json', import.meta.url)).resolve('three')), '..'); // the workspace's three
const PAGE = `<!doctype html><html><head><style>html,body{margin:0;background:#cfc6b8}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three'; import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'; import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
const NAMES=/^(position|normal|uv\\d?)$/;
function dequantize(root){let c=0;const done=new Set();root.traverse(o=>{const g=o.geometry;if(!g||done.has(g))return;done.add(g);for(const [n,a] of Object.entries(g.attributes)){if(!NAMES.test(n)||a.array instanceof Float32Array)continue;const out=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let k=0;k<a.itemSize;k++)out[i*a.itemSize+k]=a.getComponent(i,k);g.setAttribute(n,new THREE.BufferAttribute(out,a.itemSize));c++;}});return c;}
const hide={kind:['context_person','context_group','reference'],assembly:['people','reference-ground'],layer:['Aerial reference']};
window.run=async(url)=>{
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(devicePixelRatio);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;document.body.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xcfc6b8);scene.add(new THREE.HemisphereLight(0xffffff,0x8a7a66,1.6));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(120,200,80);scene.add(sun);
  const t0=performance.now();const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);const loadMs=performance.now()-t0;
  const root=gltf.scene;const converted=dequantize(root);let hidden=0;root.traverse(o=>{const d=o.userData;if(hide.kind.includes(d.kind)||hide.assembly.includes(d.assembly_id)||hide.layer.includes(d.layer)){o.visible=false;hidden++;}});
  scene.add(root);root.updateMatrixWorld(true);
  const boxes={};root.traverse(o=>{if(o.isMesh){const b=new THREE.Box3().setFromObject(o);boxes[o.name+'#'+o.id%1]=[...b.min.toArray(),...b.max.toArray()].map(v=>+v.toFixed(4));}});
  let tris=0,f32=0,other=0;root.traverse(o=>{if(o.isMesh){const g=o.geometry;tris+=(g.index?g.index.count:g.attributes.position.count)/3;for(const a of Object.values(g.attributes))(a.array instanceof Float32Array?f32++:other++);}});
  const all=new THREE.Box3().setFromObject(root);const c=all.getCenter(new THREE.Vector3());
  const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,0.1,5000);
  window.view=(i)=>{const views=[[c.x+260,180,c.z+260,c.x,0,c.z],[c.x+70,40,c.z+90,c.x,2,c.z],[c.x-30,4,c.z+40,c.x,3,c.z]];const v=views[i];camera.position.set(v[0],v[1],v[2]);camera.lookAt(v[3],v[4],v[5]);renderer.render(scene,camera);};
  return {loadMs,converted,hidden,tris,f32,other,boxes,center:c.toArray(),size:all.getSize(new THREE.Vector3()).toArray()};
};
</script></body></html>`;
const files = { '/orig.glb': resolve(orig), '/cand.glb': resolve(cand) };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    const f = files[p] || (p.startsWith('/three/') && !p.includes('..') ? THREE_DIR + p.slice(6) : null);
    if (!f || !statSync(f).isFile()) throw 0;
    res.writeHead(200, { 'content-type': extname(f) === '.js' ? 'text/javascript' : 'application/octet-stream' }); res.end(readFileSync(f));
  } catch { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1');
const { chromium } = findPlaywright(); const release = await chromeLease('blobs-compare'); const report = {};
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (const dpr of [1, 2]) for (const which of ['orig', 'cand']) {
    const page = await browser.newPage({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
    page.on('pageerror', (e) => console.error(which, String(e)));
    await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.run);
    const r = await page.evaluate((u) => window.run(u), `/${which}.glb`);
    for (const i of [0, 1, 2]) { await page.evaluate((i) => window.view(i), i); await page.screenshot({ path: `${out}/view${i}-dpr${dpr}-${which}.png` }); }
    if (dpr === 1) report[which] = r; await page.close();
  }
  await browser.close();
} finally { release(); server.close(); }
const a = report.orig.boxes, b = report.cand.boxes; let missing = 0, maxDev = 0, worst = '';
for (const [k, v] of Object.entries(a)) { const w = b[k]; if (!w) { missing++; continue; } const d = Math.max(...v.map((x, i) => Math.abs(x - w[i]))); if (d > maxDev) { maxDev = d; worst = k; } }
const summary = { orig: { ...report.orig, boxes: Object.keys(a).length }, cand: { ...report.cand, boxes: Object.keys(b).length }, missing, maxBoxDeviationM: maxDev, worst };
writeFileSync(`${out}/compare.json`, JSON.stringify(summary, null, 1)); console.log(JSON.stringify(summary));
