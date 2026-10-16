export function eyesBrowserModes(env?: NodeJS.ProcessEnv, platform?: string): string[];
export function eyesBrowserLaunch(mode: string, env?: NodeJS.ProcessEnv, platform?: string): {headless: boolean; channel?: string; args: string[]};
export function eyesWorkerProblem(platform?: string): string | null;
