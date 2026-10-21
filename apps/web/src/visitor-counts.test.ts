import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrivalMark, whenMarked } from './arrival-marks.ts';
import { countEndpoint, countUrl, countedPath, countedReferrer, localHost } from './visitor-counts.ts';

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('the count URL: simeden by default, another code or a full URL, off when asked', () => {
  assert.equal(countEndpoint(undefined), 'https://simeden.goatcounter.com/count');
  assert.equal(countEndpoint('other-site'), 'https://other-site.goatcounter.com/count');
  assert.equal(countEndpoint('http://127.0.0.1:6962/count?x=1#y'), 'http://127.0.0.1:6962/count');
  for (const off of ['', ' ', 'off', '0', 'javascript:alert(1)', 'Not A Code']) assert.equal(countEndpoint(off), null, off);
});

test('local, private and tailnet hosts are never counted; public hosts are', () => {
  for (const h of ['localhost', 'sim.localhost', 'world.test', 'mac.local', '127.0.0.1', '10.0.0.4', '192.168.1.20', '172.20.3.4',
    '169.254.1.1', '100.101.2.3', 'laptop-2.tail1234.ts.net', '[::1]', 'fd00::1', '0.0.0.0', ''])
    assert.equal(localHost(h), true, h);
  for (const h of ['sim.eden.art', 'fcbarcelona.com', '172.32.0.1', '100.128.0.1', '8.8.8.8']) assert.equal(localHost(h), false, h);
});

test('a page counts as its world slug only (or / for the world list); nothing else of the URL', () => {
  assert.equal(countedPath('/worlds/w/eden-2026/', '/worlds'), '/w/eden-2026');
  assert.equal(countedPath('/worlds/w/eden-2026/approve/abc123', '/worlds'), '/w/eden-2026');
  assert.equal(countedPath('/w/eden', ''), '/w/eden');
  assert.equal(countedPath('/worlds/', '/worlds'), '/');
  assert.equal(countedPath('/', ''), '/');
  assert.equal(countedPath('/buildings', ''), null);
  assert.equal(countedPath('/worlds/w/Bad_Slug', '/worlds'), null);
  const o = 'https://sim.eden.art';
  assert.equal(countedReferrer('https://genekogan.substack.com/p/sim?utm=x#y', o, '/worlds'), 'https://genekogan.substack.com');
  assert.equal(countedReferrer('https://sim.eden.art/worlds/w/hamlet/?pair=SECRET', o, '/worlds'), 'https://sim.eden.art/w/hamlet');
  assert.equal(countedReferrer('https://sim.eden.art/worlds/v1/agent?token=x', o, '/worlds'), '');
  assert.equal(countedReferrer('', o, ''), '');
  const u = new URL(countUrl('https://simeden.goatcounter.com/count', { path: '/w/eden-2026', title: 'eden-2026', width: 390.4 }));
  assert.deepEqual([...u.searchParams.keys()].sort(), ['p', 'rnd', 's', 't']);
  assert.equal(u.searchParams.get('s'), '390');
  assert.equal(new URL(countUrl('https://x.goatcounter.com/count', { path: 'enter world eden', event: true })).searchParams.get('e'), 'true');
});

test('whenMarked resolves on the mark (or at once after it), with no timer', async () => {
  let done = false; const p = whenMarked('t-analytics').then(() => { done = true; });
  await new Promise((r) => setImmediate(r)); assert.equal(done, false);
  arrivalMark('t-analytics'); await p; assert.equal(done, true);
  await whenMarked('t-analytics');
});

/** A fresh module copy on a fake page: what it sends. */
async function visit(href: string, opts: { webdriver?: boolean; skipgc?: boolean; tag: string }) {
  const sent: string[] = [], u = new URL(href);
  Object.assign(globalThis, {
    location: { hostname: u.hostname, search: u.search, pathname: u.pathname, origin: u.origin, href },
    document: { referrer: 'https://www.instagram.com/p/xyz/?igsh=abc' },
    screen: { width: 390 },
    localStorage: { getItem: (k: string) => (k === 'skipgc' && opts.skipgc ? 't' : null) },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { webdriver: !!opts.webdriver, sendBeacon: (url: string) => { sent.push(url); return true; } } });
  const m = await import(`./visitor-counts.ts?${opts.tag}`) as typeof import('./visitor-counts.ts');
  m.countPage('/worlds'); m.countPage('/worlds');
  return { sent, m };
}

