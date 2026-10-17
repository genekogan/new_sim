// Sky palettes the world understands (world state `sky.palette`; schemas.ts keeps it a free string, so the CLI
// checks the name). What each one does today in the viewer (apps/web/src/gen-mesh/motion.ts): night/midnight
// light every lamp, dawn/dusk/twilight/sunset light them half, the others by `sun` (lamps come on below 0.3).
export const PALETTE_LIST = [
  { id: 'clear-day', doc: 'the default daylight (sun 0.6)' },
  { id: 'golden-hour', doc: 'late, low, warm light: use with --sun 0.3–0.4' },
  { id: 'dawn', doc: 'early light; lamps half lit' },
  { id: 'sunset', doc: 'evening; lamps half lit' },
  { id: 'dusk', doc: 'after sunset; lamps half lit' },
  { id: 'twilight', doc: 'between dusk and night; lamps half lit' },
  { id: 'night', doc: 'dark; every lamp lit (use --sun 0.05)' },
  { id: 'midnight', doc: 'darkest; every lamp lit' },
  { id: 'mars-desert', doc: 'the Mars camp template\'s sky (daylight)' },
  { id: 'lm-garden', doc: 'the Little Martians garden template\'s sky (daylight)' },
  { id: 'eden-summer', doc: 'the Eden 2026 template\'s sky: clear summer air, soft blue (daylight)' },
];
