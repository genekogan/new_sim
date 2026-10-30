import {contactStateKey,type WorldModel,type Entity} from '@sim/world-compiler';

/** Native interactions use the same depicted tick as the Soul performing them.
 * The ordered diff stream waits here; it must not show a lamp's result ahead of
 * the viewer's buffered approach/reach. Owner edits and legacy messages stay immediate. */
export function lightDiffAhead(model:WorldModel, message:unknown, depictedTick:number):boolean {
  const d=message as {by?:string;tick?:number;diff?:{upserts?:Entity[]}};
  if(d.by!=='engine'||typeof d.tick!=='number'||!Number.isFinite(d.tick)||d.tick<=depictedTick)return false;
  return !!d.diff?.upserts?.some(e=>{
    const before=model.entities.get(e.id),def=model.resolvedDef(e.def);
    const key=def&&contactStateKey(def);
    return before&&key&&before.state?.[key]!==e.state?.[key];
  });
}
