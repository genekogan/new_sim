/** Index the existing Float32 axis-aligned quads. Offsets retain original draw
 * order, including shared-edge ties; interpolation arithmetic is unchanged. */
export function indexGroundQuads(positions:Float32Array){
 let data:Float32Array|null=positions;const cells=new Map<string,number[]>(),step=4;
 for(let i=0;i<positions.length;i+=12){
  for(let x=Math.floor(positions[i]/step);x<=Math.floor(positions[i+3]/step);x++)for(let z=Math.floor(positions[i+2]/step);z<=Math.floor(positions[i+8]/step);z++){
   const key=x+','+z,rows=cells.get(key);if(rows)rows.push(i);else cells.set(key,[i]);
  }
 }
 return {heightAt(x:number,z:number):number|null{
  const a=data;if(!a||!Number.isFinite(x)||!Number.isFinite(z))return null;
  for(const i of cells.get(Math.floor(x/step)+','+Math.floor(z/step))??[]){
   const x0=a[i],x1=a[i+3],z0=a[i+2],z1=a[i+8];if(x<x0||x>x1||z<z0||z>z1)continue;
   const u=(x-x0)/(x1-x0),v=(z-z0)/(z1-z0),A=a[i+1],B=a[i+4],C=a[i+7],D=a[i+10];return v<=u?A+(B-A)*u+(C-B)*v:A+(C-D)*u+(D-A)*v;
  }return null;
 },inspect:()=>({cells:cells.size,references:[...cells.values()].reduce((n,rows)=>n+rows.length,0),retainsPositions:data!==null}),dispose(){cells.clear();data=null;}};
}
