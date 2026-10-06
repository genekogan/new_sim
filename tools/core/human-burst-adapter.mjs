import {Governor} from './pinned-human-burst-governor-46c1a0a6.ts';
/** Exact current-local Governor methods on the existing instance. Keep levels,
 * learned estimates, denied counters and DB-backed rolling cap/holds intact. */
export function enableCurrentHumanBurstV1(brain,amount=1){
 if(amount!==1||!brain?.gov||typeof brain.gov.capacity!=='function'||typeof brain.gov.view!=='function'||typeof brain.gov.charge!=='function')throw Error('explicit existing local Governor required');
 const gov=brain.gov;if(!Object.hasOwn(gov,'level')||!Object.hasOwn(gov,'est'))throw Error('selected Governor structure differs');
 if(typeof gov.enableHumanDirectionBurstUsdV1!=='function'){gov.capacity=Governor.prototype.capacity;gov.enableHumanDirectionBurstUsdV1=Governor.prototype.enableHumanDirectionBurstUsdV1;}
 gov.enableHumanDirectionBurstUsdV1(amount);if(gov.view().find(b=>b.tier==='user')?.capacity!==1)throw Error('human burst enforcement unavailable');return gov;
}
