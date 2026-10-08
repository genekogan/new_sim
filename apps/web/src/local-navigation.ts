/** Gene's single-world localhost preview; production routes stay unchanged. */
export const singleLocalPreview=(hostname:string)=>hostname==='127.0.0.1'||hostname==='localhost';
export function localNavigationAvailable(hostname:string,path:string):boolean{
 return !singleLocalPreview(hostname)||path==='/w/eden';
}
