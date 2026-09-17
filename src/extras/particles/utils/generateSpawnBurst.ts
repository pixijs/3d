import { unsafeEvalSupported } from 'pixi.js';

import { generateSpawn } from './generateSpawn';
import { generateSpawnPolyfill } from './generateSpawnPolyfill';
import type { SpawnAttribute, SpawnFn, SpawnShape } from './spawnPlan';

/** Whether spawns run generated code: `new Function` where the page allows it, the polyfill where it doesn't */
let codegen = unsafeEvalSupported();

/**
 * Every spawn function made so far, keyed by what shaped its code
 *
 * Never evicted: there is one per attribute list and override pattern, which
 * is a handful per game, not per spawn.
 */
const cache = new Map<string, SpawnFn>();

/**
 * Forces the polyfill on or off, for the parity test
 * @param enabled - Whether spawns use generated code; `false` forces the polyfill
 * @internal
 */
export function setSpawnCodegen(enabled: boolean): void {
  codegen = enabled;
}

/**
 * Everything about an attribute list that shapes a spawn function's code, as one string
 *
 * Each attribute's element, width, source, store and spread, plus the stride,
 * the space and the frame mode. Computed once per system; two systems with the
 * same attributes get the same signature whatever bit objects they were
 * composed from.
 * @param attributes - The system's spawn attributes
 * @param shape - The system's stride, space and frame mode
 * @returns The signature, the first half of a spawn function's cache key.
 * @internal
 */
export function spawnSignature(attributes: readonly SpawnAttribute[], shape: SpawnShape): string {
  let signature = `${shape.floatStride}${shape.world ? 'w' : 'l'}${shape.randomFrames ? 'r' : 'f'}`;

  for (const a of attributes) {
    signature += `|${a.index + a.offset}.${a.components}.${a.source}.${a.store}.${a.spread}`;
  }

  return signature;
}

/**
 * The spawn function for one attribute list and one override pattern
 *
 * An early return from the cache, or made on first sight by `generateSpawn`
 * (or its polyfill) and kept. Shared by every system with the same signature,
 * so a game that builds a fresh system per effect pays for a pattern once, not
 * once per system, and the function it gets is already warm.
 * @param signature - The attribute list's signature from `spawnSignature`
 * @param attributes - The attributes a spawn writes, in the order it writes them
 * @param kinds - Each attribute's override kind for this burst, parallel to `attributes`
 * @param positionKind - The position override's kind
 * @param shape - The stride, space and frame mode the function is built for
 * @returns The cached or freshly made spawn function.
 * @internal
 */
export function generateSpawnBurst(
  signature: string,
  attributes: readonly SpawnAttribute[],
  kinds: readonly number[],
  positionKind: number,
  shape: SpawnShape,
): SpawnFn {
  const key = `${codegen ? 'g' : 'p'}${signature}|${kinds.join('')}${positionKind}`;
  let fn = cache.get(key);

  if (fn === undefined) {
    fn = (codegen ? generateSpawn : generateSpawnPolyfill)(attributes, kinds, positionKind, shape);
    cache.set(key, fn);
  }

  return fn;
}
