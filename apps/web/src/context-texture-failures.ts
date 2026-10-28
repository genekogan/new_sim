/** Account for each loader error, not each URL. A second unhandled consumer
 * of the same URL must still prevent a partially loaded context photograph. */
export class ContextTextureFailures {
  private readonly replacements = new Map<string, number>();
  private readonly base: string;
  unresolved = false;
  constructor(base: string) { this.base = base; }
  private key(url: string): string { return new URL(url, this.base).href; }
  renderedFallback(url: string): void {
    const key = this.key(url);
    this.replacements.set(key, (this.replacements.get(key) ?? 0) + 1);
  }
  failed(url: string): void {
    const key = this.key(url), count = this.replacements.get(key) ?? 0;
    if (!count) { this.unresolved = true; return; }
    if (count === 1) this.replacements.delete(key);
    else this.replacements.set(key, count - 1);
  }
}
