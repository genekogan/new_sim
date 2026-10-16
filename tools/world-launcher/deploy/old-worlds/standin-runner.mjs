// Rehearsal-only stand-in for the live convergence runner (convergence-world-run.mjs): holds the world's lock, listens, and on
// SIGTERM closes its listener, releases the lock, writes <receipts>/<world>/CLOSURE.json {closedPID, normalClosed:true} and then
// NEVER exits (like the real runner, which never calls process.exit). Used by rollback-rehearsal.sh S12 on eden2 only.
//   node standin-runner.mjs run-world.mjs <scratch descriptor> <port> <dataDir> <receiptDir> <world>
import {createServer} from 'node:net';
import {writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
const [,,,desc,port,dataDir,receiptDir,world]=process.argv;
writeFileSync(`${dataDir}/edge-server.lock`,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),desc}));
const server=createServer().listen(Number(port),'127.0.0.1');
process.on('SIGTERM',()=>{server.close();try{unlinkSync(`${dataDir}/edge-server.lock`);}catch{}
  mkdirSync(`${receiptDir}/${world}`,{recursive:true});
  writeFileSync(`${receiptDir}/${world}/CLOSURE.json`,JSON.stringify({closedPID:process.pid,world,normalClosed:true,atUTC:new Date().toISOString()}),{flag:'wx'});});
setInterval(()=>{},1000);
