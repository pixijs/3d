import { State, STATE_BITS } from 'pixi.js';
import type { Topology } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { GL_STATE_KEY_RANGE, packGlBatchKey } from '../packGlBatchKey';

// The GL batch key packs shader, state and topology into one number so the batcher breaks
// on a single compare. A field that outgrows its budget wouldn't error — it would quietly
// carry into its neighbour and fuse two draws that must stay apart. These tests pin each
// budget against pixi's own tables, so upstream growth fails here first.

const TOPOLOGIES: Topology[] = ['point-list', 'line-list', 'line-strip', 'triangle-list', 'triangle-strip'];

describe('packGlBatchKey budgets', () => {
  it('fits every State.data flag pixi defines', () => {
    const highestBit = Math.max(...Object.values(STATE_BITS));

    // 8 bits allotted; pixi uses 6.
    expect(2 ** (highestBit + 1)).toBeLessThanOrEqual(256);
  });

  it('fits every blend mode pixi defines', () => {
    const state = new State();
    const modes = ['normal', 'add', 'multiply', 'screen', 'overlay', 'erase', 'min', 'max'] as const;
    let highest = 0;

    for (const mode of modes) {
      state.blendMode = mode;
      highest = Math.max(highest, state._blendModeId);
    }

    // 5 bits allotted; pixi's highest id is 10.
    expect(highest).toBeLessThan(32);
  });

  it('maps every topology to a distinct id inside its budget', () => {
    const state = new State();
    const keys = TOPOLOGIES.map((topology) => packGlBatchKey(1, state, topology));

    expect(new Set(keys).size).toBe(TOPOLOGIES.length);
    expect(TOPOLOGIES.length).toBeLessThanOrEqual(8);
  });
});

describe('packGlBatchKey identity', () => {
  it('separates states that differ in any applied field', () => {
    const base = new State();
    base.depthTest = true;
    base.blend = false;

    const depth = new State();
    depth.depthTest = false;
    depth.blend = false;

    const blend = new State();
    blend.depthTest = true;
    blend.blend = false;
    blend.blendMode = 'add';

    const offset = new State();
    offset.depthTest = true;
    offset.blend = false;
    offset.polygonOffset = 2;

    const keys = [base, depth, blend, offset].map((s) => packGlBatchKey(7, s, 'triangle-list'));

    expect(new Set(keys).size).toBe(4);
  });

  it('gives equal-valued states from different objects the same key', () => {
    // `stateFor3D()` hands every material its own State, so equal values must key equal —
    // otherwise every material becomes its own draw and batching collapses.
    const a = new State();
    const b = new State();
    a.depthTest = b.depthTest = true;
    a.blend = b.blend = false;

    expect(a).not.toBe(b);
    expect(packGlBatchKey(7, a, 'triangle-list')).toBe(packGlBatchKey(7, b, 'triangle-list'));
  });

  it('keeps shaders apart and stays exact', () => {
    const state = new State();
    const first = packGlBatchKey(1, state, 'triangle-list');
    const second = packGlBatchKey(2, state, 'triangle-list');

    expect(first).not.toBe(second);
    expect(second - first).toBe(GL_STATE_KEY_RANGE);
    expect(Number.isSafeInteger(packGlBatchKey(2 ** 28, state, 'triangle-list'))).toBe(true);
  });
});
