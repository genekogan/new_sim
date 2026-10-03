import type {Object3D} from 'three';

/** Source omissions survive presentation cuts. Capture after source correction,
 * before campus-life animation or the first display() call. */
export function createSourceVisibilityGuard(){
 const omitted=new WeakSet<Object3D>();
 return {
  remember(o:Object3D){if(!o.visible&&o.userData.kind!=='context_person')omitted.add(o);},
  cut(o:Object3D,mode:string){
   const layer=o.userData.layer;if(!layer)return;
   o.visible=!omitted.has(o)&&
    !(mode==='inside'&&(layer==='Roofs and upper floors'||layer==='Walls and screens'))&&
    !(mode==='frame'&&layer!=='Rack steel'&&layer!=='Timber, floors and stairs');
  },
 };
}
