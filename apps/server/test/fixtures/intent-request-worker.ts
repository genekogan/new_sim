// Only invoked by the ledger concurrency fixture, no server or model client.
import { parentPort, workerData } from 'node:worker_threads';
import { Db } from '../../src/db.ts';
import { IntentRequests } from '../../src/intent-requests.ts';
const db = new Db(workerData.path);
parentPort!.once('message', () => {
  let message;
  try {
    const result = new IntentRequests(db).reserve({ ...workerData.scope, currentAuthority: row => row.owner === 'owner' }, workerData.request);
    message = { kind: 'result', created: result.created };
  } catch (error) { message = { kind: 'result', error: (error as Error).constructor.name }; }
  finally { db.close(); }
  parentPort!.postMessage(message); parentPort!.close();
});
parentPort!.postMessage({ kind: 'ready' });
