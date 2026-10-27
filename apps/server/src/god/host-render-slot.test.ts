import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostRenderSlot } from './host-render-slot.ts';
test('foreign holder keeps another world waiting without blocking its event loop; dead holder recovers', async () => {
    const previous = process.env.SIM_RENDER_LOCK_DIR, dir = mkdtempSync(join(tmpdir(), 'context-host-lock-'));
    process.env.SIM_RENDER_LOCK_DIR = dir;
    const module = new URL('../../../../tools/god-skill/lib/locks.mjs', import.meta.url).href;
    const script = `import {acquireLock} from ${JSON.stringify(module)};acquireLock(${JSON.stringify(join(dir, 'render.lock'))});console.log('ready');setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        await once(child.stdout!, 'data');
        let turns = 0;
        const timer = setInterval(() => turns++, 5), signal = AbortSignal.timeout(250);
        try {
            await assert.rejects(hostRenderSlot(signal));
        }
        finally {
            clearInterval(timer);
        }
        assert.ok(turns >= 10, 'the waiting server continues servicing event-loop turns');
        child.kill('SIGKILL');
        await once(child, 'exit');
        const release = await hostRenderSlot(AbortSignal.timeout(2000));
        release();
    }
    finally {
        if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL');
        if (previous === undefined)
            delete process.env.SIM_RENDER_LOCK_DIR;
        else
            process.env.SIM_RENDER_LOCK_DIR = previous;
    }
});
