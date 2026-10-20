// Lane U2 (Gene 2026-10-20: "Put the feedback button into your account submenu instead of as a dedicated button"). The
// Feedback form stays in VisitorWelcome (it reads the viewer's moment); any menu item asks for it through this one hook.
const listeners = new Set<() => void>();
/** Open the Feedback form (no-op until a VisitorWelcome is mounted). */
export function requestFeedback() { for (const f of listeners) f(); }
export function onFeedbackRequest(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
/** The menu item every menu shows; `data-feedback-open` is also the phone More menu's selector (HudMore). */
export const FEEDBACK_LABEL = 'Send feedback';
