import type {WorldHost} from './world.ts';
/** Explicit operational mode, never a fallback selected from interpretation failure. */
export function edenSteeringModeV1(edenLife:boolean,env:NodeJS.ProcessEnv){
 const closedGoalsV1=env.ENABLE_CLOSED_HUMAN_GOALS==='1',registeredActivitiesV1=env.ENABLE_REGISTERED_HUMAN_ACTIVITIES==='1';
 if((closedGoalsV1||registeredActivitiesV1)&&!edenLife)throw Error('eden-steering.opted-in-life-required');
 if(closedGoalsV1!==registeredActivitiesV1)throw Error('eden-steering.complete-registered-coverage-required');
 return {closedGoalsV1,registeredActivitiesV1};
}

/** A reader-only restart can keep a policy, but cannot prospectively install one. */
export async function installEdenSteeringModeV1(host:WorldHost,mode:{closedGoalsV1:boolean;registeredActivitiesV1:boolean},retainReader=false){
 if(!mode.closedGoalsV1)return;
 if(retainReader){if(host.extra.intentExecutionRetentionV1!==true||host.extra.intentNativeSequenceCompletionV1!==true||host.extra.intentHumanSleepTransitionV1!==true||host.extra.intentPurposeEvidenceV1!==true||host.extra.intentPurposeRecallV1!==true||host.extra.intentRetainedChoiceV1!==true)throw Error('eden-steering.retained-execution-policy-required');return;}
 const policy=host.enableIntentExecutionRetentionV1();host.drainInputs();await policy;
 const completion=host.enableIntentNativeSequenceCompletionV1();host.drainInputs();await completion;
 const sleep=host.enableIntentHumanSleepTransitionV1();host.drainInputs();await sleep;
 const evidence=host.enableIntentPurposeEvidenceV1();host.drainInputs();await evidence;
 const recall=host.enableIntentPurposeRecallV1();host.drainInputs();await recall;
 const retained=host.enableIntentRetainedChoiceV1();host.drainInputs();await retained;
}
