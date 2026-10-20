import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioFocus } from './audio-focus.ts';

type Fn = (e?: unknown) => void;
const target = () => { const on = new Map<string, Set<Fn>>(); return { addEventListener: (t: string, f: Fn) => { if (!on.has(t)) on.set(t, new Set()); on.get(t)!.add(f); }, removeEventListener: (t: string, f: Fn) => void on.get(t)?.delete(f), fire: (t: string) => { for (const f of on.get(t) ?? []) f(); } }; };
/** Tabs of one site: a shared BroadcastChannel bus (a message never reaches its sender), each tab its own document. */
function site() {
  const chans = new Set<{ onmessage: ((e: { data: unknown }) => void) | null }>();
  const tab = (id: string, hidden = false) => {
    const doc = Object.assign(target(), { hidden }), win = target();
    const ch = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage(m: unknown) { for (const c of chans) if (c !== ch) c.onmessage?.({ data: m }); }, close() { chans.delete(ch); } };
    chans.add(ch);
    const focus = createAudioFocus({ doc: doc as never, win: win as never, channel: ch as never, id });
    return { focus, doc, win, hide(v: boolean) { doc.hidden = v; doc.fire('visibilitychange'); } };
  };
  return { tab };
}

test('a second world tab takes the sound; the first goes silent', () => {
  const s = site(), a = s.tab('a');
  assert.equal(a.focus.audible(), true);
  const b = s.tab('b');
  assert.equal(b.focus.audible(), true);
  assert.equal(a.focus.audible(), false);
});

test('the last focused or touched tab owns the sound; a hidden tab never sounds', () => {
  const s = site(), a = s.tab('a'), b = s.tab('b');
  let changes = 0; a.focus.subscribe(() => changes++);
  a.win.fire('pointerdown');
  assert.deepEqual([a.focus.audible(), b.focus.audible()], [true, false]);
  assert.ok(changes >= 1);
  b.win.fire('focus');
  assert.deepEqual([a.focus.audible(), b.focus.audible()], [false, true]);
  b.hide(true);
  assert.equal(b.focus.audible(), false);                 // switched away: silent, still the owner
  assert.equal(b.focus.owner(), true);
  a.hide(true); a.hide(false);                             // back to a: it takes the sound
  assert.deepEqual([a.focus.audible(), b.focus.audible()], [true, false]);
});

test('a tab that loads hidden waits; closing the sounding tab hands the sound to a visible one', () => {
  const s = site(), a = s.tab('a'), b = s.tab('b', true);
  assert.deepEqual([a.focus.audible(), b.focus.audible()], [true, false]);
  const c = s.tab('c');
  assert.equal(a.focus.audible(), false);
  c.win.fire('pagehide');
  assert.equal(a.focus.audible(), true);                   // visible, took it back
  assert.equal(b.focus.audible(), false);                  // hidden, stays silent
});
