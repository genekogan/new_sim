import type { VisibleViewport } from './WorldViewport.ts';

export type LabelBox = { id: string; x: number; y: number; width: number; height: number; selected: boolean; previous?: LabelOffset };
export type LabelOffset = { dx: number; dy: number };
type Rect = { x: number; y: number; width: number; height: number };
const gap = 6;
const intersects = (a: Rect, b: Rect) => a.x < b.x+b.width+gap && a.x+a.width+gap > b.x && a.y < b.y+b.height+gap && a.y+a.height+gap > b.y;

/** Pack projected nameplates only. Selected first, stable IDs thereafter. Keep
 * an existing valid placement to avoid changing lanes on every moving frame.
 * Offscreen anchors and overflow stay hidden; no actor/camera/recording changes. */
export function placeWorldLabels(boxes: readonly LabelBox[], area: VisibleViewport | null): Map<string, LabelOffset> {
  const result = new Map<string, LabelOffset>(), placed: Rect[] = [];
  if (!area) return result;
  const right=area.left+area.width, bottom=area.top+area.height;
  for (const b of [...boxes].sort((a,b)=>Number(b.selected)-Number(a.selected) || (a.id<b.id?-1:a.id>b.id?1:0))) {
    if (![b.x,b.y,b.width,b.height].every(Number.isFinite) || b.width<=0 || b.height<=0 || b.width>area.width || b.height>area.height) continue;
    // A label's bottom centre is the projected head. Do not pull an offscreen
    // resident into view simply because its nameplate extends over the edge.
    const anchorX=b.x+b.width/2, anchorY=b.y+b.height;
    if (anchorX<area.left || anchorX>right || anchorY<area.top || anchorY>bottom) continue;
    const dx=Math.max(area.left,Math.min(right-b.width,b.x))-b.x;
    const candidates: LabelOffset[] = [];
    if(b.previous) candidates.push(b.previous);
    candidates.push({dx,dy:0});
    for(const p of placed) candidates.push({dx,dy:p.y-gap-b.height-b.y},{dx,dy:p.y+p.height+gap-b.y});
    candidates.push({dx,dy:area.top-b.y},{dx,dy:bottom-b.height-b.y});
    const tail=candidates.splice(b.previous?1:0).sort((a,b)=>Math.abs(a.dy)-Math.abs(b.dy) || a.dy-b.dy);
    candidates.push(...tail);
    for(const c of candidates) {
      const rect={x:b.x+c.dx,y:b.y+c.dy,width:b.width,height:b.height};
      if(!Number.isFinite(c.dx)||!Number.isFinite(c.dy)||Math.hypot(c.dx,c.dy)>180 || rect.x<area.left || rect.y<area.top || rect.x+rect.width>right || rect.y+rect.height>bottom || placed.some(p=>intersects(rect,p))) continue;
      result.set(b.id,c); placed.push(rect); break;
    }
  }
  return result;
}
