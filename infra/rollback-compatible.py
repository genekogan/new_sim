"""Read-only state compatibility check before a code rollback."""
import pathlib
import sqlite3
import sys

release = pathlib.Path(sys.argv[1])
if not (release / 'apps/server/src/mandate.ts').exists():
    for filename in sys.argv[2:] or ['/srv/sim-data/sim.db', '/srv/sim-data/mars/sim.db']:
        path = pathlib.Path(filename)
        if not path.exists():
            continue
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
            if db.execute("SELECT 1 FROM events WHERE kind='mandate' LIMIT 1").fetchone():
                sys.exit('Rollback refused: this database has private mandate events; choose a mandate-capable release. Data and services unchanged.')
