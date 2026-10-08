// Current-G refusal statuses. An unexpected success/transport response cannot
// establish whether a pairing, approval or revocation write was accepted.
export const isConnectionRefusal=(status:number)=>[400,401,403,404,409,410,422,429].includes(status);

export type AgentConnectionProjection={attached:boolean;label:string|null;since:number|null;last_used:number|null};
/** Missing/malformed data cannot establish a disconnected or connected state. */
export function agentConnectionProjection(input:unknown):AgentConnectionProjection|null{
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const value=input as Record<string,unknown>;
  if(typeof value.attached!=='boolean'||!(value.label===null||typeof value.label==='string'))return null;
  for(const key of ['since','last_used'])if(!(value[key]===null||(typeof value[key]==='number'&&Number.isSafeInteger(value[key])&&value[key]>=0)))return null;
  return {attached:value.attached,label:value.label,since:value.since as number|null,last_used:value.last_used as number|null};
}
