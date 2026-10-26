import type { VisibleViewport } from './WorldViewport.ts';

export type LabelBox = { id: string; x: number; y: number; width: number; height: number; selected: boolean; previous?: LabelOffset };
export type LabelOffset = { dx: number; dy: number };
type Rect = { x: number; y: number; width: number; height: number };
const gap = 6;
const intersects = (a: Rect, b: Rect) => a.x < b.x+b.width+gap && a.x+a.width+gap > b.x && a.y < b.y+b.height+gap && a.y+a.height+gap > b.y;

/** Name plates hang under the body (C2, Gene 2026-10-26): a plate's top centre is the body's ground point moved toward
 * the viewer by the drawn selection ring's outer radius, so the plate sits just outside the ring's near edge whether or
 * not the ring is shown. `toward` is the ground-plane direction to the viewer; when the eye is straight above, `down`
 * (the camera's screen-down on the ground) stands in. Lying (asleep) bodies keep the same ground point. */
export function plateAnchor(ground: readonly [number,number,number], eye: {x:number;z:number}, down: {x:number;z:number}, radius: number): [number,number,number] {
  let x=eye.x-ground[0], z=eye.z-ground[2], n=Math.hypot(x,z);
  if (n<1e-3) { x=down.x; z=down.z; n=Math.hypot(x,z); }
  if (!(n>1e-6) || !(radius>0)) return [ground[0],ground[1],ground[2]];
  return [ground[0]+x/n*radius, ground[1], ground[2]+z/n*radius];
}

/** One Soul's name plate: name, doing line, card line, channel chip. No leader line (C2): the plate sits under its body. */
export function nameTag(doc: Pick<Document,'createElement'>) {
  const el = doc.createElement('div'); el.className = 'world-name-tag';
  el.style.cssText = 'font:11px/1.25 system-ui,sans-serif;color:#fff;background:rgba(18,20,18,.66);padding:2px 7px 3px;margin-top:2px;border-radius:5px;text-align:center;white-space:nowrap;pointer-events:auto;cursor:pointer;max-width:260px';
  const name = doc.createElement('b'), line = doc.createElement('div'), card = doc.createElement('div'), chan = doc.createElement('div');
  line.style.cssText = 'opacity:.85'; card.style.cssText = 'opacity:.7;font-style:italic'; chan.style.cssText = 'display:none;font-size:10px;margin-top:1px;white-space:normal;max-width:240px'; chan.dataset.channelChip = '';
  el.append(name, line, card, chan);
  return {el, name, line, card, chan};
}

/** Pack projected nameplates only. Selected first, stable IDs thereafter. Keep
 * an existing valid placement to avoid changing lanes on every moving frame.
 * A plate only ever moves sideways or further down from its anchor (never up over
 * its body), at most 180 px. Offscreen anchors and overflow stay hidden; no
 * actor/camera/recording changes. */
export function placeWorldLabels(boxes: readonly LabelBox[], area: VisibleViewport | null): Map<string, LabelOffset> {
  const result = new Map<string, LabelOffset>(), placed: Rect[] = [];
  if (!area) return result;
  const right=area.left+area.width, bottom=area.top+area.height;
  for (const b of [...boxes].sort((a,b)=>Number(b.selected)-Number(a.selected) || (a.id<b.id?-1:a.id>b.id?1:0))) {
    if (![b.x,b.y,b.width,b.height].every(Number.isFinite) || b.width<=0 || b.height<=0 || b.width>area.width || b.height>area.height) continue;
    // A label's top centre is its anchor under the body. Do not pull an offscreen
    // resident into view simply because its nameplate extends over the edge.
    const anchorX=b.x+b.width/2, anchorY=b.y;
    if (anchorX<area.left || anchorX>right || anchorY<area.top || anchorY>bottom) continue;
    const dx=Math.max(area.left,Math.min(right-b.width,b.x))-b.x;
    const tail: LabelOffset[] = [{dx,dy:0}];
    for(const p of placed) tail.push({dx,dy:p.y+p.height+gap-b.y},{dx:p.x-gap-b.width-b.x,dy:0},{dx:p.x+p.width+gap-b.x,dy:0});
    tail.sort((a,b)=>Math.hypot(a.dx,a.dy)-Math.hypot(b.dx,b.dy) || a.dy-b.dy || a.dx-b.dx);
    const candidates=(b.previous?[b.previous,...tail]:tail).filter(c=>c.dy>=0);
    for(const c of candidates) {
      const rect={x:b.x+c.dx,y:b.y+c.dy,width:b.width,height:b.height};
      if(!Number.isFinite(c.dx)||!Number.isFinite(c.dy)||Math.hypot(c.dx,c.dy)>180 || rect.x<area.left || rect.y<area.top || rect.x+rect.width>right || rect.y+rect.height>bottom || placed.some(p=>intersects(rect,p))) continue;
      result.set(b.id,c); placed.push(rect); break;
    }
  }
  return result;
}
