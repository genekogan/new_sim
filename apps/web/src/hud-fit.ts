import {useEffect} from 'react';

// Lane U3 (Gene 2026-10-20b: "navbar should always be one line ... progressively removing text from buttons and just
// having the icons"). The world page's top bar is one grid row (world-chrome.css). When its controls do not fit the
// width, steps are added to the header's data-fit, one at a time, until they do; each step's CSS is in world-chrome.css.
// Labels go first (icons stay), in this order; on small screens (html.phone-tidy, where the HUD's More menu exists) whole
// controls then move into More; the last step lets the status chip truncate rather than leave the screen.
export const HUD_FIT_STEPS=[
 'keys',       // the ⌘K / ⌘G hints
 'broadcast',  // "Broadcast" (its red dot stays), and a long "Following <name>" shortens
 'god',        // "God" (the bolt stays)
 'newsoul',    // "New Soul" (the person-plus icon stays)
 'explore',    // "Explore" (the magnifier stays)
 'live',       // "Live" and the weekday (the green dot and the time stay)
 'fullscreen', // small screens: Full screen → More
 'follow',     // small screens: Broadcast / Following → More
 'camera',     // small screens: Camera controls → More
 'souls',      // small screens: your Souls' portraits → More
 'godmore',    // small screens: God → More
 'squeeze',    // last resort: the status chip truncates
] as const;

/** The data-fit value for `level` steps. */
export const fitSteps=(level:number)=>HUD_FIT_STEPS.slice(0,level).join(' ');

/** The fewest steps at which `fits` holds, starting the search at the current level so a settled bar costs a layout or two. */
export function pickFit(from:number,fits:(level:number)=>boolean,max:number=HUD_FIT_STEPS.length):number{
 let level=Math.max(0,Math.min(from,max));
 if(fits(level)){while(level>0&&fits(level-1))level--;return level;}
 while(level<max&&!fits(level+1))level++;
 return Math.min(level+1,max);
}

/** Every column of the bar ends inside it (the columns are max-content, so a bar that does not fit overflows). */
export function hudFits(hud:HTMLElement):boolean{
 const box=hud.getBoundingClientRect();
 for(const el of Array.from(hud.children)){
  if(el.matches('.local-integration,.local-connection-help'))continue;
  const r=el.getBoundingClientRect();
  if(r.width&&(r.right>box.right+0.5||r.left<box.left-0.5))return false;
 }
 return true;
}

/** Keep `hud` (the world view's top bar) on one line as its width and contents change. */
export function useHudFit(hud:HTMLElement|null){
 useEffect(()=>{
  if(!hud||typeof ResizeObserver!=='function')return;
  let frame=0,level=0;
  const apply=(l:number)=>{const v=fitSteps(l);if(hud.dataset.fit!==v)hud.dataset.fit=v;};
  const fit=()=>{frame=0;level=pickFit(level,l=>{apply(l);return hudFits(hud);});apply(level);};
  // measured on the next frame, never inside the observer's own callback (no ResizeObserver loop errors)
  const soon=()=>{if(!frame)frame=requestAnimationFrame(fit);};
  const sizes=new ResizeObserver(soon);
  const watch=()=>{sizes.disconnect();sizes.observe(hud);for(const el of Array.from(hud.children))sizes.observe(el);soon();};
  const children=new MutationObserver(watch);children.observe(hud,{childList:true});
  const tidy=new MutationObserver(soon);tidy.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  watch();
  return()=>{sizes.disconnect();children.disconnect();tidy.disconnect();if(frame)cancelAnimationFrame(frame);delete hud.dataset.fit;};
 },[hud]);
}
