import { parentPort, workerData } from 'node:worker_threads';
import { contextSheet } from './context-sheet.ts';
const png = contextSheet(workerData as Uint8Array[]).png;
parentPort!.postMessage(png);
