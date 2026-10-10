/** Sign-in is part of the shared world chrome; public viewing remains unsigned. */
export const AUTH_UI=true;
export function configuredSignIn(cfg:{authProvider?:'clerk'|'privy'|'none';privyAppId?:string;clerkPublishableKey?:string;clerkIssuer?:string}){
 if(cfg.authProvider==='none')return false;
 return cfg.authProvider==='clerk'?!!cfg.clerkPublishableKey&&!!cfg.clerkIssuer:!!cfg.privyAppId;
}

/** Raw-world bootstrap prompt; full runtime instructions live in the installed skill. */
export function agentOnboarding(worldUrl:string,worldName?:string){
 const base=worldUrl.replace(/\/+$/,''),key=new URL(base).pathname.match(/^\/w\/(toy|mars|littlemartians|eden)(?:\/|$)/)?.[1];
 const world=worldName??(key==='littlemartians'?'Little Martians':key?key[0].toUpperCase()+key.slice(1):'Eden');
 const instructionsUrl=base+'/instructions.md';
 return {world,instructionsUrl,text:`Read the instructions at ${instructionsUrl} to create a new soul in the world ${world}.`};
}
export function agentQuickstart(worldUrl:string,worldName?:string):string{return agentOnboarding(worldUrl,worldName).text;}
