import { Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { BoxShape } from '~/extras/particles/emitterShapes/BoxShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import type { ParticleSystem3DOptions } from '~/extras/particles/ParticleSystem3D';
import { generateSpawn } from '~/extras/particles/utils/generateSpawn';
import { generateSpawnBurst, setSpawnCodegen, spawnSignature } from '~/extras/particles/utils/generateSpawnBurst';
import { generateSpawnPolyfill } from '~/extras/particles/utils/generateSpawnPolyfill';
import {
  ABSENT,
  AS_F32,
  AS_PACKED,
  AS_TINT,
  CONSTANT,
  FROM_CLOCK,
  FROM_PACKED,
  FROM_SPREAD,
  FROM_VELOCITY,
  FROM_ZERO,
  FUNCTION,
  PAIR,
} from '~/extras/particles/utils/spawnPlan';
import type { SpawnAttribute, SpawnContext, SpawnPlan } from '~/extras/particles/utils/spawnPlan';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector3 } from '~/math/vector/Vector3';

function attribute(
  key: string,
  index: number,
  components: number,
  source: number,
  store: number,
  spread = 0,
  packed = 0,
): SpawnAttribute {
  return { key, index, offset: 0, components, source, spread, packed, store };
}

// A small layout with one attribute of each shape a spawn handles: a spread
// scalar, the velocity point, the tint, the clock, a packed constant and a
// two-component custom. Twelve floats a vertex, four slots.
const STRIDE = 12;
const CAPACITY = 4;
const ATTRIBUTES: SpawnAttribute[] = [
  attribute('life', 3, 1, FROM_SPREAD, AS_F32, 0),
  attribute('velocity', 4, 3, FROM_VELOCITY, AS_F32),
  attribute('alpha', 7, 1, FROM_SPREAD, AS_TINT, 8),
  attribute('', 8, 1, FROM_CLOCK, AS_F32),
  attribute('', 9, 1, FROM_PACKED, AS_PACKED, 0, 0x80ff0000),
  attribute('aTwo', 10, 2, FROM_ZERO, AS_F32),
];
const SHAPE = { floatStride: STRIDE, world: false, randomFrames: false };

function makeContext(capacity = CAPACITY): SpawnContext {
  const words = new ArrayBuffer(CAPACITY * 4 * STRIDE * 4);
  const spreads = new Float32Array(16);

  // life 2..4, speed fixed at 1 (no draw), alpha fixed at 1.
  spreads.set([2, 4, 1, 1], 0);
  spreads.set([1, 1], 8);

  return {
    rng: () => 0.5,
    spreads,
    shape: {
      sample: (_rng, pos, dir) => {
        pos.set(1, 2, 3);
        dir.set(0, 1, 0);
      },
    },
    pos: new Vector3(),
    dir: new Vector3(),
    origin3: new Vector3(),
    worldTransform: new Matrix4(),
    packedFrames: new Uint16Array(4),
    frameCount: 1,
    packed: Uint32Array.from(ATTRIBUTES, (a) => a.packed),
    capacity,
    f32: new Float32Array(words),
    u32: new Uint32Array(words),
    u16: new Uint16Array(words),
  };
}

function makePlan(kinds: number[], position = ABSENT): SpawnPlan {
  return {
    kind: kinds,
    raw: kinds.map(() => undefined),
    lo: kinds.map(() => undefined),
    hi: kinds.map(() => undefined),
    position,
    positionRaw: undefined,
    positionLo: { x: 0, y: 0, z: 0 },
    positionHi: { x: 0, y: 0, z: 0 },
    packedColor: 0x00112233,
  };
}

/** The element `at` of each of a slot's four vertices */
function column(view: Float32Array | Uint32Array, slot: number, at: number): number[] {
  return [0, 1, 2, 3].map((v) => view[(slot * 4 + v) * STRIDE + at]);
}

