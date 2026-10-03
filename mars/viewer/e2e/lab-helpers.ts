// Helpers for the Engine Lab (/lab) specs: readiness via window.__marsEngine.
import { expect, type Page } from '@playwright/test';

type Hook = {
  ready: boolean;
  frames: number;
  error: string;
  runScenario(name: string, opts?: { paused?: boolean; speed?: number }): LabState;
  step(n: number): LabState;
  runToEnd(max?: number): LabState;
  pause(on: boolean): void;
  state(): LabState;
  violations(): { code: string; message: string; tick: number }[];
  records(): { id: string; status: string; phase?: string; diagnostic?: { code: string; message: string }; history: { status: string; phase?: string }[] }[];
  cancelAction(id: string): { id: string; status: string; phase?: string; diagnostic?: { code: string; message: string } };
  setOverlay(name: string, on: boolean): void;
  camera(pos: number[], target: number[]): void;
  cameraPreset(kind: 'top' | 'oblique'): void;
  info(): { calls: number; triangles: number; geometries: number; textures: number; frames: number; humans: { id: string; template: string; speed: number; walkWeight: number; activity: string }[] };
  perf(): { ticks: number; meanMs: number; p50Ms: number; p95Ms: number; maxMs: number };
  sequence(): { steps: SeqStep[] | null; diagnostics: { tick: number; level: string; text: string }[] };
  runUntilSteps(ids: string[], status?: string, maxTicks?: number): LabState & { reached: boolean };
  components(): LabComponent[];
  stateHash(): string;
};
export type SeqStep = { id: string; verb: string; status: string; phase?: string; blockedTicks: number; code?: string; message?: string; start?: number; end?: number };
export type LabComponent = {
  id: string;
  def: string;
  phase?: string;
  support?: string;
  pose: { p: number[]; yaw: number; pitch?: number; roll?: number };
  corners: number[][];
  rendered: { min: number[]; max: number[] } | null;
};
export type LabState = {
  scenario: string;
  tick: number;
  time: number;
  done: boolean;
  humans: { id: string; p: number[]; yaw: number; level: number; activity: string; task: string | null }[];
  checks: { ok: boolean; message: string }[];
  stats: { meanMs: number; p95Ms: number; maxMs: number };
};
declare global {
  interface Window {
    __marsEngine?: Hook;
  }
}

export const OVERLAYS = ['grid', 'routes', 'traffic', 'agents', 'obstacles', 'links', 'labels', 'violations'];

export async function openLab(page: Page, scenario?: string) {
  await page.goto(scenario ? `/lab?scenario=${scenario}` : '/lab');
  await page.waitForFunction(() => window.__marsEngine?.ready === true || !!window.__marsEngine?.error, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__marsEngine!.error)).toBe('');
}

export async function labFrames(page: Page, n = 3) {
  const start = await page.evaluate(() => window.__marsEngine!.frames);
  await page.waitForFunction((t) => window.__marsEngine!.frames >= t, start + n);
}

export async function setOverlays(page: Page, on: boolean) {
  await page.evaluate(([names, v]) => (names as string[]).forEach((n) => window.__marsEngine!.setOverlay(n, v as boolean)), [OVERLAYS, on] as const);
  await labFrames(page);
}

