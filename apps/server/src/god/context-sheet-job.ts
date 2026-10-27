import { Worker } from 'node:worker_threads';
/** One short-lived worker inside the world's serial maintenance job, never on a GET. */
export async function renderContextSheet(images: Uint8Array[], signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./context-sheet-worker.ts', import.meta.url), { workerData: images, execArgv: [] });
    let abort: () => void = () => { };
    try {
        return await new Promise<Uint8Array>((resolve, reject) => {
            abort = () => { void worker.terminate(); reject(signal.reason ?? new Error('sheet aborted')); };
            signal.addEventListener('abort', abort, { once: true });
            worker.once('message', resolve);
            worker.once('error', reject);
            worker.once('exit', code => { if (code)
                reject(new Error('sheet worker stopped')); });
            if (signal.aborted)
                abort();
        });
    }
    finally {
        signal.removeEventListener('abort', abort);
        await worker.terminate();
    }
}
