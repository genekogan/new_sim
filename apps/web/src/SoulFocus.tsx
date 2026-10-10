import {useState} from 'react';
import type {AuthCtx} from './Shell.tsx';
import type {Api,Sim} from './useSim.ts';
import {approvedMe,authIdentity} from './auth-projection.ts';
import {SoulCard} from './SoulCard.tsx';
import {SoulChoices} from './SoulChoices.tsx';
import {doingText} from './place-names.ts';
import {SoulMind} from './SoulMind.tsx';
type FocusProps={sim:Sim;api:Api;auth:AuthCtx;selected:string|null;select(id:string|null):void;manage():void;active?:boolean;camera?:{following:boolean;follow():void;stop():void};pin?:{pinned:boolean;toggle():void}};
export function SoulFocus(props:FocusProps){
 const own=!!props.selected&&!!approvedMe(props.auth,props.sim.me)?.souls.includes(props.selected);
 const key=JSON.stringify([props.sim.privateAuthorityGeneration??0,props.sim.conn.welcome?.worldId,props.sim.conn.welcome?.epoch,props.selected,authIdentity(props.auth),own]);
 return <FocusCard key={key} {...props} own={own}/>;
}
function FocusCard({sim,api,auth,selected,select,manage,camera,pin,own}:FocusProps&{own:boolean}){
 const [mind,setMind]=useState(false),soul=selected?sim.conn.replica.souls.get(selected):null;
 if(!soul)return <><h1>Meet its Souls</h1><p>Each Soul is run by its owner’s AI agent. Choose someone to watch.</p><SoulChoices souls={[...sim.conn.replica.souls.values()]} ownedIds={approvedMe(auth,sim.me)?.souls??[]} select={select}/><button onClick={manage}>Your account</button></>;
 if(own&&mind)return <><button onClick={()=>setMind(false)}>‹ {soul.name}</button><SoulMind api={api} soulId={soul.id} name={soul.name}/></>;
 const entity=sim.conn.replica.entities[soul.entityId],energy=typeof soul.energy==='string'&&['energetic','tired','exhausted'].includes(soul.energy)?soul.energy:null;
 return <SoulCard api={api} soul={soul} doing={doingText(soul.doing,entity?.human?.activity,soul.id,id=>sim.kernel?.things[id]?.name??sim.conn.replica.entities[id]?.label)} energy={energy} plays={sim.plays} talk={sim.talk} camera={camera} pin={pin} ownerAction={own?()=>setMind(true):undefined}/>;
}
