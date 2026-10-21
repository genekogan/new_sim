// node --test apps/web/src/visitor-counts-pairing.test.ts
// Fixup 2026-10-21: three live Soul approvals counted "soul paired" once: (A) the new worlds' card (/worlds eden-2026,
// GodPanel) never counted, (B) the older worlds' card (Mars, #approve link) and (C) /w/eden by a window code counted only
// when the card had seen the request waiting. Now the card where Approve was pressed counts its approval once, when the
// server took it (pairingTaken + countPairing, god-ui/ApprovalDialog.tsx). Also: "enter world <slug>" on an older world,
// with no card (#advanced) or a tab hidden through the arrival. Own file: the arrival marks are one per process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalMark } from './arrival-marks.ts';

/** A fresh module copy on a fake public page, its count requests captured (the stub endpoint). */
async function page(href: string, tag: string) {
  const sent: string[] = [], u = new URL(href);
  Object.assign(globalThis, {
    location: { hostname: u.hostname, search: u.search, pathname: u.pathname, origin: u.origin, href },
    document: { referrer: '' }, screen: { width: 1440 }, localStorage: { getItem: () => null },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { webdriver: false, sendBeacon: (url: string) => { sent.push(url); return true; } } });
  const m = await import(`./visitor-counts.ts?${tag}`) as typeof import('./visitor-counts.ts');
  const events = () => sent.map((s) => new URL(s)).filter((x) => x.searchParams.get('e') === 'true').map((x) => x.searchParams.get('p'));
  return { m, sent, events };
}

/** One approval card as ApprovalDialog.tsx runs it: the statuses it is shown, Approve pressed (or not) before `pressAt`. */
function card(m: typeof import('./visitor-counts.ts'), id: string, statuses: string[], pressAt: number | null) {
  let pressed = false;
  statuses.forEach((st, i) => { if (pressAt !== null && i >= pressAt) pressed = true; if (m.pairingTaken(pressed, st)) m.countPairing(id); });
}

test('A: the new worlds card (/worlds eden-2026) counts one pairing per approval, through creating and ready', async () => {
  const p = await page('https://sim.eden.art/worlds/w/eden-2026/', 'A');
  card(p.m, 'ap_A', ['pending', 'creating', 'creating', 'ready'], 1);
  card(p.m, 'ap_A', ['ready'], 0);                         // the same approval seen again (another dialog, a re-render)
  assert.deepEqual(p.events(), ['soul paired']);
  assert.doesNotMatch(p.sent.join(' '), /ap_A/);           // never an id in a count
});

test('B: the older worlds card from an #approve link (Mars) counts, even when the approve answer is already ready', async () => {
  const p = await page('https://sim.eden.art/w/mars/', 'B');
  card(p.m, 'ap_B', ['pending', 'ready'], 1);
  assert.deepEqual(p.events(), ['soul paired']);
});

test('C: /w/eden by a window code counts once; a window that only watched it turn ready, or a refusal, does not', async () => {
  const p = await page('https://sim.eden.art/w/eden/', 'C');
  card(p.m, 'ap_C', ['pending', 'pending', 'creating', 'ready'], 2);
  const other = await page('https://sim.eden.art/w/eden/', 'C-watcher');
  card(other.m, 'ap_C', ['pending', 'creating', 'ready'], null);   // the same approval answered in another tab
  card(other.m, 'ap_R', ['pending', 'refused'], 1);                // approved, then refused by the server
  card(other.m, 'ap_X', ['pending', 'cancelled'], null);           // Refuse pressed
  assert.deepEqual(p.events(), ['soul paired']);
  assert.deepEqual(other.events(), []);
});

test('three approvals A, B, C in one browser session: three counts; the older pair-code page counts by its code once', async () => {
  const p = await page('https://sim.eden.art/worlds/w/eden-2026/', 'ABC');
  card(p.m, 'ap_1', ['pending', 'creating', 'ready'], 1);
  card(p.m, 'ap_2', ['pending', 'ready'], 1);
  card(p.m, 'ap_3', ['pending', 'creating'], 1);           // closed before the body was ready: the approval still counts
  p.m.countPairing('pair:ABCD-EFGH'); p.m.countPairing('pair:ABCD-EFGH');
  assert.deepEqual(p.events(), ['soul paired', 'soul paired', 'soul paired', 'soul paired']);
});

test('enter world on an older world: waits through a hidden arrival, counts on the first live frame with no card, once', async () => {
  const p = await page('https://sim.eden.art/w/eden/#advanced', 'enter');
  p.m.countPage('');
  const tick = () => new Promise((r) => setImmediate(r));
  await tick();
  assert.equal(p.sent.length, 1); assert.equal(new URL(p.sent[0]!).searchParams.get('p'), '/w/eden');
  assert.deepEqual(p.events(), []);                        // hidden tab: no frame drawn, no card gone, nothing yet
  arrivalMark('first-live-frame'); await tick();
  assert.deepEqual(p.events(), ['enter world eden']);
  arrivalMark('card-done'); await tick();                  // the card going later counts nothing more
  assert.deepEqual(p.events(), ['enter world eden']);
});
