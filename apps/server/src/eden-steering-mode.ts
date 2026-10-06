/** Explicit operational mode, never a fallback selected from interpretation failure. */
export function edenSteeringModeV1(edenLife:boolean,env:NodeJS.ProcessEnv){
 const closedGoalsV1=env.ENABLE_CLOSED_HUMAN_GOALS==='1',registeredActivitiesV1=env.ENABLE_REGISTERED_HUMAN_ACTIVITIES==='1';
 if((closedGoalsV1||registeredActivitiesV1)&&!edenLife)throw Error('eden-steering.opted-in-life-required');
 if(closedGoalsV1!==registeredActivitiesV1)throw Error('eden-steering.complete-registered-coverage-required');
 return {closedGoalsV1,registeredActivitiesV1};
}
