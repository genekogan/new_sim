// Entry 35 (packet 44): rock-paper-scissors as a paired pose (social/pose.ts, together/1 ready-v1). One shared timeline from
// the pair's common start tick, so both bodies (and every viewer) count in step. The choices come from the edge ledger,
// one per Soul, given with the offer and with the acceptance; a body's shape is published (human.rps.shape) only from the
// shoot beat, so nothing shows a throw before it is thrown. The world is the referee (rpsResult).
export const RPS_SHAPES = ['rock', 'paper', 'scissors'] as const;
export type RpsShape = (typeof RPS_SHAPES)[number];
/** Seconds from the shared start: the fist comes up (RAISE), pumps on beats FIRST, FIRST+BEAT, FIRST+2·BEAT, and throws on
 *  SHOOT = FIRST+3·BEAT; the shapes are held until HOLD_END, then the arm comes down by DOWN_END; the pose ends at SECONDS. */
export const RPS = { RAISE: 1.3, FIRST: 1.7, BEAT: 0.5, SHOOT: 3.2, HOLD_END: 5.4, DOWN_END: 6.3, SECONDS: 6.6 } as const;
/** The state stays this long after the count ends (`end`), so the viewer can hold idle gestures off and fade them back in. */
export const RPS_STATE_TAIL = 2.6;
export type RpsState = { start: number; shoot: number; shape?: RpsShape; end?: number };
const BEATS: Record<RpsShape, RpsShape> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
/** The result for the first shape: 'win' | 'lose' | 'draw'. */
export const rpsResult = (mine: RpsShape, theirs: RpsShape): 'win' | 'lose' | 'draw' => mine === theirs ? 'draw' : BEATS[mine] === theirs ? 'win' : 'lose';
export const isRpsShape = (v: unknown): v is RpsShape => typeof v === 'string' && (RPS_SHAPES as readonly string[]).includes(v);