// The generated function and its polyfill are one contract, so they take the
// same tests.
describe.each([
  ['generateSpawn', generateSpawn],
  ['generateSpawnPolyfill', generateSpawnPolyfill],
])('%s', (_name, create) => {
  it('writes every attribute of a slot across its four vertices from defaults', () => {
    const ctx = makeContext();
    const kinds = ATTRIBUTES.map(() => ABSENT);
    const spawn = create(ATTRIBUTES, kinds, ABSENT, SHAPE);

    expect(spawn(ctx, makePlan(kinds), 7.5, 0, 1)).toBe(1);

    expect(column(ctx.f32, 0, 0)).toEqual([1, 1, 1, 1]);
    expect(column(ctx.f32, 0, 1)).toEqual([2, 2, 2, 2]);
    expect(column(ctx.f32, 0, 2)).toEqual([3, 3, 3, 3]);
    // life 2..4 at r = 0.5
    expect(column(ctx.f32, 0, 3)).toEqual([3, 3, 3, 3]);
    // velocity = dir × speed 1
    expect(column(ctx.f32, 0, 4)).toEqual([0, 0, 0, 0]);
    expect(column(ctx.f32, 0, 5)).toEqual([1, 1, 1, 1]);
    expect(column(ctx.f32, 0, 6)).toEqual([0, 0, 0, 0]);
    // tint: the plan's rgb with alpha 1
    expect(column(ctx.u32, 0, 7)).toEqual(Array(4).fill(0xff112233));
    expect(column(ctx.f32, 0, 8)).toEqual([7.5, 7.5, 7.5, 7.5]);
    expect(column(ctx.u32, 0, 9)).toEqual(Array(4).fill(0x80ff0000));
    expect(column(ctx.f32, 0, 10)).toEqual([0, 0, 0, 0]);
    expect(column(ctx.f32, 0, 11)).toEqual([0, 0, 0, 0]);
  });

  it('takes each override kind: constant, pair, function and an explicit origin', () => {
    const ctx = makeContext();
    const kinds = [CONSTANT, PAIR, FUNCTION, ABSENT, ABSENT, CONSTANT];
    const plan = makePlan(kinds, CONSTANT);

    plan.raw[0] = 9;
    plan.lo[1] = { x: 1, y: 1, z: 1 };
    plan.hi[1] = { x: 3, y: 5, z: 7 };
    plan.raw[2] = (_rng: () => number, index: number) => (index === 2 ? 0.5 : 0);
    plan.raw[5] = { x: 0.25, y: 0.75 };
    plan.positionRaw = { x: 10, y: 20, z: 30 };

    const spawn = create(ATTRIBUTES, kinds, CONSTANT, SHAPE);

    expect(spawn(ctx, plan, 0, 2, 1)).toBe(3);

    // the origin is added to the shape's sample, with no transform
    expect(column(ctx.f32, 2, 0)).toEqual([11, 11, 11, 11]);
    expect(column(ctx.f32, 2, 1)).toEqual([22, 22, 22, 22]);
    expect(column(ctx.f32, 2, 2)).toEqual([33, 33, 33, 33]);
    expect(column(ctx.f32, 2, 3)).toEqual([9, 9, 9, 9]);
    expect(column(ctx.f32, 2, 4)).toEqual([2, 2, 2, 2]);
    expect(column(ctx.f32, 2, 5)).toEqual([3, 3, 3, 3]);
    expect(column(ctx.f32, 2, 6)).toEqual([4, 4, 4, 4]);
    // alpha 0.5 → 128
    expect(column(ctx.u32, 2, 7)).toEqual(Array(4).fill(0x80112233));
    expect(column(ctx.f32, 2, 10)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(column(ctx.f32, 2, 11)).toEqual([0.75, 0.75, 0.75, 0.75]);
    // untouched slots stay clear
    expect(column(ctx.f32, 0, 3)).toEqual([0, 0, 0, 0]);
  });

  it('wraps the cursor at the context capacity', () => {
    const ctx = makeContext(3);
    const kinds = ATTRIBUTES.map(() => ABSENT);
    const spawn = create(ATTRIBUTES, kinds, ABSENT, SHAPE);

    expect(spawn(ctx, makePlan(kinds), 1, 2, 3)).toBe(2);
    expect(column(ctx.f32, 2, 8)).toEqual([1, 1, 1, 1]);
    expect(column(ctx.f32, 1, 8)).toEqual([1, 1, 1, 1]);
    expect(column(ctx.f32, 3, 8)).toEqual([0, 0, 0, 0]);
  });
});

describe('generateSpawnBurst', () => {
  afterEach(() => setSpawnCodegen(true));

  it('shares one function across the same attributes and pattern, and no further', () => {
    const signature = spawnSignature(ATTRIBUTES, SHAPE);
    const absent = ATTRIBUTES.map(() => ABSENT);
    const first = generateSpawnBurst(signature, ATTRIBUTES, absent, ABSENT, SHAPE);

    // a copy of the same list with different objects still hits
    const copy = ATTRIBUTES.map((a) => ({ ...a }));

    expect(generateSpawnBurst(spawnSignature(copy, { ...SHAPE }), copy, [...absent], ABSENT, SHAPE)).toBe(first);

    // another pattern, another space, or the polyfill are other functions
    expect(generateSpawnBurst(signature, ATTRIBUTES, [CONSTANT, ...absent.slice(1)], ABSENT, SHAPE)).not.toBe(first);
    expect(generateSpawnBurst(signature, ATTRIBUTES, absent, PAIR, SHAPE)).not.toBe(first);

    const world = { ...SHAPE, world: true };

    expect(generateSpawnBurst(spawnSignature(ATTRIBUTES, world), ATTRIBUTES, absent, ABSENT, world)).not.toBe(first);

    setSpawnCodegen(false);
    expect(generateSpawnBurst(signature, ATTRIBUTES, absent, ABSENT, SHAPE)).not.toBe(first);
  });

  it('keys the signature on what shapes the code, not on the objects', () => {
    const shifted = ATTRIBUTES.map((a, i) => (i === 0 ? { ...a, index: 11 } : a));

    expect(spawnSignature(ATTRIBUTES, SHAPE)).toBe(spawnSignature([...ATTRIBUTES], { ...SHAPE }));
    expect(spawnSignature(shifted, SHAPE)).not.toBe(spawnSignature(ATTRIBUTES, SHAPE));
    expect(spawnSignature(ATTRIBUTES, { ...SHAPE, randomFrames: true })).not.toBe(spawnSignature(ATTRIBUTES, SHAPE));
  });
});

// ---------------------------------------------------------------------------
// Parity: the generated function and the polyfill must write the same bytes
// for the same seed, whatever the layout and whatever the overrides.
// ---------------------------------------------------------------------------

const customBit = {
  name: 'spawn-parity-custom',
  attributes: { aTwo: 'float32x2', aRgba: 'unorm8x4', aWide: 'unorm16x4', aSeed: 'float32' },
} satisfies ShaderBit;

function sheet(frames: number): Texture[] {
  const source = new TextureSource({ width: frames * 16, height: 16, resolution: 1 });

  return Array.from(
    { length: frames },
    (_, i) => new Texture({ source, frame: { x: i * 16, y: 0, width: 16, height: 16 } as never }),
  );
}

type Script = (system: ParticleSystem3D<readonly [typeof customBit]>) => void;

/** Builds a system, runs the script, and hands back a copy of its vertex words */
function run(codegen: boolean, options: ParticleSystem3DOptions, script: Script): Uint32Array {
  setSpawnCodegen(codegen);

  const system = new ParticleSystem3D({
    seed: 'parity',
    autoUpdate: false,
    capacity: 64,
    emitRate: 0,
    extraBits: [customBit],
    ...options,
  });

  script(system);

  const words = system.data.u32.slice();

  system.destroy();

  return words;
}

function expectParity(options: ParticleSystem3DOptions, script: Script): void {
  const generated = run(true, options, script);
  const polyfilled = run(false, options, script);

  expect(generated.some((w) => w !== 0)).toBe(true);
  expect(generated).toEqual(polyfilled);
}

describe('generated spawn parity with the polyfill', () => {
  afterEach(() => setSpawnCodegen(true));

  it('matches on the built-ins with emission and bursts', () => {
    expectParity(
      { emitRate: 120, life: [1, 2], speed: [1, 3], size: [0.1, 0.5], alpha: [0.2, 1], startRotation: [0, 6] },
      (s) => {
        s.spawn(5);
        for (let i = 0; i < 10; i++) s.update();
        s.spawn(20);
      },
    );
  });

  it('matches on every ramp with a world transform baked in', () => {
    expectParity(
      {
        shape: new BoxShape({ width: 2, height: 1, depth: 3 }),
        sizeEnd: [0, 1],
        alphaEnd: 0,
        spin: [-2, 2],
        color: 0x336699,
        colorEnd: 0x0000ff,
        gravity: 1,
      },
      (s) => {
        s.position.set(1, 2, 3);
        s.rotation.y = 0.7;
        s.spawn(30);
      },
    );
  });

  it('matches in local space', () => {
    expectParity({ space: 'local', spin: 1 }, (s) => {
      s.position.set(4, 5, 6);
      s.spawn(12);
    });
  });

  it('matches on random and animated flipbooks', () => {
    expectParity({ texture: sheet(4), frameMode: 'random' }, (s) => s.spawn(24));
    expectParity({ texture: sheet(4), frameMode: 'animate' }, (s) => s.spawn(24));
  });

  it('matches on constant, pair and function overrides of every attribute', () => {
    expectParity({ life: 2 }, (s) => {
      s.spawn(6, {
        position: { x: 1, y: 2, z: 3 },
        velocity: [
          { x: -1, y: 0, z: -1 },
          { x: 1, y: 2, z: 1 },
        ],
        life: (rng) => 1 + rng(),
        size: [0.1, 0.9],
        startRotation: 1.5,
        alpha: 0.4,
        color: 'orange',
        aTwo: { x: 0.25, y: 0.5 },
        aRgba: [
          { x: 0, y: 0, z: 0, w: 0 },
          { x: 1, y: 1, z: 1, w: 1 },
        ],
        aWide: (_rng, index) => ({ x: index / 64, y: 0.5, z: 0.25, w: 1 }),
        aSeed: (rng) => rng(),
      });
      s.spawn(6, {
        position: [
          { x: -1, y: -1, z: -1 },
          { x: 1, y: 1, z: 1 },
        ],
        velocity: { x: 0, y: 3, z: 0 },
        aTwo: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      });
      s.spawn(6, { position: (_rng, index) => ({ x: index, y: 0, z: 0 }), aSeed: 7 });
      // a pattern seen before must hit the cached function and still agree
      s.spawn(3, { velocity: { x: 1, y: 0, z: 0 } });
    });
  });

  it('matches across two systems that share one function', () => {
    setSpawnCodegen(true);

    const make = (capacity: number, colorEnd: number) =>
      new ParticleSystem3D({ seed: 'shared', autoUpdate: false, capacity, emitRate: 0, colorEnd });
    const a = make(8, 0xff0000);
    const b = make(5, 0x00ff00);

    // same attributes, so the same generated function; the capacity and the
    // packed end colour are each system's own
    a.spawn(7);
    b.spawn(7);

    const slotWords = 4 * a.data.floatStride;
    // offsets are bytes; the words are four apart
    const colorEndAt = a.data.offsets.aColorEnd / 4;

    expect(a.data.u32[colorEndAt]).not.toBe(b.data.u32[colorEndAt]);
    // b wrapped at five: its seventh spawn landed in slot one
    expect(b.data.f32[1 * slotWords + 3]).not.toBe(0);
    expect(a.data.f32[6 * slotWords + 3]).not.toBe(0);

    a.destroy();
    b.destroy();
  });
});
