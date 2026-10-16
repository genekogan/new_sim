/** Clipboard denial is an ordinary UI outcome; callers keep selectable text and show this hint. */
export const manualCopyHint = 'Press ⌘C (Ctrl+C on Windows/Linux) to copy.';
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}
