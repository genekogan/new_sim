# Feedback and returning owners

The in-world **Feedback** control works with or without sign-in. Opening it captures only the selected public
resident/place, drawn tick, camera position/target/FOV and client time; the server adds world, build, receipt ID,
server tick and receive time. The message is capped at 4,000 characters. No journals, URL, credentials or conversation
transcripts are attached automatically. A receipt means the JSONL record reached fsync.

`POST <world-path>/v1/feedback` accepts `{text,residentId?,placeId?,camera?,tick?,eventId?,clientTime?}`. Optional
context can be null when unavailable; a supplied world or build is rejected. The response is HTTP 201
`{ok:true,id,receivedAt,message:"We got it."}`. Each IP and each signed-in account may send five messages per
minute, persisted across restarts. Only a loopback reverse proxy may supply the forwarded client IP; the nearest
forwarded hop wins. The existing public proxy must append/replace client forwarding headers.

One private JSON-lines file per world lives at `<DATA_DIR>/feedback/<sha256(world-id)>.jsonl`. It retains at most
1 MiB, dropping the oldest complete records at the cap. Receipts identify retained records; this is a small feedback
inbox, not permanent archival storage. Feedback text is untrusted visitor input.

The exact world owner can read the most recent entries (maximum 100) using an authenticated browser token:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SIM_OWNER_TOKEN" \
  'http://127.0.0.1:5910/w/welcome/v1/feedback?limit=50'
```

This example is a disposable local world. Use the appropriate world URL when operating an authorized deployment;
never paste a token into a report. Anonymous users, another owner and a global admin who does not own this world
cannot read the inbox. `Cache-Control: no-store` applies to feedback and owner-return APIs.

Signed-in visitors get **Since your last visit**, with an automatic **While you were away** panel on return.
It combines the selected world and the site's registered root/launcher worlds where they own a resident or the
world. Discovery accepts only exact same-origin `/w/<slug>` or `/worlds/w/<slug>` routes, caps the scan at sixty
worlds and runs at most three reads concurrently. Every server independently authenticates and filters ownership;
the public registry never grants access. Stopped launcher worlds are labelled for their owner and are never woken by a summary read. Other devices/sites
that are not in these same-site registries are not searched. Unavailable worlds and limited retained history are labelled.

Each world serves `GET /v1/me/away` and `POST /v1/me/visit`. Summaries use canonical events, world edits and the
owner's residents' event streams. They contain up to 24 residents, five top factual events, four places and a
conversation count per resident, plus eight world changes (builds, weather, new residents). No model is called.
Source scans cap at 300 events per resident/world; retention gaps and display caps set `incomplete`.

Visit state is stored in `welcome_visits_v1`, scoped to account and world. Cutoffs contain the canonical event,
world-edit and per-resident stream sequence, so same-timestamp events cannot disappear. The first visit establishes
a baseline. The UI acknowledges a loaded summary's server-issued `through` cutoff, records a heartbeat for the selected world each visible
minute and attempts another when hidden. Other worlds advance only to their loaded summary cutoff. Hidden pages do not run the visible heartbeat. Abrupt browser termination
may leave a cutoff up to a minute old, repeating some activity on return. Each discovered world keeps its own cutoff.
No email or third-party delivery is involved.
