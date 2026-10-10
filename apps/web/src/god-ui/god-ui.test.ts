// node --test apps/web/src/god-ui/god-ui.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { commandText, parseMarkdown } from './md-parse.ts';
import { describeEdit, isBuild, steps } from './checklist.ts';
import type { EditRow, Status } from './god-api.ts';

const WELCOME = `# You are the god of Willow

Your agent builds this world through **god mode**:
it reads the whole world.

## Pair your agent (once per folder)

\`\`\`
mkdir willow-god && cd $_
node eden-god.mjs pair        # prints a code; approve it on this page
\`\`\`

- one
- two
  continued
1. first
2. second
---
`;

test('markdown: headings, paragraphs joined, code fences kept verbatim, lists, rules', () => {
  const b = parseMarkdown(WELCOME);
  assert.deepEqual(b.map((x) => x.kind), ['h', 'p', 'h', 'code', 'ul', 'ol', 'hr']);
  assert.deepEqual(b[0], { kind: 'h', level: 1, text: 'You are the god of Willow' });
  assert.equal((b[1] as { text: string }).text, 'Your agent builds this world through **god mode**: it reads the whole world.');
  assert.match((b[3] as { text: string }).text, /^mkdir willow-god && cd \$_\nnode eden-god.mjs pair {8}# prints/);
  assert.deepEqual((b[4] as { items: string[] }).items, ['one', 'two continued']);
  assert.deepEqual((b[5] as { items: string[] }).items, ['first', 'second']);
});
test('copy buttons copy commands without trailing comments', () => {
  assert.equal(commandText('mkdir a && cd $_\nnode eden-god.mjs pair        # prints a code\n\n'), 'mkdir a && cd $_\nnode eden-god.mjs pair');
  assert.equal(commandText('echo "#not a comment"'), 'echo "#not a comment"');
});

const st = (you: Status['you'], extra: Partial<Status> = {}): Status => ({ worldId: 'w-1', name: 'W', hasOwner: you !== 'claimant' && you !== 'anonymous', you, pending: [], entities: 0, seq: 0, base: '', ...extra });
const edit = (seq: number, note: string | null, ops: EditRow['ops'], kind: EditRow['kind'] = 'edit'): EditRow => ({ seq, by: 'god', at: 0, note, grp: null, ops, undone: 0, undo_of: null, kind });

test('first steps tick from evidence', () => {
  const none = steps({ status: st('anonymous'), signedIn: false, edits: null, flags: 0, approvedHere: false, agentSeen: false, looks: 0 });
  assert.deepEqual(none.map((s) => s.done), [false, false, false, false, false, false]);
  const genesisOnly = [edit(1, 'genesis 1/2: terrain', [{ op: 'place', def: 'core/knoll@1' }]), edit(2, 'flag from the website', [{ op: 'place', def: 'core/flag@1' }])];
  const mid = steps({ status: st('owner'), signedIn: true, edits: genesisOnly, flags: 2, approvedHere: false, agentSeen: true, looks: 0 });
  assert.deepEqual(mid.map((s) => [s.id, s.done]), [['signin', true], ['claim', true], ['pair', true], ['flag', true], ['build', false], ['look', false]]);
  const all = steps({ status: st('owner', { agents: 1 }), signedIn: true, edits: [...genesisOnly, edit(3, null, [{ op: 'place', def: 'core/cottage@1', name: 'home' }])], flags: 1, approvedHere: false, agentSeen: false, looks: 1 });
  assert.ok(all.every((s) => s.done));
  assert.equal(isBuild(edit(4, 'undo of 3', [{ op: 'remove' }], 'undo')), false);
  // what a hello-hamlet world really journals: a world-state edit and two genesis-grouped batches, no notes
  const hamlet: EditRow[] = [{ ...edit(1, null, [{ op: 'world' }]) }, { ...edit(2, null, [{ op: 'place', def: 'core/knoll@1' }]), grp: 'genesis' }, { ...edit(3, null, [{ op: 'place', def: 'core/cottage@1' }]), grp: 'genesis' }];
  assert.equal(hamlet.some(isBuild), false);
});
test('edits read as one line', () => {
  assert.equal(describeEdit(edit(5, null, [{ op: 'place', name: 'a' }, { op: 'place', name: 'b' }, { op: 'move', id: 'c' }])), 'place ×2, move a, b, c');
  assert.equal(describeEdit(edit(6, 'a village', [])), 'a village');
  assert.equal(describeEdit({ ...edit(7, 'undo of 5', [], 'undo') }), 'undo of 5');
});
