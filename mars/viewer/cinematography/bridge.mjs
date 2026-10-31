// Run explicitly only; bounded12-call/$0.01 provider, loopback, exact origin.
import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { JevProvider } from './jev-server.ts';
// TYPESAFE_API_KEY from the environment, or from the .env file TYPESAFE_ENV_FILE names.
if (process.env.TYPESAFE_ENV_FILE) loadEnvFile(process.env.TYPESAFE_ENV_FILE);
const provider = new JevProvider(process.env.TYPESAFE_API_KEY, {
  maxCalls: 12,
  budgetUSD: 0.01,
});
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (
    origin !== 'http://127.0.0.1:5593' &&
    origin !== 'http://localhost:5593'
  ) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/decision') {
    res.writeHead(404).end();
    return;
  }
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 24000) {
      res.writeHead(413).end();
      return;
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const input = JSON.parse(text);
    if (
      !Array.isArray(input.candidates) ||
      input.candidates.length > 12 ||
      typeof input.session !== 'string' ||
      !Number.isInteger(input.version) ||
      !Number.isInteger(input.epoch)
    )
      throw Error('invalid input');
    const output = await provider.choose(input, controller.signal);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(output));
    console.log(
      JSON.stringify({
        calls: provider.calls,
        inputTokens: provider.inputTokens,
        costUSD: provider.costUSD,
        model: output.model,
        latencyMs: output.latencyMs,
      }),
    );
  } catch {
    res.writeHead(503).end(JSON.stringify({ code: 'camera.jev-unavailable' }));
  } finally {
    clearTimeout(timer);
  }
});
server.listen(7393, '127.0.0.1', () =>
  console.log(
    'Bounded Jev bridge127.0.0.1:7393;12calls / $0.01; close with Ctrl-C',
  ),
);
