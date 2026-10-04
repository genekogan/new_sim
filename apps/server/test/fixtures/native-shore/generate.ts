// Offline source-bound take generation. No server, database, model or renderer.
import { writeFileSync } from 'node:fs';
import { nativeShoreTake } from '../../../../../packages/engine-mars/src/shore-fixture.ts';
const result=await nativeShoreTake();
writeFileSync(new URL('./journey.v1.json',import.meta.url),JSON.stringify(result)+'\n');
console.log(JSON.stringify({ticks:result.take.ticks,trace:result.trace,finalStateHash:result.finalStateHash}));
