import { GlobalResourceRegistry, warn } from 'pixi.js';

const seen = new Set<string>();

// The dedupe set is page-global engine state, so a full engine reset
// (`renderer.destroy({ releaseGlobalResources: true })`, or the per-file test
// reset) re-arms every warn alongside the shared pools.
GlobalResourceRegistry.register({ clear: () => seen.clear() });

/**
 * Emits a warning once per unique key
 *
 * Keeps warns whose trigger state persists frame-to-frame from flooding the
 * console.
 * @param key - dedupe key; the first call per key warns, later calls are no-ops
 * @param args - forwarded to pixi.js's `warn`
 * @internal
 */
export function warnOnce(key: string, ...args: unknown[]): void {
  if (seen.has(key)) return;
  seen.add(key);
  warn(...args);
}
