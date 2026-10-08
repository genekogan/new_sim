/** App-owned local lesson projection. It is never a recorded world fact. */
export type LocalClassroomPresentation={worldId:string;screenEntityId:string;imageUrl:string;index:number};
export const EDEN_CLASSROOM_SCREEN_ID='eden-classroom-screen-1';
export function currentClassroomPresentation(input:LocalClassroomPresentation|undefined,worldId:string,screenPresent:boolean,history:boolean){
 if(history||!screenPresent||!input||input.worldId!==worldId||input.screenEntityId!==EDEN_CLASSROOM_SCREEN_ID||!Number.isInteger(input.index)||input.index<0||input.index>2||typeof input.imageUrl!=='string'||!input.imageUrl.startsWith('data:image/svg+xml;')||input.imageUrl.length>200000)return null;
 return input;
}
