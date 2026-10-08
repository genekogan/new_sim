/** glTF column-major bind transforms, used only to qualify an uploaded canonical rig. */
export function rigWorldMatrices(nodes:any[],parents:Map<number,number>){
 const matrices=new Map<number,number[]>();
 const mul=(a:number[],b:number[])=>Array.from({length:16},(_,i)=>{const row=i%4,col=Math.floor(i/4);let v=0;for(let k=0;k<4;k++)v+=a[k*4+row]*b[col*4+k];return v;});
 const world=(i:number):number[]=>{const cached=matrices.get(i);if(cached)return cached;const n=nodes[i],t=n.translation??[0,0,0],s=n.scale??[1,1,1],[x,y,z,w]=n.rotation??[0,0,0,1];
  const local=n.matrix??[(1-2*(y*y+z*z))*s[0],2*(x*y+z*w)*s[0],2*(x*z-y*w)*s[0],0,2*(x*y-z*w)*s[1],(1-2*(x*x+z*z))*s[1],2*(y*z+x*w)*s[1],0,2*(x*z+y*w)*s[2],2*(y*z-x*w)*s[2],(1-2*(x*x+y*y))*s[2],0,t[0],t[1],t[2],1];
  const parent=parents.get(i),result=parent===undefined?local:mul(world(parent),local);matrices.set(i,result);return result;};
 return world;
}
export function rigWorldPoints(nodes:any[],parents:Map<number,number>){
 const matrix=rigWorldMatrices(nodes,parents);return(i:number)=>{const m=matrix(i);return[m[12],m[13],m[14]];};
}
