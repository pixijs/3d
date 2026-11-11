import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { BoxShape } from '~/extras/particles/emitterShapes/BoxShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import type { ParticleSystem3DOptions } from '~/extras/particles/ParticleSystem3D';
import { generateSpawn } from '~/extras/particles/utils/generateSpawn';
import { generateSpawnBurst, spawnSignature } from '~/extras/particles/utils/generateSpawnBurst';
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
  PAIR,
} from '~/extras/particles/utils/spawnPlan';
import type { SpawnAttribute, SpawnContext, SpawnFn, SpawnPlan, SpawnShape } from '~/extras/particles/utils/spawnPlan';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { seededRandom } from '~/math/utils/seededRandom';
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

function makePlan(kinds: number[]): SpawnPlan {
  return {
    kind: kinds,
    raw: kinds.map(() => undefined),
    lo: kinds.map(() => undefined),
    hi: kinds.map(() => undefined),
    position: ABSENT,
    positionRaw: undefined,
    positionLo: { x: 0, y: 0, z: 0 },
    positionHi: { x: 0, y: 0, z: 0 },
    packedColor: 0x00112233,
  };
}

function column(view: Float32Array | Uint32Array, slot: number, at: number): number[] {
  return [0, 1, 2, 3].map((v) => view[(slot * 4 + v) * STRIDE + at]);
}

describe.each([
  ['generateSpawn', generateSpawn],
  ['generateSpawnPolyfill', generateSpawnPolyfill],
])('%s', (_name, create) => {
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
  it('shares one function across the same attributes and pattern, and no further', () => {
    const signature = spawnSignature(ATTRIBUTES, SHAPE);
    const absent = ATTRIBUTES.map(() => ABSENT);
    const first = generateSpawnBurst(signature, ATTRIBUTES, absent, ABSENT, SHAPE);

    const copy = ATTRIBUTES.map((a) => ({ ...a }));

    expect(
      generateSpawnBurst(spawnSignature(copy, { ...SHAPE }), copy, [...absent], ABSENT, SHAPE),
      'a copy of the same list, made of other objects',
    ).toBe(first);

    expect(
      generateSpawnBurst(signature, ATTRIBUTES, [CONSTANT, ...absent.slice(1)], ABSENT, SHAPE),
      'another override pattern',
    ).not.toBe(first);
    expect(generateSpawnBurst(signature, ATTRIBUTES, absent, PAIR, SHAPE), 'another position kind').not.toBe(first);

    const world = { ...SHAPE, world: true };

    expect(
      generateSpawnBurst(spawnSignature(ATTRIBUTES, world), ATTRIBUTES, absent, ABSENT, world),
      'another space',
    ).not.toBe(first);
  });

  it('keys the signature on what shapes the code, not on the objects', () => {
    const shifted = ATTRIBUTES.map((a, i) => (i === 0 ? { ...a, index: 11 } : a));

    expect(spawnSignature(ATTRIBUTES, SHAPE)).toBe(spawnSignature([...ATTRIBUTES], { ...SHAPE }));
    expect(spawnSignature(shifted, SHAPE)).not.toBe(spawnSignature(ATTRIBUTES, SHAPE));
    expect(spawnSignature(ATTRIBUTES, { ...SHAPE, randomFrames: true })).not.toBe(spawnSignature(ATTRIBUTES, SHAPE));
  });
});

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

interface SpawnInternals {
  _spawns: Map<string, SpawnFn>;
  _spawnAttributes: readonly SpawnAttribute[];
  _spawnShape: SpawnShape;
  _plan: SpawnPlan;
}

function usePolyfill(system: ParticleSystem3D<readonly [typeof customBit]>): void {
  const internals = system as unknown as SpawnInternals;

  internals._spawns.get = () =>
    generateSpawnPolyfill(
      internals._spawnAttributes,
      internals._plan.kind,
      internals._plan.position,
      internals._spawnShape,
    );
}

function run(polyfill: boolean, options: ParticleSystem3DOptions, script: Script): Uint32Array {
  const system = new ParticleSystem3D({
    createRandom: () => seededRandom('parity'),
    autoUpdate: false,
    capacity: 64,
    emitRate: 0,
    extraBits: [customBit],
    ...options,
  });

  if (polyfill) usePolyfill(system);
  script(system);

  const words = system.data.u32.slice();

  system.destroy();

  return words;
}

function expectParity(options: ParticleSystem3DOptions, script: Script): void {
  const generated = run(false, options, script);
  const polyfilled = run(true, options, script);

  expect(generated.some((w) => w !== 0)).toBe(true);
  expect(generated).toEqual(polyfilled);
}

describe('generated spawn parity with the polyfill', () => {
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
      s.spawn(3, { velocity: { x: 1, y: 0, z: 0 } });
    });
  });

  it('matches when a later burst reuses a pattern with new values', () => {
    expectParity({ life: 2 }, (s) => {
      s.spawn(4, { velocity: { x: 1, y: 0, z: 0 }, size: [0.1, 0.2] });
      s.spawn(4, { velocity: { x: 0, y: 0, z: 2 }, size: [0.5, 0.9] });
    });
  });

  it("keeps each system's capacity and end colour when two systems share one generated function", () => {
    const make = (capacity: number, colorEnd: number) =>
      new ParticleSystem3D({
        createRandom: () => seededRandom('shared'),
        autoUpdate: false,
        capacity,
        emitRate: 0,
        colorEnd,
      });
    const a = make(8, 0xff0000);
    const b = make(5, 0x00ff00);

    a.spawn(7);
    b.spawn(7);

    const slotWords = 4 * a.data.floatStride;
    const colorEndWord = a.data.offsets.aColorEnd / 4;

    expect(a.data.u32[colorEndWord]).not.toBe(b.data.u32[colorEndWord]);
    expect(b.data.f32[1 * slotWords + 3], 'b wraps at five, so its seventh spawn lands in slot one').not.toBe(0);
    expect(a.data.f32[6 * slotWords + 3]).not.toBe(0);

    a.destroy();
    b.destroy();
  });
});
