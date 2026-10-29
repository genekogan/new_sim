import {defineConfig} from '../../apps/web/node_modules/vite/dist/node/index.js';
import {readFileSync} from 'node:fs';
const root=new URL('../..',import.meta.url).pathname;
export default defineConfig({root,publicDir:root+'/mars/viewer/public',server:{host:'127.0.0.1',port:7851,strictPort:true},plugins:[{name:'native-light-snapshots',configureServer(s){s.middlewares.use('/day1-proof/',(req,res)=>{if(!['lights-on.json','lights-off.json'].includes(req.url?.slice(1))) {res.statusCode=404;res.end();return;}res.setHeader('Content-Type','application/json');res.end(readFileSync(process.env.SOUL_ACTIONS_OUT+req.url));});}}]});
