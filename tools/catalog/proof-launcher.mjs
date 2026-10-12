// Disposable rehearsal of the requested new-world catalogue env passthrough, through the launcher's existing hook.
// Does not modify defaultCommand or forkCommand. No real auth env is loaded.
import { resolve } from 'node:path';
import { openLauncher } from '../world-launcher/launcher.mjs';
import { defaultCommand } from '../world-launcher/children.mjs';
const root = resolve(new URL('../..', import.meta.url).pathname);
const instance = await openLauncher({ root, port: 6110, range: [6111, 6119], dataDir: process.argv[2], base: '/worlds', devAuth: true,
  webDir: resolve(root, '.lane/web-worlds'),
  command: (world, port, options) => {
    const command = defaultCommand(world, port, options);
    for (const name of ['CATALOG_REGISTRY_DIR', 'CATALOG_CHANNEL', 'CATALOG_GENE_OWNER_ID']) if (process.env[name]) command.env[name] = process.env[name];
    return command;
  } });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await instance.close(); process.exit(0); });
