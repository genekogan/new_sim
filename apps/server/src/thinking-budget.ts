/** Operator configuration only; a client request cannot authorize a higher ceiling. */
export function worldThinkingBudgetV1(env:NodeJS.ProcessEnv){
 const raw=env.WORLD_THINKING_CEILING_USD_PER_DAY??'1';if(raw!=='1'&&raw!=='3')throw Error('thinking-budget.invalid-ceiling');const ceiling=Number(raw) as 1|3;
 let authorizedWorldId:string|undefined;
 if(ceiling===3){authorizedWorldId=env.EDEN_THINKING_AUTHORIZED_WORLD_ID;if(env.WORLD_KEY!=='eden'||env.ENGINE!=='mars'||env.ENABLE_EDEN_CORE!=='1'||env.ENABLE_EDEN_LIFE!=='1'||!env.WORLD_ID||authorizedWorldId!==env.WORLD_ID)throw Error('thinking-budget.explicit-Eden-world-authorization-required');}
 const requested=Number(env.BRAIN_BUDGET_USD_PER_DAY??.5),target=Number.isFinite(requested)?Math.max(0,Math.min(ceiling,requested)):0;
 return {ceiling,target,authorizedWorldId};
}
