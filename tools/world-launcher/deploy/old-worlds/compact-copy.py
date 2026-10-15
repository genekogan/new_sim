#!/usr/bin/env python3
"""Compact, consistent, read-only copy of a live old-world SQLite DB, without the dead recordings.

usage: compact-copy.py SRC DST [--keep-takes]

Why: Eden's sim.db is ~23 GB, >99% `take_chunks` (pose-keyframe cache; Gene 2026-10-11: recordings off by default,
all stored ones deleted; the 1080cfa9 servers neither write nor read them with TAKES_PERSIST unset). A whole-file
backup (or VACUUM INTO, which also copies every page) would write 23 GB on a laptop with ~45 GB free. This writes
only the live data (~150 MB).

How: ONE read transaction on SRC (opened mode=ro, never written; concurrent writers are never blocked), the exact
schema recreated in DST (same CREATE statements, page size, user_version, application_id), every row of every table
copied with its rowid, except take_chunks / take_archives rows (tables kept, empty). Before commit, inside the same
snapshot, every copied table is compared row by row (count + SHA-256 in rowid / primary-key order); take_chunks is
reported from SRC by count and max(to_tick) only. Result = what `online-backup.py` + `tools/ops/drop-recordings.mjs`
+ VACUUM would give, logically. DST is written to DST.part then renamed. Prints one JSON line.
"""
import sqlite3, sys, os, time, json, hashlib

DROP = {'take_chunks', 'take_archives'}


def rowhash(con, schema, table, cols, order):
    h = hashlib.sha256(); n = 0
    q = f'SELECT {cols} FROM {schema}."{table}" ORDER BY {order}'
    for r in con.execute(q):
        h.update(json.dumps([v.hex() if isinstance(v, bytes) else v for v in r]).encode()); n += 1
    return n, h.hexdigest()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    keep = '--keep-takes' in sys.argv
    if len(args) != 2: sys.exit(__doc__)
    src, dst = args
    drop = set() if keep else DROP
    tmp = dst + '.part'
    for p in (tmp, tmp + '-journal', tmp + '-wal', tmp + '-shm'):
        if os.path.exists(p): os.remove(p)
    t0 = time.time()
    con = sqlite3.connect(tmp, uri=True, isolation_level=None)
    con.execute("ATTACH ? AS s", (f'file:{os.path.abspath(src)}?mode=ro',))
    page = con.execute('PRAGMA s.page_size').fetchone()[0]
    con.execute(f'PRAGMA main.page_size={int(page)}')
    con.execute('PRAGMA main.journal_mode=DELETE')
    con.execute('BEGIN')  # one transaction: the read snapshot of s and the whole write of main
    objs = con.execute("SELECT type,name,tbl_name,sql FROM s.sqlite_master ORDER BY rowid").fetchall()
    bad = [o for o in objs if o[0] in ('view', 'trigger') or (o[3] or '').upper().startswith('CREATE VIRTUAL')]
    if bad: raise SystemExit(f'unsupported schema objects: {[o[1] for o in bad]}')
    tables = [o for o in objs if o[0] == 'table' and not o[1].startswith('sqlite_')]
    for _, name, _, sql in tables: con.execute(sql)
    report = {'src': src, 'dst': dst, 'tables': {}, 'dropped': {}}
    for _, name, _, sql in tables:
        info = con.execute(f'PRAGMA s.table_xinfo("{name}")').fetchall()
        if any(r[6] not in (0,) for r in info): raise SystemExit(f'hidden/generated columns in {name}')
        cols = ','.join(f'"{r[1]}"' for r in info)
        without_rowid = 'WITHOUT ROWID' in sql.upper()
        if name in drop:
            n, mx = con.execute(f'SELECT count(*), max(to_tick) FROM s."{name}"').fetchone() if name == 'take_chunks' \
                else (con.execute(f'SELECT count(*) FROM s."{name}"').fetchone()[0], None)
            report['dropped'][name] = {'rows': n, 'maxToTick': mx}
            continue
        if without_rowid:
            pk = [r[1] for r in sorted((r for r in info if r[5]), key=lambda r: r[5])]
            order = ','.join(f'"{c}"' for c in pk); sel = cols
            con.execute(f'INSERT INTO main."{name}" ({cols}) SELECT {cols} FROM s."{name}"')
        elif sum(1 for r in info if r[5]) == 1 and next(r for r in info if r[5])[2].upper() == 'INTEGER':
            order = 'rowid'; sel = cols  # INTEGER PRIMARY KEY is the rowid
            con.execute(f'INSERT INTO main."{name}" ({cols}) SELECT {cols} FROM s."{name}"')
        else:
            order = 'rowid'; sel = 'rowid,' + cols
            con.execute(f'INSERT INTO main."{name}" (rowid,{cols}) SELECT rowid,{cols} FROM s."{name}"')
        a = rowhash(con, 's', name, sel, order); b = rowhash(con, 'main', name, sel, order)
        if a != b: raise SystemExit(f'copy mismatch in {name}: {a} vs {b}')
        report['tables'][name] = a[0]
    if any(o[1] == 'sqlite_sequence' for o in objs):
        con.execute('DELETE FROM main.sqlite_sequence')
        con.execute('INSERT INTO main.sqlite_sequence(name,seq) SELECT name,seq FROM s.sqlite_sequence')
        if con.execute('SELECT name,seq FROM main.sqlite_sequence ORDER BY name').fetchall() != \
           con.execute('SELECT name,seq FROM s.sqlite_sequence ORDER BY name').fetchall(): raise SystemExit('sqlite_sequence differs')
    for typ, name, _, sql in objs:
        if typ == 'index' and sql: con.execute(sql)
    for p in ('user_version', 'application_id'):
        con.execute(f'PRAGMA main.{p}={int(con.execute(f"PRAGMA s.{p}").fetchone()[0])}')
    con.execute('COMMIT')
    con.execute('DETACH s')
    ok = con.execute('PRAGMA quick_check').fetchone()[0]
    con.close()
    if ok != 'ok': raise SystemExit(f'quick_check: {ok}')
    os.replace(tmp, dst)
    report.update(bytes=os.path.getsize(dst), seconds=round(time.time() - t0, 1),
                  rowsCopied=sum(report['tables'].values()))
    del report['tables']
    print(json.dumps(report))


if __name__ == '__main__':
    main()
