/** Agent-local account approval. Human provider tokens never enter this module. */
export function delegatedOwnerPath(path,soulId){
 if(path==='/v1/me')return '/v1/agent/account-me';
 const root='/v1/souls/'+encodeURIComponent(soulId);
 if(path===root)return '/v1/agent/soul';
 if(path===root+'/profile')return '/v1/agent/profile';
 if(path===root+'/photo')return '/v1/agent/photo';
 if(path===root+'/intent-v2'||path.startsWith(root+'/intent-v2/'))return '/v1/agent/intent-v2'+path.slice((root+'/intent-v2').length);
 throw Error('This owner operation requires browser account approval; no human credential is stored by this agent.');
}
export function approvalPublic(data,world){
 const a=data?.approval??data;if(!a||!/^ap_[a-f0-9]{32}$/.test(a.id??'')||!['pending','creating','ready','refused','cancelled','expired'].includes(a.status))throw Error('Canonical account approval response unavailable.');
 const approvalURL=world+'/#approve/'+a.id;
 return {approvalId:a.id,status:a.status,name:a.name,soulId:a.soulId??null,approvalURL,...(a.status==='pending'?{next:'Ask your human to open the approval link, sign in, and approve the intended world, Soul and agent. Then run: approval wait.'}:a.status==='creating'?{next:'Creation is accepted but its body is not ready. Run: approval wait.'}:{})};
}
export function acceptDelegation(data,pending,world){
 if(data?.status!=='ready')return null;
 if(data.id!==pending.approvalId||data.worldId!==pending.worldId||!/^s_[A-Za-z0-9_-]+$/.test(data.soulId??'')||typeof data.token!=='string'||!data.token.startsWith('sim_'+data.soulId+'_'))throw Error('Account approval scope differs; no credential was selected.');
 return {world,soul:data.soulId,token:data.token};
}
