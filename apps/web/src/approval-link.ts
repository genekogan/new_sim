/** `#approve/ap_…` — the link the Soul CLI prints for its human. No imports: node tests and the page shell both read it. */
export const approvalFromHash = (hash: string) => /^#approve\/(ap_[a-f0-9]{32})$/.exec(hash)?.[1] ?? null;
