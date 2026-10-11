// three.js for the humanoid tools, resolved through apps/web (tools/ has no node_modules of its own).
// The module build is imported by absolute path so addons (which import bare 'three') share one instance.
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const root=dirname(dirname(require.resolve('three')));
const url=p=>pathToFileURL(root+'/'+p).href;
export const THREE=await import(url('build/three.module.js'));
export const {GLTFLoader}=await import(url('examples/jsm/loaders/GLTFLoader.js'));
export const SkeletonUtils=await import(url('examples/jsm/utils/SkeletonUtils.js'));
export const BufferGeometryUtils=await import(url('examples/jsm/utils/BufferGeometryUtils.js'));
export const ENV_DIR=new URL('../../mars/viewer/public/modular/environment/',import.meta.url).pathname;
export async function parseGlb(bytes){return new Promise((ok,no)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',ok,no));}
