#!/usr/bin/env python3
"""Consistent online copy of a live WAL SQLite DB, read-only on the source.
Uses the SQLite backup API in ONE step (pages=-1): a single read snapshot, so
concurrent writers are never blocked and the copy never restarts.
usage: online-backup.py SRC DST"""
import sqlite3, sys, os, time
src, dst = sys.argv[1], sys.argv[2]
tmp = dst + '.part'
for p in (tmp, tmp + '-wal', tmp + '-shm'):
    if os.path.exists(p): os.remove(p)
t = time.time()
s = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
d = sqlite3.connect(tmp)
s.backup(d, pages=-1)
d.execute('PRAGMA journal_mode=DELETE')  # self-contained single file
d.close(); s.close()
os.replace(tmp, dst)
print(f'{src} -> {dst} {os.path.getsize(dst)} bytes in {time.time()-t:.1f}s')
