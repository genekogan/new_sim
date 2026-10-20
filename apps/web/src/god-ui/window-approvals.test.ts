import test from 'node:test';
import assert from 'node:assert/strict';
import type { Approval } from './join-api.ts';
(globalThis as { location?: unknown }).location ??= { href: 'http://127.0.0.1/w/test', pathname: '/w/test', hash: '', origin: 'http://127.0.0.1' };
const { approvalLine, preparingLine, closeApproval, closedApprovals, pickWindowApproval, safePhoto } = await import('./window-approvals.ts');

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const ap = (status: Approval['status'], extra: Partial<Approval> = {}): Approval => ({ id: 'ap_' + 'a'.repeat(32), worldId: 'w', agentLabel: 'Claude Code', name: 'Ana', description: '', mode: 'create', status, soulId: null, expiresAt: 0, ...extra });

test('the window shows the newest pending request it has not closed', () => {
  const list = [{ id: 'ap_new', status: 'pending' as const }, { id: 'ap_old', status: 'pending' as const }];
  assert.equal(pickWindowApproval(list, new Set()), 'ap_new');
  assert.equal(pickWindowApproval(list, new Set(['ap_new'])), 'ap_old');
  assert.equal(pickWindowApproval([{ id: 'ap_x', status: 'creating' }], new Set()), null);
  assert.equal(pickWindowApproval([], new Set()), null);
});

test('a closed request stays closed in this tab, and the list stays short', () => {
  const s = memory();
  assert.deepEqual([...closedApprovals(s)], []);
  closeApproval('ap_1', s); closeApproval('ap_2', s);
  assert.deepEqual([...closedApprovals(s)], ['ap_1', 'ap_2']);
  for (let i = 0; i < 30; i++) closeApproval('ap_n' + i, s);
  assert.equal(closedApprovals(s).size, 20);
  assert.ok(closedApprovals(s).has('ap_n29'));
  assert.deepEqual([...closedApprovals({ getItem: () => '{bad json' })], []);
  assert.deepEqual([...closedApprovals(null)], []);
});

test('the card says little: one short line per state, the arrival refusal says why', () => {
  assert.equal(approvalLine(null, false), null);
  assert.equal(approvalLine(ap('pending'), false), null);
  assert.equal(approvalLine(ap('creating'), false), null);
  assert.equal(approvalLine(ap('ready'), false), null);
  assert.equal(approvalLine(ap('cancelled'), true), 'Refused');
  assert.equal(approvalLine(ap('cancelled'), false), 'Withdrawn by the agent');
  assert.equal(approvalLine(ap('expired'), false), 'Timed out');
  assert.equal(approvalLine(ap('refused', { reason: { code: 'arrival-unavailable', message: 'Approved, but the Soul could not arrive: a long text for the agent' } }), false), 'No clear ground at the arrival point. Nothing was created.');
  assert.equal(approvalLine(ap('refused'), false), 'The body could not be made. Nothing was created.');
  assert.equal(preparingLine({ name: 'Mira', mode: 'create' }), 'Mira is being prepared by your agent. Please wait…');
  for (const s of ['pending', 'creating', 'ready', 'cancelled', 'expired', 'refused'] as const) assert.doesNotMatch(approvalLine(ap(s), false) ?? '', /Connected|folder|approval wait|label/);
});

test('the Soul picture comes only from this site or https', () => {
  assert.equal(safePhoto('https://assets.eden.art/p.webp'), 'https://assets.eden.art/p.webp');
  assert.equal(safePhoto('/worlds/w/x/media/p.png'), '/worlds/w/x/media/p.png');
  for (const bad of ['javascript:alert(1)', '//evil.test/p.png', 'http://x.test/p.png', 'data:image/png;base64,AA', null, undefined, '']) assert.equal(safePhoto(bad as string | null | undefined), null);
});