test('a world visit sends one page view, then one enter event when the card goes; locally and under automation nothing', async () => {
  const { sent, m } = await visit('https://sim.eden.art/worlds/w/eden-2026/?soul=s_123#pair=CODE', { tag: 'public' });
  assert.equal(sent.length, 1, 'one page view (countPage twice)');
  const view = new URL(sent[0]!);
  assert.equal(view.origin + view.pathname, 'https://simeden.goatcounter.com/count');
  assert.equal(view.searchParams.get('p'), '/w/eden-2026'); assert.equal(view.searchParams.get('r'), 'https://www.instagram.com');
  assert.equal(view.searchParams.get('e'), null); assert.doesNotMatch(sent[0]!, /s_123|CODE|igsh/);
  arrivalMark('card-done'); await whenMarked('card-done'); await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 2); const enter = new URL(sent[1]!);
  assert.equal(enter.searchParams.get('p'), 'enter world eden-2026'); assert.equal(enter.searchParams.get('e'), 'true');
  m.countEvent('soul paired'); assert.equal(new URL(sent[2]!).searchParams.get('p'), 'soul paired');
  for (const [href, o] of [['http://localhost:6960/worlds/w/eden-2026/', {}], ['http://127.0.0.1:6960/worlds/w/x/', {}],
    ['https://sim.eden.art/worlds/w/eden-2026/', { webdriver: true }], ['https://sim.eden.art/worlds/w/eden-2026/?shot=1', {}],
    ['https://sim.eden.art/worlds/w/eden-2026/', { skipgc: true }]] as const) {
    const r = await visit(href, { ...o, tag: 'off' + Math.random() }); r.m.countEvent('god connected');
    assert.deepEqual(r.sent, [], href + JSON.stringify(o));
  }
});

test('wired: the page, the two pairings and the god approval count; the build default is simeden; the CSP stays open to it', () => {
  assert.match(src('./main.tsx'), /countPage\(BASE\);[^\n]*\ncreateRoot\(/);
  // the approval card counts its own pairing (fixup 2026-10-21; behaviour in visitor-counts-pairing.test.ts), the same
  // card on the new worlds (GodPanel) and the older ones (OldWorldApprovals); the older pair-code page by its code
  assert.match(src('./god-ui/ApprovalDialog.tsx'), /useEffect\(\(\) => \{ if \(pairingTaken\(pressed\.current, a\?\.status\)\) countPairing\(id\); \}, \[a\?\.status, id\]\);/);
  assert.match(src('./god-ui/ApprovalDialog.tsx'), /if \(action === 'approve'\) \{ setApproving\(true\); pressed\.current = true; \}/);
  assert.match(src('./GodPanel.tsx'), /<ApprovalDialog id=\{shownId\}/);
  assert.match(src('./OldWorldApprovals.tsx'), /<ApprovalDialog id=\{shownId\}/);
  for (const f of ['./GodPanel.tsx', './OldWorldApprovals.tsx', './god-ui/ApprovalDialog.tsx']) assert.doesNotMatch(src(f), /countEvent\('soul paired'\)|onPaired/, f);
  assert.match(src('./PairApprove.tsx'), /setOk\(true\); countPairing\('pair:'\+code\);/);
  assert.match(src('./GodPanel.tsx'), /await G\.approve\(code\); countEvent\('god connected'\);/);
  assert.match(src('../vite.config.ts'), /__SIM_GOATCOUNTER__: JSON\.stringify\(process\.env\.SIM_GOATCOUNTER \?\? 'simeden'\)/);
  // The world pages' only CSP is frame-ancestors (http.ts). A connect-src/img-src/default-src added there must allow
  // https://simeden.goatcounter.com, or no visit is counted.
  const csp = src('../../server/src/http.ts').match(/c\.header\('Content-Security-Policy', "([^"]*)"\)/)?.[1];
  assert.ok(csp !== undefined); assert.ok(!/(default|connect|img)-src/.test(csp!) || /goatcounter\.com/.test(csp!), csp);
});
