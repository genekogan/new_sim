import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {openEdgeServerV1} from './edge-server.mjs';
test('explicit source pin and canonical declaration reject before data/writer/listener setup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'eden-boundary-pin-')),dataDir=join(dir,'never-created-data'),file=join(dir,'declaration.json'),input=fileURLToPath(new URL('../../',import.meta.url));
 try{await writeFile(file,'{}');const cfg={input,dataDir,worldId:'synthetic-boundary-pin',port:4959,build:'local-boundary-pin',authoredBoundariesFile:file};
  await assert.rejects(openEdgeServerV1(cfg),/explicit source file and exact SHA256/);await assert.rejects(access(dataDir));
  await assert.rejects(openEdgeServerV1({...cfg,authoredBoundariesSHA256:'0'.repeat(64)}),/source file differs/);await assert.rejects(access(dataDir));
  await assert.rejects(openEdgeServerV1({...cfg,authoredBoundariesSHA256:createHash('sha256').update('{}').digest('hex')}));await assert.rejects(access(dataDir));
 }finally{await rm(dir,{recursive:true,force:true});}
});
