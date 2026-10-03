// One request per worker. The caller terminates on completion, failure or cancellation.
import { compileTakeCamera, cameraWorkerFailure, type CameraCompileJob, type CameraWorkerReply } from './direct-camera-compile.ts';

const post = (reply: CameraWorkerReply) => self.postMessage(reply);

self.onmessage = (event: MessageEvent<CameraCompileJob>) => {
  const job = event.data;
  try {
    post({ type: 'started' });
    post({ type: 'result', compiled: compileTakeCamera(job) });
  } catch (error) {
    post({ type: 'result', compiled: cameraWorkerFailure(job.take.id, 'camera.worker.compile', `Camera compilation failed for take ${job.take.id}: ${String(error)}`) });
  }
};
