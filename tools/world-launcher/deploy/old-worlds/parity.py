#!/usr/bin/env python3
"""Parity facts of an old-world sim.db (read-only). Same script on the laptop and on eden2.
usage: parity.py DB WORLD_ID [UPTO_SEQ]  -> one JSON line (prefixSHA256 = events with seq <= UPTO_SEQ)"""
import sqlite3, sys, json, hashlib
db, wid = sys.argv[1], sys.argv[2]
c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
q = lambda s, *a: c.execute(s, a).fetchone()
def n(table, where=''):
    try: return q(f'SELECT count(*) FROM {table} {where}')[0]
    except sqlite3.OperationalError: return None
souls = c.execute('SELECT id,entity_id,retired_at FROM souls WHERE world_id=? ORDER BY id', (wid,)).fetchall()
out = {
  'worldId': wid,
  'events': q('SELECT count(*) FROM events WHERE world_id=?', wid)[0],
  'maxSeq': q('SELECT max(seq) FROM events WHERE world_id=?', wid)[0],
  'souls': len(souls), 'liveSouls': sum(1 for s in souls if s[2] is None),
  'soulsSHA256': hashlib.sha256(json.dumps(souls).encode()).hexdigest()[:16],
  'conversations': n('edge_comms_conversations'), 'turns': n('edge_comms_turns'), 'speech': n('edge_comms_speech'),
  'accounts': n('account_identities_v1'), 'snapshots': n('snapshots'),
}
upto = int(sys.argv[3]) if len(sys.argv) > 3 else out['maxSeq']
h = hashlib.sha256()
for r in c.execute('SELECT seq,tick,kind,author,payload,at FROM events WHERE world_id=? AND seq<=? ORDER BY seq', (wid, upto)): h.update(json.dumps(r).encode())
out['prefixUpTo'] = upto; out['prefixSHA256'] = h.hexdigest()[:16]
print(json.dumps(out))
