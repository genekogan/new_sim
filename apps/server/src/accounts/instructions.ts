// Lane PUX (Gene 2026-10-20: "it generates a url to do the pairing which is easy to lose ... the approval request [should
// come] up in your existing window"): the New Soul prompt a signed-in page gives its person links to
// instructions.md?for=<window code>. The guide then names the exact command with that code, so the agent's request is
// addressed to that person's account and appears in the window they already have open; the link stays a backup.
import {WINDOW_CODE} from './store.ts';

const LINK = 'If it returns an approval link, show the raw clickable link to the human: they sign in with Google or email and approve the intended world, Soul and agent.';
const WINDOW = 'The request appears in the human\'s open Sim window: tell them to approve it there. Also show the printed link, as a backup.';

/** SOUL3 2.0.0: the published instructions.md is a rendered capture (Eden 2026, one window code), not a {{}} template.
 *  It is recognised only by its exact opening lines (SOURCES.json instructions.capture), and only these literals are
 *  replaced: the world URL, the world name in the two anchored places, and the captured ` --for <code>`. */
export const CAPTURE = {base: 'https://sim.eden.art/worlds/w/eden-2026', world: 'Eden 2026', code: 'GL7R-YZYJ'} as const;
const CAPTURE_HEAD = `# Create a Soul in ${CAPTURE.world}\n\nWorld: ${CAPTURE.base} (the world's name is **${CAPTURE.world}**; that is never your Soul's name.)\n`;
const CAPTURE_BASE = new RegExp(CAPTURE.base.replace(/[.\/]/g, '\\$&') + '(?![A-Za-z0-9-])', 'g');
const CAPTURE_FOR = new RegExp(` --for ${CAPTURE.code}(?![A-Z0-9-])`, 'g');
const CAPTURE_WINDOW = /The request appears in your human's open Sim window: tell them to approve it there, and show the printed\s+`approvalURL` as a backup\./;
const CAPTURE_LINK = 'Show your human the printed `approvalURL` as a raw clickable link: they sign in with Google or email and approve the intended world, Soul and agent.';

function fillCapture(text: string, base: string, world: string, code: string | null): string {
  const out = text.slice(CAPTURE_HEAD.length).replace(CAPTURE_BASE, () => base).replace(CAPTURE_FOR, () => code ? ` --for ${code}` : '');
  const head = `# Create a Soul in ${world}\n\nWorld: ${base} (the world's name is **${world}**; that is never your Soul's name.)\n`;
  return head + (code ? out : out.replace(CAPTURE_WINDOW, () => CAPTURE_LINK));
}

/** The world's instructions.md for one request: {{BASE}}, {{WORLD}}, and with a well-formed window code {{FOR}} / {{APPROVE}}.
 *  The rendered capture instead gets `approvedBase` (the world URL from server configuration, never a request header). */
export function fillInstructions(text: string, base: string, world: string, code?: string | null, approvedBase = base): string {
  const ok = typeof code === 'string' && WINDOW_CODE.test(code);
  if (text.startsWith(CAPTURE_HEAD)) return fillCapture(text, approvedBase, world, ok ? code : null);
  return text.replaceAll('{{BASE}}', base).replaceAll('{{WORLD}}', world).replaceAll('{{FOR}}', ok ? ` --for ${code}` : '').replaceAll('{{APPROVE}}', ok ? WINDOW : LINK);
}
