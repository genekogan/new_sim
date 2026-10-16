#!/usr/bin/env python3
"""Content hash of a SQLite DB (read-only): sha256 over every table's rows in a stable order + the schema.
usage: dbhash.py DB  -> one JSON line {"sha256":..., "tables":{name:rows}}. Used for the accounts registry."""
import sqlite3, sys, json, hashlib
c = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
h = hashlib.sha256(); tables = {}
for name, sql in c.execute("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL ORDER BY type, name"):
    h.update(sql.encode())
for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall():
    rows = sorted(json.dumps([name] + [v.hex() if isinstance(v, bytes) else v for v in r]) for r in c.execute(f'SELECT * FROM "{name}"'))
    for r in rows: h.update(r.encode())
    tables[name] = len(rows)
print(json.dumps({'sha256': h.hexdigest(), 'tables': tables}))
