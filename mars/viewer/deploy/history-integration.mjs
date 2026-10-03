import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const base=process.env.SIM_BASE||'http://localhost:8797';
const hash=s=>createHash('sha256').update(s).digest('hex'),key=randomBytes(32).toString('hex'),room=hash(hash(key)),headers={Authorization:`Bearer ${room}.${key}`};
for(const [i,year] of [2020,2021,2022,2023,2024,2025,2026].entries()){
 const client=new Client({name:'mars-year-verification',version:'1.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?year=${year}`),{requestInit:{headers}}));
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r.content));return JSON.parse(r.content[0].text);};
 const caps=await call('get_capabilities');assert.equal(caps.year,year);assert.equal(caps.people.length,[7,12,16,22,22,22,18][i]);
 const before=await call('get_state');assert.equal(before.year,year);assert.equal(before.state.environment.hour,16);assert.equal(before.state.revision,0);
 const after=await call('set_environment',{hour:year-2010,cycle:false});assert.equal(after.state.environment.hour,year-2010);
 await call('set_fire',{mode:'on'});
 await call('set_euc_riders',{count:2,speed:2});
 const screen=await call('set_screens',{screens:[caps.screens[0]],enabled:true,program:'talk',title:`Mars ${year}`});assert.equal(screen.state.screens[caps.screens[0]].title,`Mars ${year}`);
 await client.close();
 const snapshot=await (await fetch(`${base}/api/simulation/state?year=${year}`,{headers})).json();assert.equal(snapshot.state.environment.hour,year-2010);
 console.log(`PASS ${year}: MCP handshake, ${caps.people.length} people, environment, fire, riders, screens, REST persistence`);
}
for(const year of [2020,2021,2022,2023,2024,2025,2026]){
 const s=await(await fetch(`${base}/api/simulation/state?year=${year}`,{headers})).json();assert.equal(s.state.environment.hour,year-2010,'year isolation');
}
assert.equal((await fetch(`${base}/api/simulation/state?year=2019`,{headers})).status,400);
assert.equal((await fetch(`${base}/api/simulation/state?year=2027`,{headers})).status,400);
console.log('PASS: seven persistent year namespaces remain independent with the same room credentials.');
