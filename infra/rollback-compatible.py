"""Read-only state compatibility check before a code rollback."""
import json
import pathlib
import sqlite3
import sys

release = pathlib.Path(sys.argv[1])
if not (release / 'apps/server/src/mandate.ts').exists():
    for filename in sys.argv[2:] or ['/srv/sim-data/sim.db', '/srv/sim-data/mars/sim.db','/srv/sim-data/littlemartians/sim.db','/srv/sim-data/eden/sim.db']:
        path = pathlib.Path(filename)
        if not path.exists():
            continue
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
            if db.execute("SELECT 1 FROM events WHERE kind='mandate' LIMIT 1").fetchone():
                sys.exit('Rollback refused: this database has private mandate events; choose a mandate-capable release. Data and services unchanged.')

if not (release / 'packages/engine-mars/src/construction.ts').exists():
    for filename in sys.argv[2:] or ['/srv/sim-data/sim.db', '/srv/sim-data/mars/sim.db','/srv/sim-data/littlemartians/sim.db','/srv/sim-data/eden/sim.db']:
        path = pathlib.Path(filename)
        if not path.exists():
            continue
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
            for (payload,) in db.execute("SELECT payload FROM events WHERE kind IN ('mint','decision') AND payload LIKE '%build_lookout%'"):
                event = json.loads(payload)
                card = event.get('card')
                steps = event.get('steps', []) + (card.get('approach', []) + card.get('during', []) if isinstance(card, dict) else [])
                if any(step.get('verb') == 'build_lookout' for step in steps):
                    sys.exit('Rollback refused: this database contains construction cards/decisions; choose a construction-controller release. Data and services unchanged.')
