// Keep the Soul relay instructions discoverable without replacing the owner's project instructions.
export const SOUL_GUIDE_START='<!-- eden-soul-guide:start -->';
export const SOUL_GUIDE_END='<!-- eden-soul-guide:end -->';
export function mergeSoulGuide(existing,text){
 const block=SOUL_GUIDE_START+'\n'+text.trimEnd()+'\n'+SOUL_GUIDE_END;
 const start=existing.lastIndexOf(SOUL_GUIDE_START),end=start<0?-1:existing.indexOf(SOUL_GUIDE_END,start+SOUL_GUIDE_START.length);
 // Only a complete managed block is replaceable. Unmarked or incomplete text is preserved verbatim.
 if(start>=0&&end>=0)return existing.slice(0,start)+block+existing.slice(end+SOUL_GUIDE_END.length);
 return existing+(existing?(existing.endsWith('\n')?'\n':'\n\n'):'')+block+'\n';
}
