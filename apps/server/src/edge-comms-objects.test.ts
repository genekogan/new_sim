// C7 object framework + C8 chess and ticketed presentation.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EDGE_CONTRACT} from './edge/contract.ts';
import {COMMONS, commsFixture, place} from './edge/comms/testing.ts';

const PARLOUR = place('parlour', 'room');
const VENUE = place('eden-classroom-1', 'venue');
const setTick = (f: ReturnType<typeof commsFixture>, tick: number) => { (f.host as any).engine.world.tick = tick; };
const objectEvents = (events: any[], kind = 'object') => events.filter(e => e.kind === kind);

function chessWorld() {
  const f = commsFixture(['Alice', 'Bob', 'Cleo', 'Dan']);
  for (const [n, x] of [['Alice', 0], ['Bob', 1], ['Cleo', 2]] as const) f.at(n, x, 0, [PARLOUR, COMMONS], 'parlour');
  f.runtime.objects.create({id: 'chess-1', kind: 'chess', name: 'Chess table', placeId: 'parlour'});
  return f;
}
const move = (f: ReturnType<typeof commsFixture>, who: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
  f.post(who, '/v1/edge/objects/chess-1/act', {action: 'move', params: {from, to, ...extra}});

test('objects are read by entitlement and reach; actions appear as capabilities', async () => {
  const f = chessWorld();
  try {
    assert.equal((await f.get('Dan', '/v1/edge/objects/chess-1')).status, 404, 'Dan is outside the parlour');
    const seen = await f.get('Cleo', '/v1/edge/objects/chess-1');
    assert.equal(seen.status, 200); assert.equal(seen.body.contract, EDGE_CONTRACT);
    assert.equal(seen.body.object.state.board[0], 'rnbqkbnr'); assert.equal(seen.body.object.state.status, 'waiting');
    assert.deepEqual(seen.body.object.actions.map((a: any) => a.action), ['sit', 'reset']);
    const caps = f.ledger.capabilities({soulId: f.id('Cleo'), entityId: '', name: 'Cleo', owner: ''});
    const sit = caps.find(c => c.id === 'object:chess-1:sit')!;
    assert.deepEqual([sit.verb, sit.object, sit.action, sit.available], ['object', 'chess-1', 'sit', true]);
    assert.equal(f.ledger.capabilities({soulId: f.id('Dan'), entityId: '', name: 'Dan', owner: ''}).length, 0);
    const listed = await f.get('Cleo', '/v1/edge/objects');
    assert.deepEqual(listed.body.objects.map((o: any) => [o.id, o.here]), [['chess-1', true]]);
    assert.equal((await f.post('Cleo', '/v1/edge/objects/chess-1/act', {action: 'fly'})).body.code, 'object.action-unknown');
    assert.equal((await f.post('Cleo', '/v1/edge/objects/chess-1/act', {action: 'sit', params: {color: 'green'}})).body.code, 'capability.params');
    assert.equal((await f.post('Cleo', '/v1/edge/objects/chess-1/act', {action: 'sit', params: {bogus: 1}})).body.code, 'capability.params');
    assert.equal((await f.post('Cleo', '/v1/edge/objects/chess-1/act', {action: 'move', params: {from: 'e2', to: 'e4'}})).body.code, 'object.role');
    assert.equal((await f.post('Cleo', '/v1/edge/objects/chess-1/act', {params: {}})).status, 400);
  } finally { f.destroy(); }
});

test('a listing asks for the Soul\'s place path once, however many objects there are', async () => {
  const f = chessWorld();
  try {
    for (let i = 0; i < 30; i++) f.runtime.objects.create({id: `chess-x${i}`, kind: 'chess', name: `Table ${i}`, placeId: i % 2 ? 'parlour' : 'eden-commons'});
    let asked = 0; const real = f.ledger.placePathOf.bind(f.ledger);
    f.ledger.placePathOf = (id: string) => { asked++; return real(id); };
    const soul = (name: string) => ({soulId: f.id(name), entityId: '', name, owner: ''});
    // Cleo stands in both the parlour and the commons: all 31 objects, two actions each
    asked = 0; const cleo = f.runtime.objects.capabilities(soul('Cleo'));
    assert.equal(cleo.length, 31 * 2); assert.equal(new Set(cleo.map(c => c.object)).size, 31); assert.equal(asked, 1);
    asked = 0; const seen = f.runtime.objects.visibleTo(soul('Cleo'));
    assert.equal(seen.length, 31); assert.ok(seen.every(o => o.here)); assert.equal(asked, 1);
    // Dan stands only in the commons: the 15 commons tables, not the parlour's
    asked = 0; const dan = f.runtime.objects.capabilities(soul('Dan'));
    assert.deepEqual([...new Set(dan.map(c => c.object))].sort(), Array.from({length: 15}, (_, i) => `chess-x${i * 2}`).sort()); assert.equal(asked, 1);
    asked = 0; assert.equal(f.runtime.objects.visibleTo(soul('Dan')).length, 15); assert.equal(asked, 1);
    // a Soul who is nowhere sees nothing, and a path lookup that throws is treated as nowhere (as before)
    f.ledger.placePathOf = () => { throw new Error('no body'); };
    assert.equal(f.runtime.objects.capabilities(soul('Dan')).length, 0);
  } finally { f.destroy(); }
});

test('clientRef makes a retried object act return the original result', async () => {
  const f = chessWorld();
  try {
    const a = await f.post('Alice', '/v1/edge/objects/chess-1/act', {action: 'sit', params: {color: 'white'}, clientRef: 'sit-1'});
    const b = await f.post('Alice', '/v1/edge/objects/chess-1/act', {action: 'sit', params: {color: 'white'}, clientRef: 'sit-1'});
    assert.equal(a.body.accepted, true); assert.deepEqual(b.body, a.body);
    assert.equal((await f.post('Alice', '/v1/edge/objects/chess-1/act', {action: 'sit'})).body.code, 'chess.already-seated');
  } finally { f.destroy(); }
});

test('chess: opposing seats, turn order, legal moves only, checkmate', async () => {
  const f = chessWorld();
  try {
    await f.post('Alice', '/v1/edge/objects/chess-1/act', {action: 'sit', params: {color: 'white'}});
    const bobSit = await f.post('Bob', '/v1/edge/objects/chess-1/act', {action: 'sit'});
    assert.deepEqual(bobSit.body.result, {color: 'black', status: 'playing'});
    assert.equal((await f.post('Cleo', '/v1/edge/objects/chess-1/act', {action: 'sit'})).body.code, 'chess.seat-taken', 'third Soul cannot sit');
    assert.equal((await move(f, 'Bob', 'e7', 'e5')).body.code, 'chess.not-your-turn');
    assert.equal((await move(f, 'Alice', 'e2', 'e5')).body.code, 'chess.illegal');
    assert.equal((await move(f, 'Alice', 'e7', 'e5')).body.code, 'chess.not-your-piece');
    for (const [who, from, to] of [['Alice', 'e2', 'e4'], ['Bob', 'e7', 'e5'], ['Alice', 'f1', 'c4'], ['Bob', 'b8', 'c6'], ['Alice', 'd1', 'h5'], ['Bob', 'g8', 'f6']] as const)
      assert.equal((await move(f, who, from, to)).body.accepted, true, `${from}${to}`);
    const mate = await move(f, 'Alice', 'h5', 'f7');
    assert.deepEqual(mate.body.result, {move: 'h5f7', check: true, status: 'checkmate', winner: 'white'});
    assert.equal((await move(f, 'Bob', 'e8', 'f7')).body.code, 'chess.not-playing');
    const bobEvents = objectEvents((await f.drain('Bob')).events);
    assert.match(bobEvents.at(-1).text, /Alice played h5f7\. Checkmate\./);
    const board = (await f.get('Cleo', '/v1/edge/objects/chess-1')).body.object.state;
    assert.equal(board.board[1], 'pppp.Qpp'); assert.deepEqual(board.moves.length, 7);
    const reset = await f.post('Cleo', '/v1/edge/objects/chess-1/act', {action: 'reset'});
    assert.equal(reset.body.accepted, true);
    assert.equal((await f.get('Cleo', '/v1/edge/objects/chess-1')).body.object.state.board[6], 'PPPPPPPP');
  } finally { f.destroy(); }
});

test('chess: castling, en passant, promotion and check rules', async () => {
  const f = chessWorld();
  try {
    await f.post('Alice', '/v1/edge/objects/chess-1/act', {action: 'sit', params: {color: 'white'}});
    await f.post('Bob', '/v1/edge/objects/chess-1/act', {action: 'sit', params: {color: 'black'}});
    const seq: [string, string, string][] = [['Alice', 'e2', 'e4'], ['Bob', 'a7', 'a6'], ['Alice', 'e4', 'e5'], ['Bob', 'd7', 'd5'], ['Alice', 'e5', 'd6'],
      ['Bob', 'a6', 'a5'], ['Alice', 'g1', 'f3'], ['Bob', 'a5', 'a4'], ['Alice', 'f1', 'e2'], ['Bob', 'a4', 'a3'], ['Alice', 'e1', 'g1']];
    for (const [who, from, to] of seq) assert.equal((await move(f, who, from, to)).body.accepted, true, `${from}${to}`);
    let s = (await f.get('Cleo', '/v1/edge/objects/chess-1')).body.object.state;
    assert.equal(s.board[2], '...P....', 'white pawn took en passant onto d6');
    assert.equal(s.board[3], '........', 'en passant capture removed the d5 pawn');
    assert.equal(s.board[7], 'RNBQ.RK.', 'white castled short');
    assert.equal(s.castling, 'kq');
    // Black pawn reaches a3; take b2 and promote on a1/b1 later. Black: a3xb2, then b2xa1=N.
    assert.equal((await move(f, 'Bob', 'a3', 'b2')).body.accepted, true);
    assert.equal((await move(f, 'Alice', 'd6', 'c7')).body.accepted, true);
    const promo = await move(f, 'Bob', 'b2', 'a1', {promotion: 'n'});
    assert.equal(promo.body.accepted, true);
    s = (await f.get('Cleo', '/v1/edge/objects/chess-1')).body.object.state;
    assert.equal(s.board[7][0], 'n', 'promoted to a black knight');
    // White pawn on c7 attacks d8 (black queen): capture with promotion to queen gives check.
    const check = await move(f, 'Alice', 'c7', 'd8');
    assert.equal(check.body.accepted, true); assert.equal(check.body.result.check, true);
    assert.equal((await move(f, 'Bob', 'a8', 'a7')).body.code, 'chess.illegal', 'must answer check');
  } finally { f.destroy(); }
});

function talkWorld() {
  const f = commsFixture(['Alice', 'Bob', 'Cleo', 'Dan', 'Eve']);
  setTick(f, 100);
  f.runtime.objects.create({id: 'wed-talk', kind: 'presentation', name: 'Wednesday talk', placeId: 'eden-classroom-1',
    params: {title: 'Soil and stars', startsAtTick: 1000, doorsOpenTicks: 200, durationTicks: 500, capacity: 2, presenter: f.id('Eve')}});
  return f;
}
const talk = (f: ReturnType<typeof commsFixture>, who: string, action: string, params?: Record<string, unknown>) =>
  f.post(who, '/v1/edge/objects/wed-talk/act', {action, ...(params ? {params} : {})});
const inVenue = (f: ReturnType<typeof commsFixture>, who: string, x = 0) => f.at(who, x, 0, [VENUE, COMMONS], 'eden-classroom-1');

test('presentation: reserve from anywhere, standby queue, doors, curtain release in order', async () => {
  const f = talkWorld();
  try {
    assert.deepEqual((await talk(f, 'Alice', 'reserve')).body.result, {ticket: true});
    assert.deepEqual((await talk(f, 'Bob', 'reserve')).body.result, {ticket: true});
    assert.deepEqual((await talk(f, 'Cleo', 'reserve')).body.result, {ticket: false, standbyPosition: 1});
    assert.deepEqual((await talk(f, 'Dan', 'reserve')).body.result, {ticket: false, standbyPosition: 2});
    assert.equal((await talk(f, 'Dan', 'reserve')).body.code, 'presentation.already-reserved');
    const pub = await f.get('Dan', '/v1/edge/objects/wed-talk');
    assert.equal(pub.body.object.state.ticketsLeft, 0); assert.equal(pub.body.object.state.standbyCount, 2);
    assert.equal(pub.body.object.state.tickets, undefined, 'ticket list is presenter-only');
    assert.deepEqual(pub.body.object.mine, {ticket: false, entered: false, standbyPosition: 2});
    assert.equal((await f.get('Eve', '/v1/edge/objects/wed-talk')).body.object.state.tickets.length, 2);
    inVenue(f, 'Alice'); inVenue(f, 'Cleo', 1);
    assert.equal((await talk(f, 'Alice', 'enter')).body.code, 'presentation.doors-closed');
    setTick(f, 800);
    assert.equal((await talk(f, 'Cleo', 'enter')).body.code, 'presentation.standby-wait');
    assert.match(objectEvents((await f.drain('Alice')).events, 'schedule').at(-1).text, /Doors are open/);
    assert.deepEqual((await talk(f, 'Alice', 'enter')).body.result, {entered: true, seat: 1});
    setTick(f, 1000);                                   // curtain: Bob never came; one seat goes to Cleo (first in standby)
    f.runtime.sweep();
    assert.match(objectEvents((await f.drain('Bob')).events, 'schedule').at(-1).text, /unclaimed seat was released/);
    assert.match(objectEvents((await f.drain('Cleo')).events, 'schedule').at(-1).text, /standby seat .* is yours/);
    assert.match(objectEvents((await f.drain('Dan')).events, 'schedule').at(-1).text, /No seat came free/);
    assert.deepEqual((await talk(f, 'Cleo', 'enter')).body.result, {entered: true, seat: 2});
    inVenue(f, 'Bob', 2);
    assert.equal((await talk(f, 'Bob', 'enter')).body.code, 'presentation.no-ticket');
    assert.equal((await talk(f, 'Bob', 'reserve')).body.code, 'presentation.closed');
  } finally { f.destroy(); }
});

test('presentation: presenter materials and speech reach the audience only; cancellation promotes standby', async () => {
  const f = talkWorld();
  try {
    await talk(f, 'Alice', 'reserve'); await talk(f, 'Bob', 'reserve'); await talk(f, 'Cleo', 'reserve');
    assert.equal((await talk(f, 'Bob', 'cancel')).body.accepted, true);
    assert.match(objectEvents((await f.drain('Cleo')).events, 'schedule').at(-1).text, /you now hold a ticket/);
    assert.equal((await talk(f, 'Eve', 'publish', {text: 'slides'})).body.code, 'presentation.not-open');
    setTick(f, 800);
    inVenue(f, 'Alice'); inVenue(f, 'Cleo', 1);
    assert.equal((await talk(f, 'Alice', 'enter')).body.accepted, true); assert.equal((await talk(f, 'Cleo', 'enter')).body.accepted, true);
    setTick(f, 1000);
    assert.equal((await talk(f, 'Alice', 'publish', {text: 'x'})).body.code, 'object.role');
    assert.equal((await talk(f, 'Eve', 'publish', {text: '# Slide 1'})).body.accepted, true);
    for (const who of ['Alice', 'Cleo']) assert.equal(objectEvents((await f.drain(who)).events).at(-1).text, '# Slide 1');
    assert.equal(objectEvents((await f.drain('Bob')).events).length, 0);
    assert.deepEqual((await f.get('Alice', '/v1/edge/objects/wed-talk')).body.object.state.materials, ['# Slide 1']);
    f.at('Eve', 500, 0); f.at('Bob', 501, 0);           // presenter far away outdoors, Bob beside her
    const said = await f.post('Eve', '/v1/edge/say', {text: 'Welcome, everyone.'});
    assert.equal(said.body.said.channel.kind, 'audience'); assert.equal(said.body.said.heardBy, 3);
    for (const who of ['Alice', 'Cleo', 'Bob']) assert.ok((await f.drain(who)).events.some((e: any) => e.kind === 'speech' && e.text === 'Welcome, everyone.'), who);
    setTick(f, 1500); f.runtime.sweep();
    assert.equal((await f.get('Alice', '/v1/edge/objects/wed-talk')).body.object.state.phase, 'ended');
    const after = await f.post('Eve', '/v1/edge/say', {text: 'bye'});
    assert.equal(after.body.said.channel.kind, 'earshot');
  } finally { f.destroy(); }
});

test('object state and log survive a restart', async () => {
  const first = chessWorld();
  await first.post('Alice', '/v1/edge/objects/chess-1/act', {action: 'sit'});
  first.close();
  const again = commsFixture(['Alice', 'Bob', 'Cleo', 'Dan'], {}, {dir: first.dir, db: first.db, clock: first.clock});
  try {
    again.at('Bob', 1, 0, [PARLOUR, COMMONS], 'parlour');
    again.runtime.objects.create({id: 'chess-1', kind: 'chess', name: 'Chess table', placeId: 'parlour'});   // idempotent
    assert.deepEqual((await again.post('Bob', '/v1/edge/objects/chess-1/act', {action: 'sit'})).body.result, {color: 'black', status: 'playing'});
    const log = again.db.db.prepare('SELECT action FROM edge_comms_object_log WHERE object_id = ? ORDER BY version').all('chess-1') as any[];
    assert.deepEqual(log.map(r => r.action), ['create', 'sit', 'sit']);
  } finally { again.destroy(); }
});

test('objects refuse unavailable or unknown actor bodies before state or log mutation',async()=>{
 const f=chessWorld();try{
  const entityId='h_'+f.id('Alice'),entities=f.host.engine.world.entities,original=entities[entityId];
  const before=(await f.get('Alice','/v1/edge/objects/chess-1')).body.object,logCount=()=>f.db.db.prepare('SELECT COUNT(*) n FROM edge_comms_object_log WHERE world_id=? AND object_id=?').get(f.host.worldId,'chess-1'),beforeLog=logCount();
  for(const invalid of [undefined,{...original,kind:'fixture',human:undefined},{...original,body:{family:'unknown'}}]){
   if(invalid===undefined)delete entities[entityId];else entities[entityId]=invalid as typeof original;
   const out=await f.post('Alice','/v1/edge/objects/chess-1/act',{action:'sit',params:{color:'white'}});
   assert.equal(out.status,200);assert.equal(out.body.accepted,false);assert.match(out.body.code,/^body[.](unavailable|unsupported)$/);
   assert.deepEqual((await f.get('Alice','/v1/edge/objects/chess-1')).body.object,before);assert.deepEqual(logCount(),beforeLog);
  }
  entities[entityId]=original;assert.equal((await f.post('Alice','/v1/edge/objects/chess-1/act',{action:'sit',params:{color:'white'}})).body.accepted,true);
 }finally{f.destroy();}
});

test('GODPERF: fresh() returns still objects as read and advances (and persists) each due object once', async () => {
  const f = talkWorld();
  try {
    const o = f.runtime.objects;
    o.create({id: 'chess-1', kind: 'chess', name: 'Chess table', placeId: 'eden-classroom-1'});
    o.create({id: 'thu-talk', kind: 'presentation', name: 'Thursday talk', placeId: 'eden-classroom-1',
      params: {title: 'Roots', startsAtTick: 1000, doorsOpenTicks: 200, durationTicks: 500, capacity: 2, presenter: f.id('Eve')}});
    const v = (id: string) => o.all().find(x => x.id === id)!.version;
    const before = {chess: v('chess-1'), wed: v('wed-talk'), thu: v('thu-talk')};
    const quiet = o.fresh();
    assert.deepEqual(quiet, o.all(), 'nothing due: fresh() is exactly what all() reads');
    assert.deepEqual({chess: v('chess-1'), wed: v('wed-talk'), thu: v('thu-talk')}, before);
    setTick(f, 800);                                   // doors open on both talks: two objects advance in one sweep
    const swept = o.fresh();
    assert.equal(swept.find(x => x.id === 'wed-talk')!.version, before.wed + 1);
    assert.equal(swept.find(x => x.id === 'thu-talk')!.version, before.thu + 1);
    assert.equal(swept.find(x => x.id === 'chess-1')!.version, before.chess);
    assert.deepEqual(swept, o.all(), 'what fresh() returns is what was persisted');
    assert.deepEqual(o.fresh(), swept, 'a second sweep at the same tick changes nothing');
  } finally { f.destroy(); }
});
