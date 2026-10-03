import { useEffect, useCallback, useRef, useState } from 'react';
import type { SimSnapshot } from '../../simulation/shared';
import { acceptsSnapshot } from '../../lib/snapshot-order';
type Room = { id: string; key: string; control: boolean };
async function hash(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    ),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}
export function SimulationPanel({
  onSnapshot,
  onFollow,
  onConnection,
  edited,
  year = 2026,
}: {
  year?: number;
  onSnapshot: (s: SimSnapshot | null) => void;
  onFollow: (v: boolean) => void;
  edited: boolean;
  onConnection: (connected: boolean) => void;
}) {
  const [room, setRoom] = useState<Room | null>(null),
    [snapshot, setSnapshot] = useState<SimSnapshot | null>(null),
    [status, setStatus] = useState(''),
    [follow, setFollow] = useState(false),
    [config, setConfig] = useState(false),
    [busy, setBusy] = useState(false),
    [copyFallback, setCopyFallback] = useState('');
  const generation = useRef(0),
    latest = useRef<SimSnapshot | null>(null);
  const requests = useRef(new Set<AbortController>());
  const followCallback = useRef(onFollow);
  followCallback.current = onFollow;
  const connectCallback = useRef(onConnection);
  connectCallback.current = onConnection;
  const switchRoom = useCallback((next: Room | null) => {
    generation.current++;
    requests.current.forEach((r) => r.abort());
    requests.current.clear();
    latest.current = null;
    setSnapshot(null);
    setStatus(next ? 'Connecting…' : '');
    setBusy(false);
    setConfig(false);
    setCopyFallback('');
    setFollow(false);
    followCallback.current(false);
    callback.current(null);
    connectCallback.current(!!next);
    setRoom(next);
  }, []);
  function accept(s: SimSnapshot, epoch: number) {
    if (epoch !== generation.current) return false;
    const last = latest.current;
    if (!acceptsSnapshot(last, s)) return false;
    latest.current = s;
    setSnapshot(s);
    callback.current(s);
    return true;
  }
  const request = useCallback(async (path: string, r: Room, body?: unknown) => {
    const abort = new AbortController();
    requests.current.add(abort);
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const previous = latest.current;
      const suffix =
        path === 'state' && previous
          ? `?year=${year}&revision=${previous.state.revision}`
          : `?year=${year}`;
      const response = await fetch(`/api/simulation/${path}${suffix}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${r.id}.${r.key}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: abort.signal,
      });
      const s = (await response.json()) as SimSnapshot & {
        error?: string;
        unchanged?: boolean;
        revision?: number;
      };
      if (s.unchanged && previous && previous.state.revision === s.revision)
        return { ...previous, now: s.now };
      if (!response.ok)
        throw Error(s.error || `Room unavailable (${response.status})`);
      return s;
    } finally {
      clearTimeout(timeout);
      requests.current.delete(abort);
    }
  }, [year]);
  const callback = useRef(onSnapshot);
  callback.current = onSnapshot;
  useEffect(() => {
    function readRoom() {
      try {
        const params = new URLSearchParams(location.hash.slice(1)),
          view = params.get('mars-room');
        if (view) {
          const [id, key, extra] = view.split('.');
          if (!extra && /^[a-f0-9]{64}$/.test(id) && /^[a-f0-9]{64}$/.test(key))
            switchRoom({ id, key, control: false });
          else {
            switchRoom(null);
            setStatus('Invalid room link');
          }
        } else {
          const stored = localStorage.getItem(year === 2026 ? 'mars-simulation-room' : `mars-simulation-room-${year}`);
          if (stored) {
            const r = JSON.parse(stored);
            if (
              /^[a-f0-9]{64}$/.test(r.id) &&
              /^[a-f0-9]{64}$/.test(r.key) &&
              typeof r.control === 'boolean'
            )
              switchRoom(r);
          } else switchRoom(null);
        }
      } catch {
        setStatus('Saved room could not be read. Create a new room.');
      }
    }
    const counter = generation,
      pending = requests.current;
    readRoom();
    window.addEventListener('hashchange', readRoom);
    return () => {
      counter.current++;
      pending.forEach((r) => r.abort());
      window.removeEventListener('hashchange', readRoom);
    };
  }, [switchRoom, year]);
  useEffect(() => {
    if (!room) return;
    let stopped = false,
      failures = 0,
      timer: ReturnType<typeof setTimeout>;
    const epoch = generation.current;
    const poll = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(poll, 2000);
        return;
      }
      try {
        const s = await request('state', room);
        if (!stopped && accept(s, epoch)) {
          failures = 0;
          setStatus('Connected');
        }
      } catch (e) {
        if (!stopped && epoch === generation.current) {
          failures++;
          setStatus(
            `Disconnected · ${e instanceof Error ? e.message : 'retrying'}`,
          );
        }
      } finally {
        if (!stopped)
          timer = setTimeout(poll, Math.min(15000, 1000 * 2 ** failures));
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [room, request]);
  async function create() {
    if (busy) return;
    setBusy(true);
    const epoch = generation.current;
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32)),
        key = Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join(
          '',
        ),
        view = await hash(key),
        id = await hash(view),
        r = { id, key, control: true };
      if (epoch !== generation.current) return;
      try {
        localStorage.setItem(year === 2026 ? 'mars-simulation-room' : `mars-simulation-room-${year}`, JSON.stringify(r));
      } catch {
        setStatus(
          'Room created. Storage is unavailable; save the connection details.',
        );
      }
      switchRoom(r);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function send(name: string, args: unknown) {
    if (!room?.control || busy || !snapshot) return;
    const epoch = generation.current;
    setBusy(true);
    try {
      const s = await request('command', room, {
        name,
        args,
        id: crypto.randomUUID(),
      });
      if (accept(s, epoch)) setStatus('Command applied');
    } catch (e) {
      if (epoch === generation.current) setStatus(String(e));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  const mcpConfig = room
    ? JSON.stringify(
        {
          mcpServers: {
            mars: {
              url: `${typeof location !== 'undefined' ? location.origin : ''}/mcp?year=${year}`,
              headers: { Authorization: `Bearer ${room.id}.${room.key}` },
            },
          },
        },
        null,
        2,
      )
    : '';
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
      setCopyFallback('');
    } catch {
      setStatus('Clipboard unavailable. Use the connection details below.');
      setCopyFallback(text);
    }
  }
  return (
    <details className="atmosphere-panel simulation-panel" open>
      <summary>
        Simulation & MCP <span>{room ? 'LIVE' : 'LOCAL'}</span>
      </summary>
      {!room ? (
        <>
          <p>
            Create a persistent, shareable room to direct people, activities,
            the environment and camera through MCP.
          </p>
          <button disabled={edited || busy} onClick={create}>
            Create simulation room
          </button>
          {status && <p role="status">{status}</p>}
          {edited && (
            <p>
              Save your edits and reset the layout first. Rooms use the baseline
              campus.
            </p>
          )}
        </>
      ) : (
        <>
          <p role="status">
            {status} · room {room.id.slice(0, 8)} · revision{' '}
            {snapshot?.state.revision ?? '…'}{' '}
            {room.control ? '' : '· View only'}
          </p>
          <label className="atmosphere-toggle">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                setFollow(e.target.checked);
                onFollow(e.target.checked);
              }}
            />
            Follow remote camera
          </label>
          <label className="atmosphere-toggle">
            <input
              type="checkbox"
              disabled={!room.control || busy || !snapshot}
              checked={snapshot?.state.environment.cycle ?? false}
              onChange={(e) =>
                send('set_environment', { cycle: e.target.checked })
              }
            />
            Time passes · day–night cycle
          </label>
          {room.control && (
            <>
              <fieldset className="time-presets" disabled={busy || !snapshot}>
                <button
                  onClick={() =>
                    send('set_paused', {
                      paused: snapshot?.state.pausedAt === null,
                    })
                  }
                >
                  {snapshot?.state.pausedAt == null ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() =>
                    send('set_fire', {
                      mode: snapshot?.state.fire === 'on' ? 'off' : 'on',
                    })
                  }
                >
                  Toggle fire
                </button>
                <button
                  onClick={() =>
                    send('set_environment', { hour: 18, cycle: false })
                  }
                >
                  Sunset
                </button>
              </fieldset>
              <fieldset className="time-presets" disabled={busy || !snapshot}>
                <button
                  onClick={() => send('set_weather', { preset: 'rainy' })}
                >
                  Rain
                </button>
                <button
                  onClick={() => send('set_weather', { preset: 'clear' })}
                >
                  Clear sky
                </button>
                <button
                  onClick={() =>
                    send('command_euc_riders', { action: 'return' })
                  }
                >
                  Recall EUCs
                </button>
                <button
                  onClick={() =>
                    send('set_screens', {
                      enabled:
                        !snapshot?.state.screens?.['hall-projector']?.enabled,
                    })
                  }
                >
                  Toggle gallery
                </button>
              </fieldset>
              <label>
                Simulation speed{' '}
                <select
                  aria-label="Simulation speed"
                  disabled={busy || !snapshot}
                  value={snapshot?.state.clock?.rate ?? 1}
                  onChange={(e) =>
                    send('set_simulation_speed', {
                      rate: Number(e.target.value),
                    })
                  }
                >
                  {[0.25, 0.5, 1, 2, 4, 8].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => copy(mcpConfig)}>
                Copy MCP connection
              </button>
              <button onClick={() => setConfig(!config)}>
                Connection details
              </button>
              {config && (
                <>
                  <p>
                    This control key lets its holder direct this room. Share the
                    viewing link for spectators.
                  </p>
                  <textarea
                    aria-label="MCP connection configuration"
                    readOnly
                    value={mcpConfig}
                    rows={10}
                  />
                </>
              )}
            </>
          )}
          <button
            onClick={async () => {
              const key = room.control ? await hash(room.key) : room.key;
              await copy(
                `${location.origin}${year === 2026 ? '/studio' : `/studio/${year}`}#mars-room=${room.id}.${key}`,
              );
            }}
          >
            Copy viewing link
          </button>
          <button
            onClick={() => {
              try {
                localStorage.removeItem(year === 2026 ? 'mars-simulation-room' : `mars-simulation-room-${year}`);
              } catch {
                /* Leaving still works without browser storage. */
              }
              history.replaceState(null, '', location.pathname);
              switchRoom(null);
              setSnapshot(null);
              setFollow(false);
              onFollow(false);
              setConfig(false);
            }}
          >
            Leave room
          </button>
          <p>
            Room motion uses the baseline campus. Outdoor walking is mapped near
            Chiba; indoor people can idle, wave and talk. Changes arrive about
            once a second.
          </p>
        </>
      )}
      {copyFallback && (
        <textarea
          aria-label="Copy connection or viewing link"
          readOnly
          value={copyFallback}
          rows={5}
        />
      )}
      <a href="/simulation-guide" target="_blank" rel="noreferrer">
        MCP commands & setup ↗
      </a>
    </details>
  );
}
