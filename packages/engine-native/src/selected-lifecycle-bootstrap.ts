import type {WorldHost} from '../../../apps/server/src/world.ts';
import type {Souls} from '../../../apps/server/src/souls.ts';
/** Internal operator/bootstrap seam only; not an HTTP route or body command. */
export async function installSelectedNativeLifecycleV1(host:WorldHost,souls:Souls,drive:<T>(pending:Promise<T>)=>Promise<T>,author='operator:selected-native-lifecycle'){
 if(!author.startsWith('operator:'))throw Error('selected-lifecycle.operator-required');
 let fact=host.db.rulesEvents(host.worldId).find(e=>e.payload?.crewRemovalTransition?.contract==='crew-removal-transition/1'&&e.payload.crewRemovalTransition.toRulesVersion===host.engine.rulesVersion);
 const alreadyAccepted=!!fact;
 if(!fact){const preview=host.engine.previewCrewRemovalTransitionV1?.();if(!preview?.ok)throw Error(preview?preview.diagnostic.code:'selected-lifecycle.reader-required');fact=await drive(host.adoptCrewRemovalPolicyV1(author));}
 if(fact.payload.crewRemovalTransition.toRulesVersion!==host.engine.rulesVersion||!host.engine.rulesVersion.includes('+crew-removal/1'))throw Error('selected-lifecycle.accepted-policy-required');
 if(!souls.lifecycle)souls.enableLifecycle();
 return{contract:'selected-native-lifecycle/1',worldId:host.worldId,seq:fact.seq,tick:fact.tick,alreadyAccepted,lifecycleReady:!!souls.lifecycle};
}
