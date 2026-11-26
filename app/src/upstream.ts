// Upstream (UPA / Nasinnia service binding) calls must not hang a card or the CSS: abort after
// this long and let the caller's existing degrade path take over.
export const UPSTREAM_TIMEOUT_MS = 3000;
export const upstreamSignal = (): AbortSignal => AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
