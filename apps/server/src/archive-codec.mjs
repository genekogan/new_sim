// Encoding/decoding take archives stays off the 20 Hz world loop.
import {parentPort,workerData} from 'node:worker_threads';
import {gzipSync,gunzipSync} from 'node:zlib';
if(workerData.mode==='pack') {
 const chunks=workerData.rows.map(r=>({fromTick:r.from_tick,toTick:r.to_tick,take:JSON.parse(gunzipSync(r.body).toString())}));
 const bytes=gzipSync(JSON.stringify({format:'sim-takes/1',worldId:workerData.worldId,chunks}),{level:6});
 parentPort.postMessage(bytes);
} else {
 const body=JSON.parse(gunzipSync(workerData.body,{maxOutputLength:64*1024*1024}).toString());
 if(body.format!=='sim-takes/1'||!Array.isArray(body.chunks)||body.chunks.length>1000)throw Error('Invalid take archive');
 parentPort.postMessage(body);
}
