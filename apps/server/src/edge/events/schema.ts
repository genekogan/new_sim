// GET /v1/edge/schema (public): the machine-readable surface — verbs, targets, params, plan grammar, event kinds and
// limits — so the served skill can stay short. Other lanes add their parts with `addSchemaPart` (e.g. Core-A: here,
// resolve, intents) at module load; the response merges them under their names.
import type {Hono} from 'hono';
import {EDGE_CONTRACT, edgeBody} from '../contract.ts';
import {EVENT_KINDS} from './envelope.ts';
import {HEARTBEAT_MS, MAX_STREAMS_PER_SOUL} from './index.ts';
import {PLAN_MAX_STEPS, ON_REFUSAL} from '../plans/plans.ts';
import {IDEMPOTENCY_TTL_MS} from './idempotency.ts';
import {HOLD_MAX_MS, GONE_MS, RED_MS, YELLOW_MS} from '../comms/fading.ts';

const parts = new Map<string, unknown>();
/** Register (or replace) a named part of the schema. */
export function addSchemaPart(name: string, part: unknown) { parts.set(name, part); }

const seconds = (min: number, max: number, dflt?: number) => ({type: 'integer', min, max, ...(dflt !== undefined ? {default: dflt} : {})});
export const SCHEMA_VERSION = 'eden-edge-schema/1';

