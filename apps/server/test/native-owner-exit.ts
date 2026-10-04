// Deliberate serialized local process exits at real durable-write boundaries.
import { fixture, invite, accept } from './native-owner-fixture.ts';
const [path, boundary] = process.argv.slice(2);
if (!path || !['row','birth','applied','retire-row'].includes(boundary)) throw new Error('invalid fixture boundary');
const f = fixture(path); await invite(f,'alice');
if (boundary === 'birth') {
  const append = f.db.appendEvent.bind(f.db);
  f.db.appendEvent = (world, event) => { append(world,event); if(event.kind === 'birth') process.exit(23); };
}
if (boundary === 'row') {
  const create=f.db.createSoul.bind(f.db);
  f.db.createSoul=input=>{create(input);process.exit(23);};
}
if (boundary === 'applied') f.host.listeners.push({onApplied:event=>{if(event.kind==='birth')process.exit(23);}});
if (boundary === 'retire-row') {
  const response = await accept(f.host,f.request('/v1/souls',{name:'Alice',description:'local owner fixture'}));
  if(response.status!==200)throw new Error('fixture birth failed');
  const {soul} = await response.json() as {soul:{id:string}};
  const retire=f.db.retireSoul.bind(f.db);
  f.db.retireSoul=id=>{retire(id);process.exit(23);};
  await accept(f.host,f.request(`/v1/souls/${soul.id}`,undefined,'alice','DELETE'));
  throw new Error('expected retirement exit not reached');
}
await accept(f.host,f.request('/v1/souls',{name:'Alice',description:'local owner fixture'}));
throw new Error('expected exit boundary not reached');
