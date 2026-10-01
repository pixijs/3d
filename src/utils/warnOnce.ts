import { GlobalResourceRegistry, warn } from 'pixi.js';

/**
 * Keys that have already warned
 *
 * Page-global engine state, so it's registered with `GlobalResourceRegistry`: a full engine reset
 * (`renderer.destroy({ releaseGlobalResources: true })`, or the per-file test reset) clears it
 * alongside the shared pools and re-arms every warn.
 */
const seen = new Set<string>();

GlobalResourceRegistry.register({ clear: () => seen.clear() });

/**
 * Emits a warning once per unique key
 *
 * Keeps warns whose trigger state persists frame-to-frame from flooding the
 * console.
 * @param key - dedupe key, shared by the whole page rather than kept per object: the first call
 * with it warns and every later call is a no-op, whoever makes it
 * @param args - forwarded to pixi.js's `warn`
 * @internal
 */
export function warnOnce(key: string, ...args: unknown[]): void {
  if (seen.has(key)) return;
  seen.add(key);
  warn(...args);
}
