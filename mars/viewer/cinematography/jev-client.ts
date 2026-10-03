// Browser only calls camera-owned loopback bridge. No credentials in this module.
import type { DirectorProvider, Request } from './types.ts';
export class BridgeProvider implements DirectorProvider {
  async choose(request: Request, signal: AbortSignal) {
    const r = await fetch('http://127.0.0.1:7393/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!r.ok) throw Error('camera.bridge-unavailable');
    return r.json();
  }
}
