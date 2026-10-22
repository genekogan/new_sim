import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve('vite/package.json'))('esbuild');
const dir = await mkdtemp(join(tmpdir(), 'sim-inbox-render-'));
Object.assign(globalThis, {location: {origin: 'http://localhost:5960', pathname: '/w/inbox/', search: '', hash: ''}, sessionStorage: {getItem: () => null}});
const outfile = join(dir, 'render.cjs');
await build({stdin: {contents: `export {AgentMessageBoxView, soulStartPrompt} from './AgentMessageBox.tsx';export {watchStatus} from './god-ui/god-api.ts';export {watchInbox, godState} from './god-ui/god-store.ts';export {publishSession} from './auth-session.ts';export {SoulFocus} from './SoulFocus.tsx';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx'}, outfile, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty'}, logLevel: 'silent'});
const {AgentMessageBoxView, soulStartPrompt, watchStatus, watchInbox, godState, publishSession, SoulFocus, createElement: h, renderToStaticMarkup: render} = require(outfile);
const props = {kind: 'god', prompt: 'Resume the existing agent and listen.', text: '', onText() {}, onSend() {}, onCopy() {}};
test('absent and unknown agent presence make no delivery claim; start prompt is copyable', () => {
  const absent = render(h(AgentMessageBoxView, {...props, inbox: {connected: false, lastSeenAt: null, latest: null}}));
  assert.match(absent, /Your agent is away — messages will wait/); assert.match(absent, /Copy start prompt/);
  assert.match(absent, /title="Resume the existing agent and listen\."/);
  assert.doesNotMatch(absent, /Picked up|Acknowledged|listening/);
  const unknown = render(h(AgentMessageBoxView, {...props, inbox: null}));
  assert.match(unknown, /Agent status unavailable/); assert.doesNotMatch(unknown, /listening|Picked up/);
});
for (const kind of ['god', 'soul']) for (const state of ['sent', 'delivered', 'acknowledged']) test(`${kind} overlay shows only latest ${state} receipt as plain text`, () => {
  const inbox = {connected: state !== 'sent', lastSeenAt: state === 'sent' ? null : Date.now(), latest: {id: 'one', text: '<script>owner words</script>', state, ...(state === 'acknowledged' ? {reply: '<b>On my way</b>'} : {})}};
  const html = render(h(AgentMessageBoxView, {...props, kind, inbox}));
  assert.match(html, new RegExp(`data-agent-message="${kind}"`));
  assert.match(html, new RegExp(`data-message-state="${state}"`));
  assert.match(html, /&lt;script&gt;owner words&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>|<b>On my way/);
  assert.equal((html.match(/data-message-state=/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<ol|<ul|textarea/);
  assert.match(html, state === 'sent' ? />Sent</ : state === 'delivered' ? /Picked up/ : /Acknowledged/);
  if (state === 'acknowledged') assert.match(html, /&lt;b&gt;On my way&lt;\/b&gt;/);
});
test('MSG: presence says listening now / seen recently / away; an unread message says how long; queued count; reply then result', () => {
  const now = 1_000_000, base = {connected: true, lastSeenAt: now - 12_000};
  const at = (inbox, kind = 'soul') => render(h(AgentMessageBoxView, {...props, kind, now, inbox}));
  const listening = at({...base, presence: 'listening', queued: 0, latest: null});
  assert.match(listening, /Your agent is listening now/); assert.match(listening, /data-agent-presence="listening"/); assert.doesNotMatch(listening, /Copy start prompt/);
  assert.match(at({...base, presence: 'recent', latest: null}), /Your agent was seen recently \(12 s ago\)/);
  assert.match(at({...base, presence: 'working', latest: null}), /seen recently/);
  const away = at({connected: false, lastSeenAt: now - 3_600_000, presence: 'away', latest: null}); assert.match(away, /away — messages will wait/); assert.match(away, /Copy start prompt/);
  const fresh = at({...base, presence: 'listening', queued: 1, latest: {id: 'm', text: 'run!', state: 'sent', sentAt: now - 4_000}});
  assert.match(fresh, />Sent</); assert.doesNotMatch(fresh, /Not picked up|waiting/);
  const stuck = at({...base, presence: 'away', connected: false, queued: 3, latest: {id: 'm', text: 'the house!!!!', state: 'sent', sentAt: now - 14_000}});
  assert.match(stuck, /Not picked up yet \(14 s\) · 3 waiting/);
  assert.match(at({...base, queued: 2, latest: {id: 'm', text: 'x', state: 'delivered', sentAt: now - 60_000}}), /Picked up · 2 waiting/);
  const done = at({...base, queued: 0, latest: {id: 'm', text: 'go to the cottage', state: 'acknowledged', reply: 'Got it: walking there.', result: 'Arrived.', outcome: 'done', sentAt: now - 90_000}});
  assert.match(done, />Done</); assert.ok(done.indexOf('Got it: walking there.') < done.indexOf('Arrived.'), 'the ack reply, then the result');
  assert.match(at({...base, latest: {id: 'm', text: 'ride', state: 'acknowledged', reply: 'Trying.', result: "Couldn't: no saddle.", outcome: 'failed'}}), /Could not do it/);
  assert.match(at({connected: true, lastSeenAt: now}), /seen recently/, 'an older server without presence: connected means seen recently');
});
test('Soul card inbox belongs only to its authenticated owner, including account switch', () => {
  const soul = {id: 's_A', entityId: 'h_A', name: 'Ana', description: '', doing: '', energy: 'fine'};
  const sim = {me: {userId: 'acct_A', souls: ['s_A'], role: 'user', invited: true}, privateAuthorityGeneration: 1, conn: {welcome: {worldId: 'inbox-1', epoch: 1}, replica: {souls: new Map([['s_A', soul]]), entities: {}, tick: 0}}, plays: [], talk: []};
  for (const identity of ['acct_A', 'acct_B', null]) {
    const auth = {authed: !!identity, ready: true, label: identity, debug: {accountIdentity: identity, privyUserId: null}, login() {}, logout() {}};
    const html = render(h(SoulFocus, {sim, auth, api: async () => {throw Error('Rendering must not request');}, selected: 's_A', select() {}, manage() {}}));
    assert.equal(html.includes('data-agent-message="soul"'), identity === 'acct_A');
  }
});
// G4: the God box is the God modal's agent section now (the God button watches the owner's inbox while the world's status
// says owner). Signing out resets the status even when the provider keeps the same label, so the owner view and the
// command log go away with it.
test('God box disappears on sign-out even if the provider retains the same label', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ok: true, status: 200, json: async () => String(url).includes('/v1/god/inbox')
    ? {inbox: {connected: true, lastSeenAt: 1, latest: null, queued: 1, log: [{id: 'm1', text: 'Build a barn', state: 'sent', sentAt: 1}]}}
    : {you: 'owner', pending: [], agents: 1}});
  const until = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(ok()); };
  const session = {mode: 'dev', ready: true, authed: true, label: 'same-label', getToken: async () => 'dev:same-label', login() {}, logout() {}};
  publishSession(session);
  const seen = []; const stopStatus = watchStatus((s) => seen.push(s?.you ?? null));
  try {
    await until(() => seen.at(-1) === 'owner');
    const stopInbox = watchInbox();   // what GodButton does while the status says owner
    await until(() => godState().inbox?.log?.length === 1);
    publishSession({...session, authed: false});
    assert.equal(seen.at(-1), null);   // the owner status is gone at once, same label or not
    stopInbox();                      // GodButton stops watching when owner turns false
    assert.equal(godState().inbox, null);
  } finally { stopStatus(); globalThis.fetch = realFetch; }
});
test.after(() => rm(dir, {recursive: true, force: true}));

// Lane PAIR-INWINDOW (Gene's review 2026-10-22 #1): the card's start prompt carries the window code like the New Soul prompt
test('Soul card start prompt names pair-soul with the window code; without a code it still names the command', () => {
  const withCode = soulStartPrompt('http://localhost:5960/w/inbox', 's_abc', 'Ada', 'K7QX-M2PA');
  assert.match(withCode, /pair-soul "s_abc" "Ada" --for K7QX-M2PA/);
  assert.match(withCode, /open Sim window/);
  assert.match(withCode, /approval wait/);
  assert.match(withCode, /Do not create another Soul/);
  const plain = soulStartPrompt('http://localhost:5960/w/inbox', 's_abc', 'Ada', null);
  assert.match(plain, /pair-soul "s_abc" "Ada" \(/);
  assert.doesNotMatch(plain, /--for/);
});
