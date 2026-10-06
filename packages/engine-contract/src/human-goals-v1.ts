import {z} from 'zod';
const ref=z.string().min(1).max(100),text=z.string().min(1).max(500),digest=z.string().regex(/^[a-f0-9]{64}$/);
/** Closed player goal vocabulary. Parameter values must belong to the current actor-scoped registry. */
export const humanGoalV1Schema=z.discriminatedUnion('goal',[
 z.strictObject({goal:z.literal('walk'),bindingId:ref}),
 z.strictObject({goal:z.literal('sit'),bindingId:ref,seconds:z.number().int().min(1).max(600)}),
 z.strictObject({goal:z.literal('rest'),seconds:z.number().int().min(1).max(600)}),
 z.strictObject({goal:z.literal('eat'),bindingId:ref}),
 z.strictObject({goal:z.literal('hang_out'),bindingId:ref,seconds:z.number().int().min(1).max(600)}),
]);
export type HumanGoalV1=z.infer<typeof humanGoalV1Schema>;
export const humanCompilerOutputV1Schema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('plan'),registryHash:digest,goals:z.array(humanGoalV1Schema).min(1).max(4),explanation:text,adaptation:z.strictObject({originalGoal:z.literal('hang_out'),substituteBindingId:ref,explanation:text}).optional()}),
 z.strictObject({kind:z.literal('no_action'),reason:z.enum(['nonsense','needs_clarification','unsupported_here']),explanation:text,question:text.optional()}),
]).superRefine((v,ctx)=>{if(v.kind==='plan'&&v.adaptation&&(v.goals.length!==1||v.goals[0].goal!=='hang_out'||v.goals[0].bindingId!==v.adaptation.substituteBindingId))ctx.addIssue({code:'custom',message:'adaptation must retain one hang-out goal and its registered substitute binding'});});
export type HumanCompilerOutputV1=z.infer<typeof humanCompilerOutputV1Schema>;
export const humanSteeringOutcomeV1Schema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('planned'),registryHash:digest,goals:z.array(humanGoalV1Schema).min(1).max(4),explanation:text}),
 z.strictObject({kind:z.literal('no_action'),reason:z.enum(['nonsense','needs_clarification','unsupported_here']),explanation:text,question:text.optional()}),
 z.strictObject({kind:z.literal('state_blocked'),goal:humanGoalV1Schema,code:ref,explanation:text}),
 z.strictObject({kind:z.literal('system_unavailable'),code:z.enum(['budget','provider','key','closed']),explanation:text}),
 z.strictObject({kind:z.literal('compilation_failure'),code:z.enum(['schema','unknown_goal','unknown_binding','invalid_plan','postcondition']),explanation:text}),
]);
export type HumanSteeringOutcomeV1=z.infer<typeof humanSteeringOutcomeV1Schema>;
/** Supported goals remain visible when admission is temporarily blocked. No renderer-only affordances. */
export const HUMAN_GOAL_POSTCONDITIONS_V1={walk:'native_navigation_arrival',sit:'native_seated',rest:'native_rest_interval',eat:'native_food_consumed',hang_out:'native_arrival_and_presence'} as const;
export const humanCapabilityRegistryV1Schema=z.strictObject({contract:z.literal('human-capabilities/1'),worldId:ref,soulId:ref,entityId:ref,tick:z.number().int().nonnegative(),registryHash:digest,
 goals:z.array(z.strictObject({id:z.enum(['walk','sit','rest','eat','hang_out']),description:text,postcondition:z.enum(['native_navigation_arrival','native_seated','native_rest_interval','native_food_consumed','native_arrival_and_presence']),bindings:z.array(z.strictObject({id:ref,targetId:ref.optional(),label:ref,available:z.boolean(),blockedCode:ref.optional()}).superRefine((v,ctx)=>{if(v.available&&v.blockedCode!==undefined||!v.available&&v.blockedCode===undefined)ctx.addIssue({code:'custom',message:'unavailable binding must explain its current obstacle'});})).max(512)})).max(5),
}).superRefine((v,ctx)=>{if(new Set(v.goals.map(g=>g.id)).size!==v.goals.length)ctx.addIssue({code:'custom',message:'goal IDs must be unique'});for(const goal of v.goals){if(goal.postcondition!==HUMAN_GOAL_POSTCONDITIONS_V1[goal.id])ctx.addIssue({code:'custom',message:'goal requires its native semantic postcondition'});if(new Set(goal.bindings.map(b=>b.id)).size!==goal.bindings.length)ctx.addIssue({code:'custom',message:'binding IDs must be unique within a goal'});}});
export type HumanCapabilityRegistryV1=z.infer<typeof humanCapabilityRegistryV1Schema>;
