/** Explicit runtime exposure; the legacy local fixture remains the default.
 * Public preview preserves the existing generated-agent owner flow, while
 * configured mode retains the existing configured account verifier. */
export function worldAuthMode(mode='local-dev',{edgePublic,devAuth,seedCast,nativeCast}={}){
 if(!['local-dev','public-preview','configured'].includes(mode))throw Error('world-auth.unknown-mode');
 if(mode!=='local-dev'&&(seedCast!==false||nativeCast!==false))throw Error('world-auth.public-no-native-cast-required');
 if(mode==='public-preview'&&edgePublic!=='1')throw Error('world-auth.public-owner-restriction-required');
 if(mode==='configured'&&devAuth==='1')throw Error('world-auth.configured-no-dev-auth-required');
 return{mode,local:mode==='local-dev',preview:mode==='public-preview',configured:mode==='configured',devAuth:mode!=='configured'};
}
export function validateWorldOrigin(origin,mode){
 const url=new URL(origin),loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('world-auth.origin-required');
 if(mode==='local-dev'?url.protocol!=='http:'||!loopback:!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!loopback)throw Error('world-auth.origin-required');
 return url.origin;
}
