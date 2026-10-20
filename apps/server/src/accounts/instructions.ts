// Lane PUX (Gene 2026-10-20: "it generates a url to do the pairing which is easy to lose ... the approval request [should
// come] up in your existing window"): the New Soul prompt a signed-in page gives its person links to
// instructions.md?for=<window code>. The guide then names the exact command with that code, so the agent's request is
// addressed to that person's account and appears in the window they already have open; the link stays a backup.
import {WINDOW_CODE} from './store.ts';

const LINK = 'If it returns an approval link, show the raw clickable link to the human: they sign in with Google or email and approve the intended world, Soul and agent.';
const WINDOW = 'The request appears in the human\'s open Sim window: tell them to approve it there. Also show the printed link, as a backup.';

/** The world's instructions.md for one request: {{BASE}}, {{WORLD}}, and with a well-formed window code {{FOR}} / {{APPROVE}}. */
export function fillInstructions(text: string, base: string, world: string, code?: string | null): string {
  const ok = typeof code === 'string' && WINDOW_CODE.test(code);
  return text.replaceAll('{{BASE}}', base).replaceAll('{{WORLD}}', world).replaceAll('{{FOR}}', ok ? ` --for ${code}` : '').replaceAll('{{APPROVE}}', ok ? WINDOW : LINK);
}
