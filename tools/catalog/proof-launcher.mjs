// Disposable proof of the production defaultCommand catalogue passthrough. No real auth env is loaded.
import { resolve } from 'node:path';
import { openLauncher } from '../world-launcher/launcher.mjs';
const root = resolve(new URL('../..', import.meta.url).pathname);
const instance = await openLauncher({ root, port: 6110, range: [6111, 6119], dataDir: process.argv[2], base: '/worlds', devAuth: true,
  webDir: resolve(root, '.lane/web-worlds') });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await instance.close(); process.exit(0); });