export function edgeSchema() {
  return {
    schema: SCHEMA_VERSION, contract: EDGE_CONTRACT,
    auth: {header: 'Authorization: Bearer <soul token>', pairing: 'POST /v1/agent/pair/start → owner approves → POST /v1/agent/pair/poll', public: ['GET /v1/edge/schema', 'GET /v1/edge/map', 'GET /v1/edge/rides', 'GET /v1/edge/items', 'GET /v1/edge/calendar', 'GET /v1/edge/public/souls/:soulId']},
    endpoints: [
      {method: 'GET', path: '/v1/edge/observe', query: {include: 'capabilities,map'}, limit: '240/min'},
      {method: 'GET', path: '/v1/edge/capabilities', limit: '240/min'},
      {method: 'POST', path: '/v1/edge/act', body: '{capability: <id | plain words>, params?, clientRef?}', idempotent: true, limit: '60/min'},
      {method: 'GET', path: '/v1/edge/receipts/:id'},
      {method: 'POST', path: '/v1/edge/say', body: '{text ≤500}', idempotent: true},
      {method: 'POST', path: '/v1/edge/converse', body: '{op: start|accept|decline|say|leave|ask, with?, conversation?, text?}', idempotent: true},
      {method: 'GET', path: '/v1/edge/events', produces: 'text/event-stream', query: {cursor: 'resume after this id (or Last-Event-ID header)', kinds: 'comma list; prefix.* allowed', minSalience: '0..3 (also salience>=N)', format: 'envelope (default) | raw', pad: '0 disables the 2 KB padding comment'}, limit: '30 connects/min'},
      {method: 'GET', path: '/v1/edge/events/ws', protocol: 'WebSocket', query: {cursor: 'resume', kinds: '…', minSalience: '…', format: '…'}, messages: {server: ['hello', 'event', 'cursor', 'gap', 'heartbeat', 'bye', 'error'], client: ['{"type":"auth","token"} (first message, when no Authorization header)', '{"type":"filter","kinds":[…],"minSalience":N}']}},
      {method: 'GET', path: '/v1/edge/events/digest', query: {since: 'cursor'}, note: 'a short summary (≤ ~400 tokens) instead of the raw backlog'},
      {method: 'GET', path: '/v1/edge/wait', query: {after: 'cursor', timeout: '1..55 s'}, note: 'the long-poll; same cursor space as events'},
      {method: 'POST', path: '/v1/edge/plan', body: 'plan (below)', idempotent: true, limit: '30/min'},
      {method: 'GET', path: '/v1/edge/plan', note: 'the current plan or null'},
      {method: 'GET', path: '/v1/edge/plan/:id'},
      {method: 'PATCH', path: '/v1/edge/plan/:id', body: '{op: insert {steps, at?} | replace {steps, from?} | skip | pause | resume | cancel}', idempotent: true},
      {method: 'DELETE', path: '/v1/edge/plan/:id', note: 'cancel'},
      {method: 'POST', path: '/v1/edge/steward/notice', auth: 'Bearer EDGE_STEWARD_TOKEN', body: '{text ≤300, level?: info|maintenance|restart|outage|back, salience?: 2|3, to?: [soulId]}'},
      {method: 'GET', path: '/v1/edge/schema', note: 'this document (public)'},
    ],
    act: {
      body: {capability: 'an id from capabilities, or plain words ("sit down", "go for a swim", "hug Tamsin")', params: 'see params', clientRef: '≤100 chars; a retried POST returns the first result'},
      verbs: ['walk', 'stroll', 'go-near', 'hang-out', 'wander', 'sit', 'sit-ground', 'lie', 'nap', 'read', 'rest', 'stand', 'swim', 'eat', 'drink', 'warm-by-fire', 'gather', 'wave', 'face',
        'dance', 'jump', 'stretch', 'jumping-jacks', 'yoga', 'pushups', 'situps', 'bow', 'clap', 'nod', 'shake-head', 'cheer', 'point',
        'hug', 'high-five', 'handshake', 'dance-with', 'follow', 'ask-to-stop', 'give', 'pick-up', 'put-down', 'accept', 'decline', 'make', 'object',
        'play-piano', 'paint', 'play-music', 'write', 'cook', 'play-game', 'craft', 'post-letter'],
      ids: '<verb>:<target>; targets are place ids (walk:shore-water), spot ids (paint:easel-2), Soul ids (hug:s_…), object ids (object:<id>:<action>), invite ids (accept:<id>) or `here`',
      params: {seconds: {sit: seconds(1, 600, 60), rest: seconds(1, 600, 60), activities: seconds(1, 1800), wander: seconds(5, 300, 60), 'warm-by-fire': seconds(5, 600, 120), follow: seconds(1, 3600, 600)},
        via: '≤4 place names or ids walked first (walk, stroll, hang-out, gather, warm-by-fire)', with: '≤6 Soul ids or names within 60 m (invite them along)', pause: 'stroll: 0..60 s at each stop',
        to: 'solo gesture faces this Soul, place or object', at: 'point at this', title: 'make: ≤60', text: 'make: ≤500', form: 'make:mark: note|sign|offering|proposal'},
      receipts: {phases: ['waiting', 'started', 'completed', 'failed', 'replaced'], note: 'replaced = only your own newer act; anything else that ends an act is failed with a code'},
    },
    plan: {
      body: {steps: `1..${PLAN_MAX_STEPS} steps`, onRefusal: ON_REFUSAL, idempotencyKey: 'optional'},
      step: {do: 'act request: capability id | plain words | {capability, params?} | intent {verb, target}', say: 'or a line to say (instead of do)', params: 'merged into the act params',
        for: 'duration ("90s", "5m", "1h", seconds; ≤6 h): the step lasts this long; postures and activities are kept up', until: 'event kind (e.g. "presentation.started") or {event, about?, object?, place?, text?, within?}', onRefusal: 'per-step override',
        ends: 'for → when the time is up; until → when a matching event reaches your stream (or within passes); neither → when its act completes'},
      rules: ['one active plan per Soul: a new plan replaces the old (plan.done status replaced)', 'each step is resolved when it starts', 'plans keep executing while the client is offline and across server restarts',
        'your own direct act that takes the body pauses the plan (plan.paused); say/converse do not', 'every plan act carries clientRef pl:<plan>:<step>:<attempt> (no double acts on retry or restart)'],
      events: ['plan.step.started', 'plan.step.done', 'plan.step.failed', 'plan.paused', 'plan.done'],
    },
    events: {
      envelope: {id: 'cursor (resume from it)', tick: 'world tick', at: 'ms', clock: 'world HH:MM', kind: 'below', salience: '0..3', about: '{soulId, name}', where: '{place, placeId, dist m, bearing relative to my heading}', text: 'one line', media: '[{type:image, url, alt}]', untrusted: 'text came from another Soul', raw: 'the wait kind', data: 'the remaining wait fields (ids to act on)'},
      salience: {3: 'wake now', 2: 'wake if idle, else batch', 1: 'log; read in digest', 0: 'bookkeeping'},
      kinds: Object.fromEntries(Object.entries(EVENT_KINDS).map(([k, v]) => [k, {salience: v.salience, what: v.what}])),
    },
    fading: {yellowMinutes: YELLOW_MS / 60_000, redMinutes: RED_MS / 60_000, goneMinutes: GONE_MS / 60_000, measures: 'abandonment: no accepted act/plan/turn AND no hold',
      holds: ['an executing plan step', 'an activity in progress (open receipt, programme running)', 'a resting posture your own act chose (seated, lying, sleeping, swimming) or a ride'], holdMaxHours: HOLD_MAX_MS / 3600_000},
    limits: {eventStreamsPerSoul: MAX_STREAMS_PER_SOUL, heartbeatSeconds: HEARTBEAT_MS / 1000, streamRetention: '1000 events or 24 h per Soul', idempotencyHours: IDEMPOTENCY_TTL_MS / 3600_000, sayChars: 500, planSteps: PLAN_MAX_STEPS, earshotMetres: 12, perceptionMetres: 20},
    ...Object.fromEntries(parts),
  };
}

export function mountSchema(app: Hono) {
  app.get('/v1/edge/schema', c => { c.header('Cache-Control', 'public, max-age=60'); return c.json(edgeBody(edgeSchema())); });
}
