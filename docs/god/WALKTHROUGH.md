# God mode in ten minutes — the meetup script

A world from nothing, on one laptop, in front of an audience: create it from the
homepage, claim it, pair an agent, and let the agent build while people watch.
Everything runs locally with fake Soul minds; nothing costs model money except
the agent you bring.

Commands marked **(R1)** use vocabulary that lands with the R1 release (buildings
`building/1` from L2, `road/river/bridge` from L3, `look`/`export` from L7). On
a build without them, skip that beat; the rest of the script stands on its own.
`tools/god-skill/e2e/launcher.mjs` replays beats 1–5 and 8 automatically.

## Before the talk (5 minutes, off stage)

```
cd <repo>                                   # or the worktree you are demoing
pnpm --filter @sim/web build                    # the web app the launcher serves
node tools/world-launcher/launcher.mjs          # http://127.0.0.1:4980 ; worlds on 5101–5149
```

- Open `http://127.0.0.1:4980/` full screen in a browser. Zoom to 110 % so the
  back row can read the panel.
- In a second window, a terminal in an empty folder (`mkdir ~/demo && cd ~/demo`)
  with your agent (Claude Code, Codex) ready but not yet started.
- Optional rehearsal: `node tools/god-skill/e2e/launcher.mjs` runs the whole
  flow on its own launcher (:5149) in a few minutes and leaves screenshots in
  `.lane/e2e-launcher/<stamp>/`.

## 0:00 — the homepage

**Do:** show `http://127.0.0.1:4980/`.
**They see:** “Sim — worlds on this computer”, a card per world (name, template,
how many things, *god: claimed / unclaimed*, awake/asleep), and **New world**.

> Say: every world here is a separate running server. Each has exactly one god —
> the owner's agent — and Souls who live in it.

## 0:30 — New world

**Do:** click **New world**, type `Willow Hollow`, pick **Hello hamlet** (or
**Empty plain** for the brave), **Create world**.
**They see:** the dialog shows where it will live (`/w/willow-hollow`), then
“Starting the world… 12s”. The launcher starts a world process, builds the
template through the same validated edits an agent uses, and opens it: a knoll,
a cottage facing a pond, two flags. The god panel says *Your new world is ready.*

## 1:30 — sign in and claim

**Do:** **Sign in** → type `gene` → **Become its god**.
**They see:** the panel turns into god mode: *First steps 2/6* ticked (signed
in, claimed), the welcome text with copy buttons on each command block.

> Say: whoever claims an unowned world first becomes its god. Now the agent.

## 2:00 — pair the agent

**Do:** click **copy** on the first command block in the panel; paste it into
the terminal (it creates a folder, downloads the CLI and the skill):

```
mkdir willow-hollow-god && cd $_
curl -sO http://127.0.0.1:4980/w/willow-hollow/god/eden-god.mjs && curl -sO http://127.0.0.1:4980/w/willow-hollow/god/SKILL.md
node eden-god.mjs register http://127.0.0.1:4980/w/willow-hollow
node eden-god.mjs pair
```

**They see:** the terminal prints a code (`ABCD-EFGH`) and a link; within four
seconds the same code appears in the panel in a yellow box, *Your agent asks to
be this world's god*. Click **Approve**. The terminal prints `"paired": true`;
the checklist ticks *Pair your agent*.

## 3:00 — flags

**Do:** **⚑ Drop a flag**, click the ground east of the cottage, label it `market`.
**They see:** a flag drops in; the **Flags** tab lists `market`, `plaza`,
`orchard`; clicking one flies the camera there. Your agent can now say
`--at flag:market`.

## 3:30 — the agent builds (start the agent here)

**Do:** start your agent in the folder: *“Read SKILL.md. You are the god of this
world. Put a low ridge of hills along the north edge and a lake in the west.”*
Equivalent commands, if you would rather type:

```
node eden-god.mjs terrain mountain --path '[[-300,-380],[300,-380]]' --width 160 --param height=60
node eden-god.mjs terrain lake --area '[[-320,-40],[-240,-90],[-200,10],[-280,60]]'
```

**They see:** hills rise along the horizon, water fills a carved bed. The
**Edits** tab gets a row per batch, with the agent's note.

## 4:30 — a village (R1 for real houses)

*“A little market square at the market flag: a plaza, three houses with doors
facing it, a lamp and a bench.”* With R1 the houses are `building/1` (rooms,
doors, stairs); before it, `core/cottage@1`:

```
node eden-god.mjs act '{"group":"market","note":"a market square","ops":[
  {"op":"place","def":"core/cottage@1","name":"bakery","p":[70,0]},
  {"op":"place","def":"core/cottage@1","name":"smithy","p":[90,16]},
  {"op":"place","def":"core/bench@1","name":"market-bench","p":[78,12]}]}'
```

**They see:** the houses ease in from the sky; the Edits row is tagged `market`.

## 5:30 — inside a house (R1)

*“Furnish the bakery: a table with a bowl, two chairs, a bed upstairs.”* Then
fly the camera in through the door (drag/scroll) to show the rooms.

## 6:30 — river and bridge (R1)

*“A river from the hills to the lake, and a bridge where the lane crosses it.”*

```
node eden-god.mjs terrain river --path '[[-60,-360],[-120,-200],[-210,-40]]' --width 8
node eden-god.mjs place bridge --at -120,-200 --yaw 0.6
```

**They see:** a channel carves, water runs, the bridge spans it.

## 7:30 — preview before building

*“Show me where you would put an orchard before you do it.”* The agent runs a
dry run that the world keeps for ten minutes:

```
node eden-god.mjs preview '{"ops":[{"op":"place","def":"core/cottage@1","name":"guest-house","p":[-8,24]}]}'   # (R1 CLI verb; today: POST /v1/god/preview)
```

**They see:** the panel's **Previews** tab lists it; **show** draws it as a
translucent green ghost (amber for things that would move, red for removals,
blue sheets where the ground would change), with a bar *Preview pv_… — +1 new —
not built*. To see the same ghost in a browser, open the full link the CLI
prints (it carries a 10-minute view key); a bare `?preview=<id>` needs this
world's god token.

## 8:30 — look, undo

**Do:** `node eden-god.mjs look --from flag:plaza` **(R1)** — the agent gets a
screenshot of what it built (it ticks *First look*). Then in the panel: **↶ Undo**
(the last batch lifts away), **↷ Redo** (it comes back), and **undo group** on
the `market` row (the whole square goes in one click).

## 9:30 — it keeps running; export

**Do:** in the terminal `kill -9` the world's process
(`curl -s localhost:4980/__sim/launcher` shows its pid).
**They see:** the page reconnects after a few seconds; everything is still there
— the launcher restarted the world from its journal. `node eden-god.mjs export
> willow.json` **(R1)** writes the world as a genesis template another launcher
can start from.

## If something goes wrong on stage

| Symptom | Fix |
|---|---|
| “Starting the world…” passes 60 s | the machine is busy; wait, or open `/__sim/launcher` to see the child's status; logs in `.lane/launcher/logs/<slug>.log` |
| the pairing code never shows in the panel | the panel polls every 4 s; check the terminal printed a link to *this* world; `node eden-god.mjs pair` again (codes last 15 minutes) |
| “Could not claim” | another name already claimed it; sign in with that name, or make a new world |
| a flag is refused | sign in as the owner first; flags need god mode |
| the page is blank | `pnpm --filter @sim/web build`, then reload |
