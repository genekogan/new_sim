/** The title a visitor sees for a world. The server's own name (bootstrap /v1/config `worldName`, the launcher's
 * WORLD_NAME) wins; without one, the slug's words, spaced and capitalised ("eden-2026" -> "Eden 2026"), never the raw slug. */
export function worldTitle(served:unknown,key:string|undefined):string{
 if(typeof served==='string'&&served.trim())return served.trim();
 if(!key)return 'Eden';
 if(key==='littlemartians')return 'Little Martians';
 return key.split('-').filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
}
