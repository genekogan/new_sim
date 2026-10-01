import {test,expect} from '@playwright/test';
import {captureView,collectConsoleErrors,expectCanvasNotBlank,lookAt,openStudio,waitFrames,writeArtifact} from './helpers';

test('adaptive drawing-buffer resize presents a rendered frame and preserves the occupied solarium',async({page},testInfo)=>{
 const errors=collectConsoleErrors(page);
 await page.addInitScript(()=>{
  const native=requestAnimationFrame.bind(window);
  const proof=window as unknown as {resizeProof:{width:number;height:number;colours:number}[]};
  proof.resizeProof=[];
  // Slow the real frame loop enough to exercise its existing five-second budget.
  window.requestAnimationFrame=callback=>native(time=>setTimeout(()=>{
   const canvas=document.querySelector<HTMLCanvasElement>('.studio canvas');
   const before=canvas?[canvas.width,canvas.height]:null;
   callback(time);
   if(!canvas||!before||(canvas.width===before[0]&&canvas.height===before[1]))return;
   const gl=canvas.getContext('webgl2');if(!gl)return;
   const pixels=new Uint8Array(canvas.width*canvas.height*4);
   gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   const colours=new Set<number>();
   for(let i=0;i<pixels.length&&colours.size<64;i+=4*97)colours.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
   proof.resizeProof.push({width:canvas.width,height:canvas.height,colours:colours.size});
  },65));
 });
 await openStudio(page,2024);
 await page.waitForFunction(()=>((window as unknown as {resizeProof:unknown[]}).resizeProof).length>0);
 const proof=await page.evaluate(()=>(window as unknown as {resizeProof:{width:number;height:number;colours:number}[]}).resizeProof);
 expect(proof.every(p=>p.colours>16),'each resized buffer was drawn before presentation').toBe(true);
 await lookAt(page,[7.2,1.55,6.9],[9.2,.8,4.6]);
 await expectCanvasNotBlank(page);
 await captureView(page,'occupied-solarium',{testInfo,compare:false});
 const view=page.locator('select').filter({has:page.locator('option[value="complete"]')});
 for(const cut of ['inside','frame','complete']){await view.selectOption(cut);await waitFrames(page,3);await expectCanvasNotBlank(page);}
 await captureView(page,'occupied-solarium-restored',{testInfo,compare:false});
 writeArtifact('adaptive-resize-proof.json',proof);
 expect(errors).toEqual([]);
});
