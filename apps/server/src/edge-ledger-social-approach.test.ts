// SOCIAL-APPROACH (ACCEPT2 brief 6): a social act aimed at a Soul out of reach (farther than a gesture reaches, or out of
// sight) walks the Soul over first and then asks, never "X is not nearby" or a bare walk somewhere else.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';

async function apart(placeA = 'walk:eden-dome', placeB = 'walk:eden-gardens') {
  const w = await edenNavWorld(2), [a, b] = w.souls;
  const body = (s: {entityId: string}) => (w.engine.world.entities as any)[s.entityId];
  const gap = () => Math.hypot(body(a).pose.p[0] - body(b).pose.p[0], body(a).pose.p[2] - body(b).pose.p[2]);
  const go = await Promise.all([w.act(a, placeA), w.act(b, placeB)]) as any[];
  await w.run(go.map((o, i) => ({soulId: w.souls[i].soulId, id: o.receipt.id})), 20 * 60 * 3);
  return {w, a, b, body, gap};
}

/** a asks for a paired act with b in plain words; b accepts the invitation when it arrives; both do it together. */
async function pairedFromAfar(t: any, ask: (name: string) => string, activity: string, cap: string, places: [string, string] = ['walk:eden-dome', 'walk:eden-gardens'], prep?: (w: any, a: any) => Promise<void>) {
  const {w, a, b, body, gap} = await apart(...places);
  await prep?.(w, a); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const before = gap(); assert.ok(before > 12, 'apart: ' + before);
  const inSight = (w.ledger.capabilities(a) as any[]).some(c => c.id === 'go-near:' + b.soulId);
  const out: any = await w.act(a, ask(b.name));
  assert.equal(out.accepted, true, 'a far social act is accepted, not refused: ' + JSON.stringify(out));
  assert.equal(out.resolved?.to ?? out.receipt.capability, cap + ':' + b.soulId);
  let inv: any = null, yes: any = null, together = false, closest = 99;
  await w.run([{soulId: a.soulId, id: out.receipt.id}], 20 * 60 * 3, () => {
    if (!inv) {inv = (w.ledger.observe(b, new Set()) as any).invites?.[0] ?? null; if (inv) yes = w.act(b, 'accept');}
    if (activity === 'give' ? (w.ledger as any).together.heldBy(b.soulId)?.kind === 'book' : body(a).human.activity === activity && body(b).human.activity === activity) {together = true; closest = Math.min(closest, gap());}
  });
  const r = w.ledger.receipt(a.soulId, out.receipt.id)!;
  t.diagnostic(JSON.stringify({before, inSight, phase: r.phase, code: r.code, reason: r.reason, invited: inv?.what, together, closest}));
  assert.equal(inv?.what, cap, 'the invitation reached b once a was there');
  assert.equal((await yes)?.accepted, true);
  assert.equal(r.phase, 'completed', JSON.stringify(r)); assert.ok(together && closest < 1.6, 'did it together, side by side');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
}

test('social approach: "hug B" from across the commons walks over, asks, hugs', {timeout: 900000}, t => pairedFromAfar(t, n => 'hug ' + n, 'hug', 'hug'));
test('social approach: "dance with B" from afar', {timeout: 900000}, t => pairedFromAfar(t, n => 'dance with ' + n, 'dance', 'dance-with'));
test('social approach: "high five B" from afar', {timeout: 900000}, t => pairedFromAfar(t, n => 'high five ' + n, 'high-five', 'high-five'));
test('social approach: "hug B" while B is out of sight (far side of the world)', {timeout: 900000}, t => pairedFromAfar(t, n => 'go hug ' + n, 'hug', 'hug', ['walk:eden-north-woods', 'walk:eden-gardens']));
test('social approach: "give the book to B" from afar: picks it up, walks over, hands it over', {timeout: 900000}, t => pairedFromAfar(t, n => 'give the book to ' + n, 'give', 'give', ['walk:eden-library-1', 'walk:eden-gardens'], async (w, a) => {
  const pick = (w.ledger.capabilities(a) as any[]).find(c => c.verb === 'pick-up' && /book/i.test(c.id + c.label)); assert.ok(pick, 'a book to pick up');
  const out: any = await w.act(a, pick.id); await w.run([{soulId: a.soulId, id: out.receipt.id}], 20 * 60);
}));
test('social approach: "invite B to read with you" while B is out of sight sends the invite; B accepts and walks over', {timeout: 900000}, async t => {
  const {w, a, b, body, gap} = await apart('walk:eden-north-woods', 'walk:eden-gardens'); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const before = gap(); assert.ok(before > 60, 'out of invite sight: ' + before);
  const out: any = await w.act(a, 'invite ' + b.name + ' to read with you');
  assert.equal(out.accepted, true, JSON.stringify(out));
  const inv = (w.ledger.observe(b, new Set()) as any).invites?.[0]; assert.equal(inv?.what, 'read', 'b is invited');
  const yes: any = await w.act(b, 'accept'); assert.equal(yes.accepted, true, JSON.stringify(yes));
  let both = false;
  await w.run([{soulId: b.soulId, id: yes.receipt.id}], 20 * 60 * 3, () => {both ||= body(a).human.activity === 'read' && body(b).human.activity === 'read' && gap() < 4;});
  t.diagnostic(JSON.stringify({before, after: gap(), both, b: w.ledger.receipt(b.soulId, yes.receipt.id)}));
  assert.ok(both, 'reading together, side by side');
});
