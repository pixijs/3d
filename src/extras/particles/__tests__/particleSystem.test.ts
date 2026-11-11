import { Texture, TextureSource, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PointShape } from '~/extras/particles/emitterShapes/PointShape';
import { SphereShape } from '~/extras/particles/emitterShapes/SphereShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import type { ParticleSystem3DOptions } from '~/extras/particles/ParticleSystem3D';
import { seededRandom } from '~/math/utils/seededRandom';
import { Container3D } from '~/scene/Container3D';
import { packParticleColor } from '~/scene/particles/utils/packParticleColor';

const STEP = 1 / 60;

const ticker = new Ticker();

function step(system: ParticleSystem3D, seconds: number): void {
  ticker.deltaMS = seconds * 1000;
  system.update(ticker);
}

function makeSystem(options: ParticleSystem3DOptions = {}): ParticleSystem3D {
  return new ParticleSystem3D({
    createRandom: () => seededRandom('test'),
    autoUpdate: false,
    capacity: 8,
    emitRate: 0,
    ...options,
  });
}

function sizeAt(system: ParticleSystem3D, index: number): number {
  return system.data.f32[index * 4 * system.data.floatStride + 3];
}

function positionAt(system: ParticleSystem3D, index: number): [number, number, number] {
  const o = index * 4 * system.data.floatStride;
  const f = system.data.f32;

  return [f[o], f[o + 1], f[o + 2]];
}

function laneAt(system: ParticleSystem3D, index: number, name: string, component = 0): number {
  return system.data.f32[index * 4 * system.data.floatStride + system.data.offsets[name] / 4 + component];
}

function writtenCount(system: ParticleSystem3D): number {
  let n = 0;

  for (let i = 0; i < system.capacity; i++) if (sizeAt(system, i) > 0) n++;

  return n;
}

function sheet(frames: number): Texture[] {
  const source = new TextureSource({ width: frames * 16, height: 16, resolution: 1 });

  return Array.from(
    { length: frames },
    (_, i) => new Texture({ source, frame: { x: i * 16, y: 0, width: 16, height: 16 } as never }),
  );
}

