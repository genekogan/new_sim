import type WebSocket from 'ws';

/** Test transport readiness is an actual message condition, not a count of
 * scheduler turns. Keep the network wait finite and remove every listener. */
export function waitForSocketCondition(socket: WebSocket, ready: () => boolean, label: string): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer); socket.off('message', check); socket.off('close', closed); socket.off('error', failed);
      if (error) reject(error); else resolve();
    };
    const check = () => { if (ready()) finish(); };
    const closed = () => finish(Error(`Socket closed before ${label}`));
    const failed = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(Error(`Socket did not deliver ${label} within 3000ms`)), 3000);
    socket.on('message', check); socket.once('close', closed); socket.once('error', failed);
    check();
  });
}
