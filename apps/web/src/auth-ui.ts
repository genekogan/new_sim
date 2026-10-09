/** Edge onboarding: Souls are run by their owners' agents, so human sign-in (dev/Privy) is hidden by default.
 * The code stays; add `?auth=1` to the URL (or localStorage `sim.authUi`='1') to show it again. */
export const AUTH_UI:boolean=(()=>{
 try{return typeof location!=='undefined'&&(new URLSearchParams(location.search).get('auth')==='1'||localStorage.getItem('sim.authUi')==='1');}
 catch{return false;}
})();

/** Raw-world bootstrap prompt; full runtime instructions live in the installed skill. */
export function agentOnboarding(worldUrl:string,worldName?:string){
 const base=worldUrl.replace(/\/+$/,''),key=new URL(base).pathname.match(/^\/w\/(toy|mars|littlemartians|eden)(?:\/|$)/)?.[1];
 const world=worldName??(key==='littlemartians'?'Little Martians':key?key[0].toUpperCase()+key.slice(1):'Eden');
 const instructionsUrl=base+'/instructions.md';
 return {world,instructionsUrl,text:`Read the instructions at ${instructionsUrl} to create a new soul in the world ${world}.`};
}
export function agentQuickstart(worldUrl:string,worldName?:string):string{return agentOnboarding(worldUrl,worldName).text;}
