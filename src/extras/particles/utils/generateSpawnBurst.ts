import { unsafeEvalSupported } from 'pixi.js';

import { generateSpawn } from './generateSpawn';
import { generateSpawnPolyfill } from './generateSpawnPolyfill';
import type { SpawnAttribute, SpawnFn, SpawnShape } from './spawnPlan';

const codegen = unsafeEvalSupported();

/** Never evicted: it holds one function per attribute list and override pattern, a handful per game */
const cache = new Map<string, SpawnFn>();

/**
 * Must cover everything `generateSpawn` bakes in besides the override pattern, or systems could
 * share the wrong function
 * @internal
 */
export function spawnSignature(attributes: readonly SpawnAttribute[], shape: SpawnShape): string {
  let signature = `${shape.floatStride}${shape.world ? 'w' : 'l'}${shape.randomFrames ? 'r' : 'f'}`;

  for (const a of attributes) {
    signature += `|${a.index + a.offset}.${a.components}.${a.source}.${a.store}.${a.spread}`;
  }

  return signature;
}

/** @internal */
export function generateSpawnBurst(
  signature: string,
  attributes: readonly SpawnAttribute[],
  kinds: readonly number[],
  positionKind: number,
  shape: SpawnShape,
): SpawnFn {
  const key = `${signature}|${kinds.join('')}${positionKind}`;
  let fn = cache.get(key);

  if (fn === undefined) {
    fn = (codegen ? generateSpawn : generateSpawnPolyfill)(attributes, kinds, positionKind, shape);
    cache.set(key, fn);
  }

  return fn;
}