describe('ParticleSystem3D', () => {
  it("picks up a parent's transform, and a move since the last spawn, with no render pass", () => {
    const parent = new Container3D();
    const system = makeSystem({ shape: new PointShape(), speed: 0 });

    parent.position.set(10, 0, 0);
    parent.addChild(system);
    system.position.set(1, 2, 3);
    system.spawn(1);

    expect(positionAt(system, 0).map((v) => Math.round(v * 1000) / 1000)).toEqual([11, 2, 3]);

    system.position.x = 5;
    system.spawn(1);

    expect(positionAt(system, 1)[0]).toBeCloseTo(15);

    system.destroy();
  });

  it('spends the emission accumulator on whole particles', () => {
    const system = makeSystem({ emitRate: 30, life: 10 });

    system.update();
    expect(writtenCount(system), 'half a particle owed').toBe(0);

    step(system, STEP);
    expect(writtenCount(system)).toBe(1);

    step(system, STEP * 4);
    expect(writtenCount(system)).toBe(3);

    system.destroy();
  });

  it('scrubs the clock through time, stamping later births from there', () => {
    const system = makeSystem({ life: 100 });

    for (let i = 0; i < 30; i++) step(system, 0.1);
    expect(system.time).toBeCloseTo(3);

    system.time = 1;
    expect(system.uniforms.uParticleTime).toBeCloseTo(1);

    system.spawn(1);
    expect(laneAt(system, 0, 'aBirth')).toBeCloseTo(1);

    step(system, 0.05);
    expect(system.time).toBeCloseTo(1.05);

    system.destroy();
  });

  it('never rewinds the clock, so gotoAndPlay(0) cannot kill live particles', () => {
    const system = makeSystem({ life: 100 });

    system.time = 1;
    system.spawn(1);
    system.gotoAndPlay(0);
    step(system, 0.1);

    expect(system.uniforms.uParticleTime).toBeCloseTo(1.1);
    expect(laneAt(system, 0, 'aBirth')).toBeCloseTo(1);

    system.destroy();
  });

  it('recycles the oldest slot when the pool is full', () => {
    const system = makeSystem({ capacity: 4, life: 100, size: 1 });

    for (let i = 0; i < 4; i++) system.spawn(1, { position: { x: i, y: 0, z: 0 } });
    expect(positionAt(system, 0)[0]).toBeCloseTo(0);

    system.spawn(1, { position: { x: 99, y: 0, z: 0 } });
    expect(writtenCount(system)).toBe(4);
    expect(positionAt(system, 0)[0], 'slot 0 held the oldest, so the fifth spawn lands there').toBeCloseTo(99);

    system.destroy();
  });

  it('stops emitting on stop() and resumes on play(), with the clock running throughout', () => {
    const system = makeSystem({ emitRate: 60, life: 100, capacity: 32 });

    expect(system.playing).toBe(true);
    for (let i = 0; i < 6; i++) system.update();
    expect(writtenCount(system)).toBe(6);

    system.stop();
    expect(system.playing).toBe(false);
    for (let i = 0; i < 6; i++) system.update();
    expect(writtenCount(system)).toBe(6);
    expect(system.time).toBeCloseTo(12 * STEP);

    system.play();
    for (let i = 0; i < 6; i++) system.update();
    expect(writtenCount(system)).toBe(12);

    system.destroy();
  });

  it('waits for play() when autoPlay is off', () => {
    const system = makeSystem({ autoPlay: false, emitRate: 60, life: 100, bursts: [{ time: 0, count: 2 }] });

    expect(system.playing).toBe(false);
    for (let i = 0; i < 3; i++) system.update();
    expect(writtenCount(system)).toBe(0);

    system.play();
    system.update();
    expect(writtenCount(system)).toBe(3);

    system.destroy();
  });

  it('freezes the burst timeline on stop() and resumes it on play() without rewinding', () => {
    const system = makeSystem({
      life: 100,
      capacity: 32,
      bursts: [
        { time: 0.05, count: 3 },
        { time: 0.15, count: 2 },
      ],
    });

    step(system, 0.1);
    expect(writtenCount(system)).toBe(3);

    system.stop();
    for (let i = 0; i < 3; i++) step(system, 0.1);
    expect(writtenCount(system), 'stopped, the timeline holds at 0.1, so the 0.15 burst waits').toBe(3);

    system.play();
    step(system, 0.1);
    expect(writtenCount(system), "resumed, it fires; the one already spent doesn't fire again").toBe(5);

    system.destroy();
  });

  it('jumps the burst timeline with gotoAndPlay and gotoAndStop', () => {
    const system = makeSystem({
      life: 100,
      capacity: 64,
      bursts: [
        { time: 0, count: 1 },
        { time: 0.1, count: 4, repeatEvery: 0.2 },
      ],
    });

    system.gotoAndStop(0.2);
    expect(system.playing).toBe(false);
    step(system, 0.1);
    expect(
      writtenCount(system),
      'past the one-shot and the first repeat, both count as spent, and nothing emits while stopped',
    ).toBe(0);

    system.play();
    step(system, 0.05);
    expect(writtenCount(system), 'played from 0.2, the next repeat is due at 0.3').toBe(0);
    step(system, 0.06);
    expect(writtenCount(system)).toBe(4);

    system.gotoAndPlay(0);
    expect(system.playing).toBe(true);
    step(system, 0.05);
    expect(writtenCount(system), 'back at the start, the one-shot fires again').toBe(5);
    step(system, 0.06);
    expect(writtenCount(system), 'then the first repeat').toBe(9);

    system.destroy();
  });

  it('replays the same particles after gotoAndPlay(0)', () => {
    const system = makeSystem({
      capacity: 32,
      emitRate: 40,
      life: [1, 2],
      speed: [1, 3],
      shape: new SphereShape({ radius: 1 }),
      bursts: [{ time: 0.1, count: 4 }],
    });
    const run = (): Uint8Array => {
      for (let i = 0; i < 12; i++) system.update();

      return new Uint8Array(system.data.f32.buffer.slice(0));
    };
    const first = run();

    system.clear();
    system.time = 0;
    system.gotoAndPlay(0);

    expect(run()).toEqual(first);

    system.destroy();
  });

  it('restarts the random stream on every seek, and not when the clock is scrubbed', () => {
    const createRandom = vi.fn<() => () => number>(() => seededRandom('seek'));
    const system = makeSystem({ createRandom, life: 100, speed: [1, 3], shape: new SphereShape({ radius: 1 }) });

    system.spawn(1);
    const first = positionAt(system, 0);

    system.update();
    system.time = 0;
    system.spawn(1);
    expect(positionAt(system, 1), 'scrubbing the clock carries the stream on').not.toEqual(first);

    system.gotoAndStop(3);
    system.spawn(1);
    expect(positionAt(system, 2), 'gotoAndStop starts it over, whatever the time').toEqual(first);
    expect(createRandom).toHaveBeenCalledTimes(2);

    system.destroy();
  });

  it('calls onUpdate after each step, swappable at runtime and released on destroy', () => {
    const system = makeSystem({ emitRate: 60, life: 100 });
    const calls: number[] = [];

    expect(system.onUpdate).toBeNull();

    system.onUpdate = (dt, self) => {
      expect(self).toBe(system);
      calls.push(dt);
    };
    step(system, 0.05);
    system.stop();
    step(system, 0.02);
    expect(calls.map((dt) => Math.round(dt * 1000))).toEqual([50, 20]);

    system.onUpdate = null;
    step(system, 0.05);
    expect(calls.length).toBe(2);

    const fromOptions = makeSystem({ onUpdate: () => calls.push(-1) });

    fromOptions.update();
    expect(calls.length).toBe(3);

    fromOptions.destroy();
    expect(fromOptions.onUpdate).toBeNull();
    system.destroy();
  });

  it('clears every written slot', () => {
    const system = makeSystem({ life: 100 });

    system.spawn(5);
    expect(writtenCount(system)).toBe(5);

    system.clear();
    expect(writtenCount(system)).toBe(0);
    expect(laneAt(system, 0, 'aLife')).toBe(0);

    system.destroy();
  });

  it('honours overridden position, velocity and size', () => {
    const system = makeSystem({ life: 100, speed: 10, shape: new PointShape() });

    system.spawn(1, { position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 }, size: 0.25 });

    expect(positionAt(system, 0)).toEqual([1, 2, 3]);
    expect(sizeAt(system, 0)).toBeCloseTo(0.25);
    expect([laneAt(system, 0, 'aVel'), laneAt(system, 0, 'aVel', 1), laneAt(system, 0, 'aVel', 2)]).toEqual([4, 5, 6]);

    system.destroy();
  });

  it('scatters an overridden spawn point with the shape, ignoring the emitter transform', () => {
    const system = makeSystem({ life: 100, speed: 0, shape: new SphereShape({ radius: 0.5, shell: true }) });

    system.position.set(100, 0, 0);
    system.spawn(1, { position: { x: 1, y: 2, z: 3 } });

    const [x, y, z] = positionAt(system, 0);
    const offset = Math.hypot(x - 1, y - 2, z - 3);

    expect(offset).toBeCloseTo(0.5, 4);

    system.destroy();
  });

  it('leaves out the bits and attributes its options do not ask for', () => {
    const plain = makeSystem({ life: 1 });
    const ramped = makeSystem({ life: 1, sizeEnd: 0, spin: 1 });

    expect(plain.data.offsets.aSizeEnd).toBeUndefined();
    expect(plain.data.offsets.aSpin).toBeUndefined();
    expect(ramped.data.offsets.aSizeEnd).toBeDefined();
    expect(ramped.data.offsets.aSpin).toBeDefined();

    plain.destroy();
    ramped.destroy();
  });

  it('drives gravity and drag as uniforms rather than recompiling', () => {
    const system = makeSystem({ life: 100, gravity: 10, drag: 0.5 });

    expect(system.gravity!.y).toBe(-10);
    expect(Array.from(system.uniforms.uGravity as Float32Array)).toEqual([0, -10, 0]);
    expect(system.uniforms.uDrag).toBe(0.5);

    system.gravity = { x: 1, y: 2, z: 3 };
    system.drag = null;

    expect(Array.from(system.uniforms.uGravity as Float32Array)).toEqual([1, 2, 3]);
    expect(system.uniforms.uDrag).toBe(0);

    system.destroy();
  });

  it('replays identically from the same seed and differs from another', () => {
    const run = (seed: string): Uint8Array => {
      const system = new ParticleSystem3D({
        createRandom: () => seededRandom(seed),
        autoUpdate: false,
        capacity: 32,
        emitRate: 40,
        life: [1, 2],
        speed: [1, 3],
        shape: new SphereShape({ radius: 1 }),
      });

      for (let i = 0; i < 24; i++) system.update();

      const bytes = new Uint8Array(system.data.f32.buffer.slice(0));

      system.destroy();

      return bytes;
    };

    expect(run('same')).toEqual(run('same'));
    expect(run('same')).not.toEqual(run('other'));
  });

  it('calls spawn functions with the place in the burst, wherever the pool cursor is', () => {
    const system = makeSystem({ capacity: 8 });
    const positions = [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ];

    system.spawn(6);
    system.spawn(3, { position: (_rng, i) => positions[i] });

    expect(positionAt(system, 6)).toEqual([1, 0, 0]);
    expect(positionAt(system, 7)).toEqual([2, 0, 0]);
    expect(positionAt(system, 0), 'the burst wraps the pool').toEqual([3, 0, 0]);

    system.destroy();
  });

  it('takes sizeEnd, alphaEnd and spin per spawn when the system composes them', () => {
    const system = makeSystem({ life: 1, sizeEnd: 1, alphaEnd: 0, spin: 1 });

    system.spawn(1, { sizeEnd: 4.5, alphaEnd: 0.25, spin: 2 });
    system.spawn(1);

    expect(laneAt(system, 0, 'aSizeEnd')).toBe(4.5);
    expect(laneAt(system, 0, 'aAlphaEnd')).toBe(0.25);
    expect(laneAt(system, 0, 'aSpin')).toBe(2);
    expect(laneAt(system, 1, 'aSizeEnd')).toBe(1);
    expect(laneAt(system, 1, 'aAlphaEnd')).toBe(0);
    expect(laneAt(system, 1, 'aSpin')).toBe(1);

    const plain = makeSystem({ life: 1 });

    expect(() => plain.spawn(1, { sizeEnd: 2 })).toThrow(/nothing takes 'sizeEnd'/);

    system.destroy();
    plain.destroy();
  });

  it('takes colorEnd per spawn for that burst only, leaving emission on the system colour', () => {
    const system = makeSystem({ life: 10, colorEnd: 0xff0000, emitRate: 30 });
    const colorEndAt = (index: number): number =>
      system.data.u32[index * 4 * system.data.floatStride + system.data.offsets.aColorEnd / 4];

    system.spawn(1, { colorEnd: '#00ff00' });
    system.spawn(1, { colorEnd: 0x0000ff });
    step(system, STEP * 2);

    expect(writtenCount(system)).toBe(3);
    expect(colorEndAt(0)).toBe(packParticleColor(0x00ff00, 1));
    expect(colorEndAt(1)).toBe(packParticleColor(0x0000ff, 1));
    expect(colorEndAt(2)).toBe(packParticleColor(0xff0000, 1));

    system.destroy();
  });

  it('binds a shader flipbook as one sheet with its grid, and a random one as frames', () => {
    const overLife = makeSystem({ texture: sheet(4), frameMode: 'overLife' });
    const random = makeSystem({ texture: sheet(4), frameMode: 'random' });

    expect(overLife.textures.length).toBe(1);
    expect(Array.from(overLife.uniforms.uFlipbookGrid as Float32Array)).toEqual([4, 1, 4]);
    expect(overLife.data.offsets.aParticleUVFrame).toBeUndefined();

    expect(random.textures.length).toBe(4);
    expect(random.data.offsets.aParticleUVFrame).toBeDefined();

    overLife.destroy();
    random.destroy();
  });
});

