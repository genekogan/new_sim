// Humanoid lab dev server (lane L10 ports 4985/4988/4989 only): serves apps/web with the Mars public assets
// (the kit lives in mars/viewer/public/modular/humanoid, as the Sim server serves it under /modular/*).
//   node apps/web/node_modules/vite/bin/vite.js --config apps/web/src/humanoid/lab.vite.config.ts
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const web = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root: web, publicDir: fileURLToPath(new URL('../../../../mars/viewer/public', import.meta.url)), plugins: [react()],
  define: {__BUILD__: JSON.stringify('humanoid-lab'), __SIM_ARRIVAL_ENABLED__: false},
  server: {port: Number(process.env.HUMANOID_LAB_PORT ?? 4985), strictPort: true, host: '127.0.0.1', fs: {allow: [fileURLToPath(new URL('../../../../', import.meta.url))]}},
});
