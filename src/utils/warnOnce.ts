import { GlobalResourceRegistry, warn } from 'pixi.js';

const seen = new Set<string>();

GlobalResourceRegistry.register({ clear: () => seen.clear() });

/**
 * Warns once per key for the whole page, not per object, until `GlobalResourceRegistry` is released
 * @internal
 */
export function warnOnce(key: string, ...args: unknown[]): void {
  if (seen.has(key)) return;
  seen.add(key);
  warn(...args);
}
