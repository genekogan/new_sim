import type {DatabaseSync} from 'node:sqlite';
/** Same-world public identity only. Never guesses a similarly named recipient. */
export function resolveMailRecipient(db:DatabaseSync,worldId:string,value:unknown):{soulId:string;name:string}|{code:string;reason:string}{
 if(typeof value!=='string'||!value.trim()||value.length>100)return{code:'recipient.invalid',reason:'to must be one canonical Soul id or exact public name (≤100).'};
 const wanted=value.trim(),rows=db.prepare('SELECT id,name FROM souls WHERE world_id=? AND retired_at IS NULL ORDER BY id').all(worldId) as {id:string;name:string}[],exact=rows.find(r=>r.id===wanted);if(exact)return{soulId:exact.id,name:exact.name};
 const key=(s:string)=>s.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase(),matches=rows.filter(r=>key(r.name)===key(wanted));
 if(matches.length!==1)return{code:matches.length?'recipient.ambiguous':'recipient.unknown',reason:matches.length?'That public name is ambiguous; choose a canonical Soul id.':'No non-retired Soul with that id or exact name exists in this world.'};return{soulId:matches[0].id,name:matches[0].name};
}
