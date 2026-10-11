type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Port={location:Pick<Location,'pathname'|'search'|'hash'>;history:Pick<History,'replaceState'>;storage:()=>StoragePort};
const key=(worldURL:string)=>'sim.new-soul.pending.'+worldURL;
export function pendingNewSoul(worldURL:string,hash:string,storage:()=>StoragePort){try{return hash==='#join'||storage().getItem(key(worldURL))==='1';}catch{return hash==='#join';}}
/** Save the world-local continuation before opening existing provider sign-in. */
export function requestNewSoul(auth:{authed:boolean;login():void},requireAuth:boolean,worldURL:string,port:Port){
 if(!requireAuth||auth.authed)return true;
 try{port.storage().setItem(key(worldURL),'1');}catch{}
 port.history.replaceState(null,'',port.location.pathname+port.location.search+'#join');auth.login();return false;
}
export function resumeNewSoul(pending:boolean,requireAuth:boolean,authed:boolean,worldURL:string,storage:()=>StoragePort){if(!pending||requireAuth&&!authed)return false;try{storage().removeItem(key(worldURL));}catch{}return true;}
export function dismissNewSoul(worldURL:string,port:Port){try{port.storage().removeItem(key(worldURL));}catch{}if(port.location.hash==='#join')port.history.replaceState(null,'',port.location.pathname+port.location.search);}