describe('ParticleSystem3D guards and lifecycle', () => {
  it('rejects an override nothing takes, and one shaped wrong for its attribute', () => {
    const system = makeSystem({ life: 1 });

    expect(() => system.spawn(1, { speed: 3 })).toThrow(/nothing takes 'speed'/);
    expect(() => system.spawn(1, { velocity: 5 as never })).toThrow(/velocity/);
    expect(() => system.spawn(1, { life: [1, { x: 0 }] as never })).toThrow(/life/);
    expect(() => system.spawn(1, { position: [{ x: 0, y: 0, z: 0 }, 2] as never })).toThrow(/position/);
    expect(writtenCount(system)).toBe(0);

    system.spawn(1, { life: [1, 2], velocity: { x: 1, y: 0, z: 0 } });
    expect(writtenCount(system)).toBe(1);

    system.destroy();
  });

  it('keeps a built-in a user bit redeclares to type setParticle', () => {
    const typed = { name: 'redeclares-size', attributes: { aParticleSizeRot: 'float32x2' } } satisfies ShaderBit;
    const system = makeSystem({ size: 0.7, startRotation: 0.3, extraBits: [typed] });

    system.spawn(1);

    expect(sizeAt(system, 0)).toBeCloseTo(0.7);
    expect(laneAt(system, 0, 'aParticleSizeRot', 1)).toBeCloseTo(0.3);

    system.destroy();
  });

  it('spawns no more than the capacity in one call, ignores an empty tick and caps a long one', () => {
    const system = makeSystem({ capacity: 8, life: 100 });

    system.spawn(20);
    expect(writtenCount(system)).toBe(8);

    step(system, 0.05);
    step(system, 0);
    step(system, NaN);
    expect(system.time).toBeCloseTo(0.05);

    step(system, 300);
    expect(
      system.time,
      "a backgrounded tab's frame advances a tenth of a second, not the minutes it was away",
    ).toBeCloseTo(0.15);

    system.destroy();
  });

  it("caps a repeating burst's catch-up at a pool's worth", () => {
    const system = makeSystem({
      capacity: 8,
      bursts: [{ time: 0, count: 2, repeatEvery: 0.001 }],
    });
    const spawn = vi.spyOn(system, 'spawn');

    step(system, 0.1);

    expect(spawn, 'a hundred repeats were owed; only four bursts of two can survive').toHaveBeenCalledTimes(4);
    expect(writtenCount(system)).toBe(8);

    spawn.mockClear();
    step(system, 0.0005);
    expect(spawn, 'the schedule resumes from the present, not from the missed repeats').not.toHaveBeenCalled();
    step(system, 0.001);
    expect(spawn).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it('refuses a non-finite seek and leaves the burst timeline where it was', () => {
    const system = makeSystem({ life: 100, bursts: [{ time: 0, count: 2, repeatEvery: 0.1 }] });
    const spawn = vi.spyOn(system, 'spawn');

    system.gotoAndStop(0.05);
    step(system, 0.05);
    const clock = system.time;

    expect(() => system.gotoAndPlay(Infinity)).toThrow(RangeError);
    expect(() => system.gotoAndPlay(NaN)).toThrow(RangeError);
    expect(() => system.gotoAndStop(-Infinity)).toThrow(RangeError);
    expect(system.playing).toBe(false);
    expect(system.time).toBe(clock);
    expect(spawn).not.toHaveBeenCalled();

    system.play();
    step(system, 0.04);
    expect(spawn, 'still at 0.05, so nothing is due before 0.1').not.toHaveBeenCalled();
    step(system, 0.02);
    expect(spawn, 'the repeat due at 0.1 fires on schedule').toHaveBeenCalledTimes(1);
    expect(writtenCount(system)).toBe(2);

    system.gotoAndPlay(0);
    step(system, 0.01);
    expect(spawn, 'a finite seek still moves the timeline').toHaveBeenCalledTimes(2);

    system.destroy();
  });

  it('has no size options: the quads take shape in the shader, so there are no bounds to size against', () => {
    // @ts-expect-error width, height and depth are omitted from ParticleContainer3DOptions
    const system = makeSystem({ width: 2 });

    expect(system.scale.x).toBe(1);

    system.destroy();
  });

  it("frees the sheet wrapper it made for a grid flipbook, not the caller's source", () => {
    const frames = sheet(4);
    const system = makeSystem({ texture: frames, frameMode: 'animate' });
    const bound = system.textures[0];
    let destroyed = false;

    bound.once('destroy', () => {
      destroyed = true;
    });

    expect(bound).not.toBe(frames[0]);
    expect(bound.frame.width).toBe(frames[0].source.width);

    system.destroy();

    expect(destroyed).toBe(true);
    expect(frames[0].source.destroyed).toBe(false);
  });

  it("points the shape's direction the way the emitter is rotated, even for a placed spawn", () => {
    const system = makeSystem({ speed: 2, shape: new PointShape() });

    system.rotation.x = Math.PI / 2;
    system.spawn(1, { position: { x: 5, y: 5, z: 5 } });

    expect(laneAt(system, 0, 'aVel', 1), 'a quarter turn about X takes the +Y PointShape direction to ±Z').toBeCloseTo(
      0,
    );
    expect(Math.abs(laneAt(system, 0, 'aVel', 2))).toBeCloseTo(2);
    expect(positionAt(system, 0)).toEqual([5, 5, 5]);

    system.destroy();
  });

  it('steps itself on the shared ticker only while autoUpdate is on, and never after destroy', () => {
    const before = Ticker.shared.count;
    const system = new ParticleSystem3D({ createRandom: () => seededRandom('ticker'), capacity: 4, emitRate: 0 });

    expect(Ticker.shared.count).toBe(before + 1);

    system.autoUpdate = false;
    expect(Ticker.shared.count).toBe(before);

    system.autoUpdate = true;
    expect(Ticker.shared.count).toBe(before + 1);

    system.destroy();
    expect(Ticker.shared.count).toBe(before);
  });

  it('steps after the frame moved the emitter and before the render', () => {
    const system = new ParticleSystem3D({
      createRandom: () => seededRandom('order'),
      capacity: 4,
      emitRate: 0,
      life: 100,
      bursts: [{ time: 0, count: 1 }],
    });
    const order: string[] = [];
    const move = (): void => {
      order.push('move');
      system.position.x += 1;
    };
    const render = (): void => {
      order.push('render');
    };

    system.onUpdate = () => {
      order.push('particles');
    };

    Ticker.shared.add(move, undefined, UPDATE_PRIORITY.NORMAL);
    Ticker.shared.add(render, undefined, UPDATE_PRIORITY.LOW);
    Ticker.shared.update(Ticker.shared.lastTime + 16);
    Ticker.shared.remove(move);
    Ticker.shared.remove(render);

    expect(order).toEqual(['move', 'particles', 'render']);
    expect(
      positionAt(system, 0)[0],
      "the burst baked this frame's emitter position, not the one it had before `move` ran",
    ).toBeCloseTo(1);

    system.destroy();
  });

  it('keeps a default under an explicit undefined', () => {
    const system = makeSystem({ emitRate: undefined, frameRate: undefined, color: undefined, shape: undefined });

    expect(system.emitRate).toBe(ParticleSystem3D.defaultOptions.emitRate);
    expect(system.frameRate).toBe(ParticleSystem3D.defaultOptions.frameRate);
    expect(system.shape).toBe(ParticleSystem3D.defaultOptions.shape);

    system.spawn(1);
    expect(system.data.u32[system.data.offsets.aParticleColor / 4] & 0xffffff).toBe(0xffffff);

    system.destroy();
  });

  it('forwards the container options and keeps its own off the node', () => {
    const parent = new Container3D();
    const system = makeSystem({ gravity: 2, cursor: 'pointer', parent, rotation: { x: 0, y: 0.5, z: 0 } });

    expect(system.label).toBe('ParticleSystem3D');
    expect(system.parent).toBe(parent);
    expect(system.rotation.y).toBeCloseTo(0.5);
    expect(system.cursor).toBe('pointer');
    expect(system.gravity!.y).toBe(-2);
    expect(Object.hasOwn(system, 'createRandom')).toBe(false);
    expect(Object.hasOwn(system, 'life')).toBe(false);

    parent.destroy({ children: true });
  });

  it('writes a new frame rate through to the shader', () => {
    const system = makeSystem({ texture: sheet(4), frameMode: 'animate', frameRate: 12 });

    expect(system.uniforms.uFrameRate).toBe(12);
    system.frameRate = 24;
    expect(system.uniforms.uFrameRate).toBe(24);

    system.destroy();
  });
});
