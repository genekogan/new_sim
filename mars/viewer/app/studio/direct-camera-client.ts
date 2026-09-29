// Bounded one-shot worker lifecycle. Browser failures are explicit diagnostics, never a blocking fallback.
import { cameraWorkerFailure, type CameraCompileJob, type CompiledTakeCamera, type CameraWorkerReply } from './direct-camera-compile.ts';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
const create = (): WorkerPort => new Worker(new URL('./direct-camera.worker.ts', import.meta.url), { type: 'module' });

export function compileInWorker(job: CameraCompileJob, signal?: AbortSignal, factory: () => WorkerPort = create): Promise<CompiledTakeCamera> {
  return new Promise((resolve) => {
    let worker: WorkerPort | undefined;
    let done = false;
    const finish = (result: CompiledTakeCamera) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', cancel);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      resolve(result);
    };
    const refuse = (code: string, detail: string) => finish(cameraWorkerFailure(job.take.id, code, `Camera compilation for take ${job.take.id}: ${detail}`));
    const cancel = () => refuse('camera.worker.cancelled', 'cancelled because the request or active take changed');
    if (signal?.aborted) return cancel();
    try { worker = factory(); }
    catch (error) { return refuse('camera.worker.unavailable', `could not create a worker: ${String(error)}`); }
    worker.onmessage = (event: MessageEvent<CameraWorkerReply>) => {
      if (event.data?.type === 'started') return;
      if (event.data?.type !== 'result' || typeof event.data.compiled?.result?.ok !== 'boolean') return refuse('camera.worker.protocol', 'worker returned an invalid result');
      finish(event.data.compiled);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      refuse('camera.worker.error', event.message || 'worker failed');
    };
    worker.onmessageerror = () => refuse('camera.worker.message', 'worker result could not be decoded');
    signal?.addEventListener('abort', cancel, { once: true });
    // Cover an abort issued by a custom factory before handlers were attached.
    if (signal?.aborted) return cancel();
    try { worker.postMessage(job); }
    catch (error) { refuse('camera.worker.message', `request could not be sent: ${String(error)}`); }
  });
}
