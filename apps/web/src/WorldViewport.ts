import type { PerspectiveCamera } from 'three';

/** CSS pixels inside world-viewport, measured by App for edge-attached overlays. */
export type ViewportInsets = { top?: number; right?: number; bottom?: number; left?: number };
export type VisibleViewport = { left: number; top: number; width: number; height: number; aspect: number };
const size = (value: number) => Number.isFinite(value) ? Math.max(0,value) : 0;
const edge = (value: number | undefined, limit: number) => Math.min(limit,size(value ?? 0));
export function visibleViewport(width: number,height: number,insets?: ViewportInsets): VisibleViewport | null {
  width=size(width); height=size(height);
  const left=edge(insets?.left,width), right=edge(insets?.right,width), top=edge(insets?.top,height), bottom=edge(insets?.bottom,height);
  const w=width-left-right, h=height-top-bottom;
  return w>0 && h>0 ? {left,top,width:w,height:h,aspect:w/h} : null;
}

/** Make the logical target and vertical FOV occupy the unoccluded rectangle.
 * The camera position, target, rotation and Follow offset do not move. This is
 * an off-centre full-canvas frustum, not a cropped renderer or actor transform. */
export function composeVisibleViewport(camera: PerspectiveCamera,width: number,height: number,insets: ViewportInsets | undefined,logicalFov: number): VisibleViewport | null {
  const area=visibleViewport(width,height,insets);
  if (!area) return null;
  const fov=Number.isFinite(logicalFov) ? Math.max(1,Math.min(150,logicalFov)) : 45;
  camera.fov=2*Math.atan(Math.tan(fov*Math.PI/360)*height/area.height)*180/Math.PI;
  const cx=area.left+area.width/2, cy=area.top+area.height/2;
  camera.setViewOffset(width,height,width/2-cx,height/2-cy,width,height);
  camera.updateProjectionMatrix();
  return area;
}
