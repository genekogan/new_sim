import type {Context,Hono} from 'hono';
import {EdgeError,edgeBody,type EdgeDeps, edgeErrorOf} from '../contract.ts';
import type {CommsRuntime} from '../comms/index.ts';
import {freshBootClock} from '../boot/clock.ts';
import {PersonalReminders} from './reminders.ts';
export function mountPersonalReminders(app:Hono,deps:EdgeDeps,comms:CommsRuntime,options:{now?:()=>number;intervalMs?:number}={}){
 const now=options.now??Date.now,clock=()=>freshBootClock(deps.host,now()),service=new PersonalReminders(deps.db.db,deps.host.worldId,comms.streams,clock);
 const wrap=(fn:(c:Context)=>unknown|Promise<unknown>)=>async(c:Context)=>{
  c.header('Cache-Control','no-store');
  try{return c.json(edgeBody({apiContract:'eden-edge/1.1',...await fn(c) as object,clocks:{...clock(),realTime:new Date(now()).toISOString()}}));}
  catch(error){if(error instanceof EdgeError)return c.json(edgeBody({apiContract:'eden-edge/1.1',error:edgeErrorOf(error)}),error.status as 400);throw error;}
 };
 const soul=(c:Context,key:string,n:number)=>{const s=deps.soul(c),limits=(deps.souls as {limits?:{allow(k:string,n:number,ms:number):{ok:boolean}}}).limits;if(limits&&!limits.allow(`edge-reminders-${key}:${s.soulId}`,n,60000).ok)throw new EdgeError(429,'rate-limited','Too many personal reminder requests.');return s;};
 app.post('/v1/edge/reminders',wrap(async c=>{
  soul(c,'create',30);const input=await c.req.json().catch(()=>{throw new EdgeError(400,'reminder.invalid','A JSON reminder request is required.');});
  return service.create(deps.soul(c).soulId,input);
 }));
 app.get('/v1/edge/reminders',wrap(c=>service.list(soul(c,'list',120).soulId,c.req.query('state'),c.req.query('after'))));
 app.delete('/v1/edge/reminders/:id',wrap(c=>service.cancel(soul(c,'cancel',60).soulId,c.req.param('id')??'')));
 // Separate owned wall timer; real reminders continue while the world is
 // paused. World targets compare only the unchanged authoritative world clock.
 // <=1s polling gives the declared <=2s running-server delivery acceptance.
 const period=options.intervalMs??1000;if(!Number.isInteger(period)||period<0||period>1000)throw Error('reminder interval must be 0(test-only) or1..1000ms');
 let closed=false;const pump=()=>{if(closed)return;try{service.pump();}catch{/* durable due/outbox remains pending for the next tick/restart */}};
 pump();const timer=period>0?setInterval(pump,period):null;timer?.unref();
 return {service,pump,close(){closed=true;if(timer)clearInterval(timer);}};
}
