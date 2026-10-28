export const USEFULNESS_PROTOCOL = Object.freeze({ version: 'context-usefulness/1', adapter: 'codex-headless',
  model: 'gpt-6-astra', effort: 'high', order: ['text', 'visual', 'visual', 'text'],
  cliCalls: 12, answerWords: 300, sessionWallSeconds: 120, adapterWallSeconds: 115,
  killReserveSeconds: 5, filesPerVisualSeat: 4, totalImageDownloads: 12, maxAccountedTokens: 120000, outerWallSeconds: 600 });
export const TASKS = [
  'A. Find the presenter seat inside the lecture room. Report the exact room and seat references, explain their relationship, and state whether this is architectural context or current Soul sight. Do not move.',
  'B. Compare the meeting fountain and the lecture room as they appear. Give two concrete visual differences, cite each target reference, and say when you could not see enough to answer.',
  'C. Inspect the original wall artwork, not a picture of the room. Describe its two main colored shapes and background, give its exact asset version, and distinguish that original from the architectural preview.',
];
export const TARGETS = Object.freeze({ fountain: 'landmark', room: 'enclosed-room', seat: 'interior-seat', original: 'wall-artwork' });
export function promptFor(arm) {
  if (!['text', 'visual'].includes(arm)) throw Error('unknown usefulness arm');
  return `The harness has already downloaded the world’s standalone eden.mjs CLI and skill.md into this isolated folder. Bootstrap is complete; do not register, pair, mint, create a Soul or fetch another launcher. Read skill.md with one cat skill.md command. Use only relative node eden.mjs context [query], help or version commands${arm === 'visual' ? ', and explicit views --detail commands (or views --original for the original) that download up to three selected architectural PNGs plus one original PNG into this folder' : '; this text arm has context metadata only, so do not retrieve or open images'}. No other shell commands, file reads, writes, world actions, networking, browsing or tools are allowed${arm === 'visual' ? ' except the native view_image tool for PNGs actually downloaded by those views commands. Images are optional, with at most four total; open every PNG you download with view_image. A filename or textual description is not vision evidence' : ''}. Never search parent folders, source code, other seats, logs or oracle files.\n\nRun at most twelve readonly CLI calls, one command per shell call; cat skill.md is a separate single bootstrap read. ${arm === 'visual' ? 'Use local filenames ending .png, with no directories. Image-tool calls are counted separately from CLI calls.' : 'When metadata is insufficient to inspect appearance, state that honestly.'} Answer all three tasks once, in at most 300 words total. Cached architecture is not current Soul sight; do not infer occupancy, live doors or current lighting. Do not write an answer file.\n\n${TASKS.join('\n\n')}`;
}
export function rawUsage(stream) {
  const event = stream.findLast(event => event.type === 'turn.completed');
  const raw = event?.usage ?? null;
  const number = key => Number.isSafeInteger(raw?.[key]) && raw[key] >= 0 ? raw[key] : null;
  return { raw, inputTokens: number('input_tokens'), outputTokens: number('output_tokens'),
    cachedInputTokens: number('cached_input_tokens'), cacheWriteTokens: number('cache_write_input_tokens'),
    reasoningOutputTokens: number('reasoning_output_tokens'), costUsd: null,
    totalAccountedTokens: number('input_tokens') !== null && number('output_tokens') !== null
      ? number('input_tokens') + number('output_tokens') : null,
    responseCount: null, missingReason: 'Only actual exec JSON usage fields are reported; absent counters and subscription dollar cost remain null.' };
}
export function toolInventory(stream) {
  const items = new Map();
  for (const event of stream) if (['item.started', 'item.completed'].includes(event.type) && event.item?.id)
    items.set(event.item.id, { ...(items.get(event.item.id) ?? {}), ...event.item, completed: event.type === 'item.completed' });
  return { commands: [...items.values()].filter(item => item.type === 'command_execution'),
    images: [...items.values()].filter(item => item.type === 'image_view'),
    other: [...items.values()].filter(item => !['command_execution', 'image_view', 'agent_message', 'reasoning'].includes(item.type)) };
}
export function countWords(text) { return String(text ?? '').trim().split(/\s+/).filter(Boolean).length; }
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /^(authorization|token|api_key|apiKey|access_token|refresh_token|id_token)$/i.test(key) ? '[REDACTED]' : redact(item)]));
  return typeof value === 'string' ? value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]') : value;
}
