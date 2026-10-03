// Explicit browser-only direction. The ordinary Runtime judges and runs every requested move.
import {useState} from 'react';
import {CAMP_SPOTS} from '../../engine/scenarios/eden-camp.ts';
import type {LabSim} from './sim.ts';
export function WorldSnapshotHud({sim}:{sim:LabSim}){
 const people=Object.values(sim.rt.world.entities).filter(e=>e.human);
 const [actor,setActor]=useState(people[0]?.id??''),[place,setPlace]=useState(''),[message,setMessage]=useState('');
 const destinations=sim.scenario.name==='eden-camp-snapshot'?CAMP_SPOTS.map(s=>({id:s.id,label:s.label,x:s.p[0],z:s.p[1],level:0})):sim.scenario.name==='greenfield-snapshot'?[{id:'field',label:'Across the green field',x:4,z:0,level:0}]:Object.values(sim.rt.world.regions).map(r=>{const x=r.polygon.reduce((n,p)=>n+p[0],0)/r.polygon.length,z=r.polygon.reduce((n,p)=>n+p[1],0)/r.polygon.length;return {id:r.id,label:r.label,x:r.kind==='place'?x+1.4:0,z:r.kind==='place'?z:22,level:r.level??0};});
 const selected=destinations.find(d=>d.id===place)??destinations[0];
 return <section className="lab-hud lab-classroom"><h3>Direction in this snapshot</h3><p>Choose a person and a place, request the move, then Play. Reset returns to the original place.</p>
  <label>Person <select aria-label="Snapshot person" value={actor} onChange={e=>setActor(e.target.value)}>{people.map(e=><option key={e.id} value={e.id}>{e.label??e.id}</option>)}</select></label>
  <label>Destination <select aria-label="Snapshot destination" value={selected?.id??''} onChange={e=>setPlace(e.target.value)}>{destinations.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
  <button disabled={!actor||!selected||!!sim.halted} onClick={()=>{const r=sim.rt.submit('walk_to',{actor,x:selected.x,z:selected.z,level:selected.level},{preempt:true});setMessage(r.status==='failed'?r.diagnostic?.message??'Move refused':'Move requested. Play advances the ordinary body.');}}>Request move</button>
  {message&&<p role="status">{message}</p>}
 </section>;
}
