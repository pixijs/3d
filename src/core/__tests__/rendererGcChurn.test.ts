import { getApp } from '@test-utils';
import { CanvasSource, Sprite, Texture, TexturePool, Ticker } from 'pixi.js';
import type { Application, Renderer, TextureSource, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { DEPTH_EMPTY } from '~/core/textures/DefaultTextures';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/*
 * Churn probe: builds a fresh shadowed scene, runs it through every release path the engine has
 * (pixi's GC collecting the View, `unload()`, emptying it, `destroy()`), and does that many times.
 * Two samples of every resource count the engine owns are taken, one after a warm-up and one at
 * the end, and nothing may have moved between them. The table it prints is the point as much as
 * the assertions: it puts numbers on what one create/render/collect/destroy cycle leaves behind.
 * Three rows used to be tolerated as known pixi leaks (both render-target hashes and the WebGPU
 * bind-group cache); pixi #12190-#12194 fixed them upstream, so every metric is asserted flat.
 */

const SIZE = 96;
/** Cycles before the first sample, so lazily created singletons (BRDF LUT, shaders, pipelines) are in. */
const WARMUP = 5;
/** Cycles between the two samples; the slope is per one of these. */
const CYCLES = 40;
/** Every Nth cycle swaps the shadow tier mid-cycle so the map re-creation path churns too. */
const FLIP_PERIOD = 5;

/** A collectable texture — pixi only auto-collects sources that opt in. */
function makeCollectableTexture(color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);

  const texture = new Texture({ source: new CanvasSource({ resource: canvas }) });
  texture.source.autoGarbageCollect = true;
  return texture;
}

/** A triangle with one morph target, so the morph store's delta arena and weight slots churn. */
function morphedTriangle(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    morphTargets: [{ positions: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) }],
  });
}

/** Anything carrying pixi's GC idle clock — a texture source, a buffer, or a View3D. */
interface GcClocked {
  _gcLastUsed: number;
}

/** How many renderers hold a GPU copy of this resource — 0 once it has been collected. */
function gpuCopies(resource: TextureSource): number {
  const gpuData = (resource as unknown as { _gpuData: Record<number, unknown> })._gpuData;
  let n = 0;
  for (const uid in gpuData) {
    if (gpuData[uid]) n++;
  }
  return n;
}

/**
 * Sweep after backdating `stale`'s clocks, so only those age out and everything the last frame
 * touched survives. No real time passes: pixi's own threshold is 60s.
 */
function collectStale(renderer: Renderer, ...stale: GcClocked[]): void {
  // pixi's own 60 s threshold stays: nothing this test creates is ever a minute idle, so only the
  // backdated resources qualify and the sweep does not depend on how long the run has taken.
  for (const resource of stale) resource._gcLastUsed = performance.now() - 100_000;

  // pixi's WebGPU bind-group cache is swept on the same clock. Backdating every cached native bind
  // group lets the sweep drop the ones whose resources died this cycle instead of leaving them
  // orphaned; anything still drawn is simply recreated on its next bind.
  const bindGroupHash = (renderer as unknown as { bindGroup?: { _hash: Record<string, GcClocked | null> } }).bindGroup
    ?._hash;
  if (bindGroupHash) {
    for (const key in bindGroupHash) {
      const entry = bindGroupHash[key];
      if (entry) entry._gcLastUsed = performance.now() - 100_000;
    }
  }
  renderer.gc.run();
}

/**
 * Renders one frame, returning the WebGPU validation error it raised (always `null` on WebGL).
 * The first `onSubmittedWorkDone` drains earlier frames so their errors can't land in this scope,
 * the second makes sure this frame's work is done before the pop.
 */
async function renderCatchingValidationErrors(app: Application<Renderer>): Promise<GPUError | null> {
  const device = 'gpu' in app.renderer ? (app.renderer as WebGPURenderer).gpu.device : null;
  if (!device) {
    app.render();
    return null;
  }

  await device.queue.onSubmittedWorkDone();
  device.pushErrorScope('validation');
  app.render();
  await device.queue.onSubmittedWorkDone();
  return device.popErrorScope();
}

/**
 * A View that stays on the stage for the whole run, drawn every frame and never collected. The
 * samples read what the renderer keeps on it: one payload, the same object throughout.
 */
function buildResidentView(app: Application<Renderer>): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.5 }),
  });
  view3d.root.addChild(cube);
  view3d.camera.position.set(0, 0, 5);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  app.stage.addChild(view3d);
  return view3d;
}

interface CycleScene {
  view3d: View3D;
  sun: DirectionalLight;
  texture: Texture;
  dynamicGeometry: CubeGeometry;
  meshes: Mesh3D[];
  batched: BatchedMesh3D;
}

/**
 * One cycle's scene, built from fresh objects so every destroy path runs: a ground receiver, a
 * textured caster (collectable texture), a caster on a `dynamic` geometry (its own GPU buffers,
 * never atlased), a morphed mesh, a one-slot batch, and a shadow-casting sun.
 */
function buildCycleScene(app: Application<Renderer>): CycleScene {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -1.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);

  const texture = makeCollectableTexture('#ff8800');
  const textured = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
    material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });

  const dynamicGeometry = new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true });
  const dynamic = new Mesh3D({
    geometry: dynamicGeometry,
    material: new Material3D({ baseColor: 0x3366ff, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  dynamic.position.set(-2.5, 0, 0);

  const morphed = new Mesh3D({
    geometry: morphedTriangle(),
    material: new Material3D({ baseColor: 0x33ff66, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  morphed.position.set(2.5, 0, 0);
  morphed.weights![0] = 0.5;

  const batched = new BatchedMesh3D({ size: 1 });
  batched.setGeometryAt(0, new CubeGeometry({ width: 1, height: 1, depth: 1 }));
  batched.setMaterialAt(0, new Material3D({ baseColor: 0xff3366, metallic: 0, roughness: 0.5 }));
  batched.setMatrixAt(0, new Matrix4().makeTranslation(0, 1.5, -2.5));
  batched.setItemActive(0, RenderPassBit.OPAQUE);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4, castShadow: true });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);

  view3d.root.addChild(ground, textured, dynamic, morphed, batched, sun);
  view3d.camera.position.set(4, 5, 9);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return { view3d, sun, texture, dynamicGeometry, meshes: [ground, textured, dynamic, morphed], batched };
}

/**
 * One churn cycle: settle the scene, then run it through all three release paths in turn —
 * collected by pixi's GC while off the stage and revived, unloaded by hand and revived, emptied
 * and destroyed. Every revival renders inside a validation scope, since a bind group, bundle or
 * VAO left pointing at freed memory shows up there and nowhere else.
 */
async function runCycle(app: Application<Renderer>, cycle: number): Promise<void> {
  const renderer = app.renderer;
  const { view3d, sun, texture, dynamicGeometry, meshes, batched } = buildCycleScene(app);

  // Frame 1 of a shadow membership rebuild is documented-wrong, so refresh once and settle.
  app.render();
  sun.refreshShadows();
  app.render();
  app.render();
  if (cycle % FLIP_PERIOD === FLIP_PERIOD - 1) {
    view3d.shadowQuality = 'medium';
    app.render();
    app.render();
  }

  // Off the stage nothing rescues the View, so the sweep takes it with the texture and the dynamic
  // geometry's buffers: pixi's hash runs the View's payload for this renderer and clears the slot.
  // Putting it back rebuilds all of it under a fresh payload.
  app.stage.removeChild(view3d);
  app.render();
  app.render();
  collectStale(renderer, view3d, texture.source, ...dynamicGeometry.buffers);
  expect(view3d._gpuData[renderer.uid] ?? null).toBe(null);
  expect(gpuCopies(texture.source)).toBe(0);
  app.stage.addChild(view3d);
  let error = await renderCatchingValidationErrors(app);
  expect(error?.message ?? null).toBe(null);
  expect(gpuCopies(texture.source)).toBeGreaterThan(0);

  view3d.unload();
  error = await renderCatchingValidationErrors(app);
  expect(error?.message ?? null).toBe(null);

  // Emptied: every pass view drops to zero renderables before anything is destroyed.
  view3d.root.removeChild(...meshes, batched, sun);
  error = await renderCatchingValidationErrors(app);
  expect(error?.message ?? null).toBe(null);

  for (const mesh of meshes)
    mesh.destroy({ children: true, geometry: true, material: true, texture: true, textureSource: true });
  batched.destroy({ children: true, geometry: true, material: true, texture: true, textureSource: true });
  sun.destroy();
  view3d.destroy({ children: true });
}

/** Per-store internals the samples read: live rows, high-water mark, growth leftovers. */
interface StoreProbe {
  _freeCount: number;
  _count: number;
  _retiredBuffers: unknown[];
  bufferVersion: number;
}

interface MorphStoreProbe {
  _deltaCursor: number;
  _weightCursor: number;
  _freeSlots: Map<number, number[]>;
  _freeDeltaBlocks: Map<number, number[]>;
  _retiredBuffers: unknown[];
  bufferVersion: number;
}

interface AtlasProbe {
  _liveAllocations: unknown[];
  _retiredBuffers: unknown[];
  _retiredGeometries: unknown[];
  _deadVertexCount: number;
  vertexCount: number;
  _bufferVersion: number;
}

interface PipeProbe {
  materialStoreBuffer: StoreProbe;
  geometryDataStoreBuffer: StoreProbe;
  _morphStoreBuffer: MorphStoreProbe;
  atlasPool: { _atlases: Record<string, AtlasProbe> };
  _managedViews: { _managedViews: { items: Record<number, unknown> } };
}

/** One of pixi's GC-registered hashes: `context[hash]` is the record of tracked items. */
interface ManagedHashEntry {
  context: Record<string, unknown> & { name?: string };
  hash: string;
}

/** The renderer internals the samples read, on either backend; optional ones exist on one only. */
interface RendererProbe {
  gc: { _managedResourceHashes: ManagedHashEntry[]; _managedResources: unknown[] };
  renderTarget: {
    _gpuRenderTargetHash: Record<string, unknown>;
    _renderSurfaceToRenderTargetHash: Map<unknown, unknown>;
  };
  material3d: { _shaderCache: Map<string, unknown> };
  renderPipes: { view3d: PipeProbe };
  shader: { _programDataHash?: Record<string, unknown> };
  bindGroup?: { _hash: Record<string, unknown> };
  pipeline?: { _pipeCache: Map<string, unknown> };
  mipChain3d?: { _cache: Record<number, unknown> };
}

/** Every metric of one sample, by contract: `flat` must equal the warm sample, `info` is printed and never asserted */
interface Sample {
  flat: Record<string, number>;
  info: Record<string, number>;
}

/** Entries that hold something — pixi's hashes null a slot rather than delete it. */
function liveEntries(record: Record<string, unknown>): number {
  let n = 0;
  for (const key in record) {
    if (record[key] != null) n++;
  }
  return n;
}

function sumOver<T>(items: Iterable<T>, read: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += read(item);
  return total;
}

function sample(app: Application<Renderer>, resident: View3D): Sample {
  const renderer = app.renderer as unknown as RendererProbe;
  const pipe = renderer.renderPipes.view3d;
  const flat: Record<string, number> = {};
  const info: Record<string, number> = {};

  // A View drawn every frame keeps one payload per renderer for its whole life: a payload minted
  // afresh mid-run (each mints its own uniform group, so the group's uid stands for the payload's
  // identity), a slot left behind, or a second enrolment listener would move these.
  flat['resident.gpuDataKeys'] = Object.keys(resident._gpuData).length;
  flat['resident.payload'] = resident._gpuData[app.renderer.uid].globalUniformGroup.uid;
  flat['resident.unloadListeners'] = resident.listenerCount('unload');

  let tombstones = 0;
  for (const entry of renderer.gc._managedResourceHashes) {
    const items = entry.context[entry.hash] as Record<string, unknown>;
    const live = liveEntries(items);
    const metric = `gc.hash.${entry.context.name ?? entry.hash}`;
    flat[metric] = live;
    tombstones += Object.keys(items).length - live;
  }
  flat['gc.managedResources'] = renderer.gc._managedResources.length;
  info['gc.tombstones'] = tombstones;
  flat['pipe.managedViews'] = liveEntries(pipe._managedViews._managedViews.items);

  const stores = [
    ['material', pipe.materialStoreBuffer],
    ['geometry', pipe.geometryDataStoreBuffer],
  ] as const;
  for (const [name, store] of stores) {
    flat[`store.${name}.live`] = store._count - store._freeCount;
    flat[`store.${name}.highWater`] = store._count;
    flat[`store.${name}.retired`] = store._retiredBuffers.length;
    info[`store.${name}.bufferVersion`] = store.bufferVersion;
  }

  const morph = pipe._morphStoreBuffer;
  flat['store.morph.deltaCursor'] = morph._deltaCursor;
  flat['store.morph.weightCursor'] = morph._weightCursor;
  flat['store.morph.freeSlots'] = sumOver(morph._freeSlots.values(), (list) => list.length);
  flat['store.morph.freeDeltaBlocks'] = sumOver(morph._freeDeltaBlocks.values(), (list) => list.length);
  flat['store.morph.retired'] = morph._retiredBuffers.length;
  info['store.morph.bufferVersion'] = morph.bufferVersion;

  const atlases = Object.values(pipe.atlasPool._atlases);
  flat['atlas.count'] = atlases.length;
  flat['atlas.liveAllocations'] = sumOver(atlases, (atlas) => atlas._liveAllocations.length);
  flat['atlas.retiredBuffers'] = sumOver(atlases, (atlas) => atlas._retiredBuffers.length);
  flat['atlas.retiredGeometries'] = sumOver(atlases, (atlas) => atlas._retiredGeometries.length);
  info['atlas.vertexHighWater'] = sumOver(atlases, (atlas) => atlas.vertexCount);
  info['atlas.deadVertices'] = sumOver(atlases, (atlas) => atlas._deadVertexCount);
  info['atlas.bufferVersion'] = sumOver(atlases, (atlas) => atlas._bufferVersion);

  // Pixi buckets by size, flags, format and scale mode; a leak shows as a climbing texture count.
  const buckets = (TexturePool as unknown as { _buckets: Map<number, unknown[]> })._buckets;
  flat['transient.buckets'] = buckets.size;
  flat['transient.textures'] = sumOver(buckets.values(), (bucket) => bucket.length);
  if (renderer.mipChain3d) flat['mipChain.cache'] = Object.keys(renderer.mipChain3d._cache).length;
  flat['material3d.shaders'] = renderer.material3d._shaderCache.size;

  const shared = [
    ['EMPTY', Texture.EMPTY.source],
    ['DEPTH_EMPTY', DEPTH_EMPTY.source],
  ] as const;
  for (const [name, source] of shared) {
    for (const event of ['change', 'unload', 'destroy'] as const) {
      flat[`listeners.${name}.${event}`] = source.listenerCount(event);
    }
  }
  flat['ticker.shared'] = Ticker.shared.count;
  flat['ticker.app'] = app.ticker.count;

  if (renderer.pipeline) flat['pixi.pipelines'] = renderer.pipeline._pipeCache.size;
  if (renderer.shader._programDataHash) flat['pixi.programs'] = Object.keys(renderer.shader._programDataHash).length;

  flat['renderTarget.gpuHash'] = liveEntries(renderer.renderTarget._gpuRenderTargetHash);
  flat['renderTarget.surfaceHash'] = renderer.renderTarget._renderSurfaceToRenderTargetHash.size;
  if (renderer.bindGroup) flat['bindGroup.hash'] = liveEntries(renderer.bindGroup._hash);

  return { flat, info };
}

/** Chrome's non-standard heap gauge, after a forced GC when the page exposes one; NaN elsewhere. */
function heapBytes(): number {
  (globalThis as { gc?: () => void }).gc?.();
  return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? NaN;
}

function formatTable(warm: Sample, end: Sample): string {
  const rows: string[][] = [];
  for (const kind of ['flat', 'info'] as const) {
    for (const metric of Object.keys(warm[kind])) {
      const slope = (end[kind][metric] - warm[kind][metric]) / CYCLES;
      rows.push([
        metric,
        kind,
        String(warm[kind][metric]),
        String(end[kind][metric]),
        Number.isInteger(slope) ? String(slope) : slope.toFixed(3),
      ]);
    }
  }

  const header = ['metric', 'kind', 'warm', 'end', 'slope/cycle'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cols: string[]): string => cols.map((col, i) => col.padEnd(widths[i])).join(' | ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map(line)].join('\n');
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`renderer gc churn (${preference})`, () => {
    it('holds every owned resource count flat across create/collect/unload/destroy cycles', async () => {
      const app = await getApp<Renderer>({
        id: `gc-churn-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018 },
      });

      try {
        // A plain 2D sprite behind the View keeps the renderer drawing while the View is out
        // of the tree, as it would be in a real app.
        const sprite = new Sprite(makeCollectableTexture('#224466'));
        sprite.width = sprite.height = SIZE;
        app.stage.addChild(sprite);
        const resident = buildResidentView(app);

        const heapBefore = heapBytes();
        for (let cycle = 0; cycle < WARMUP; cycle++) await runCycle(app, cycle);
        const warm = sample(app, resident);

        const started = performance.now();
        for (let cycle = WARMUP; cycle < WARMUP + CYCLES; cycle++) await runCycle(app, cycle);
        const msPerCycle = (performance.now() - started) / CYCLES;
        const end = sample(app, resident);
        const heapAfter = heapBytes();

        const moved = Object.keys(warm.flat).filter((metric) => end.flat[metric] !== warm.flat[metric]);
        const verdict = moved.length === 0 ? 'flat' : `moved: [${moved.join(', ')}]`;

        // oxlint-disable-next-line no-console
        console.log(
          `[gc churn ${preference}] ${WARMUP} warm-up + ${CYCLES} cycles, ${msPerCycle.toFixed(1)} ms/cycle, ` +
            `heap ${(heapBefore / 1e6).toFixed(1)} MB -> ${(heapAfter / 1e6).toFixed(1)} MB\n` +
            `${formatTable(warm, end)}\nverdict: ${verdict}`,
        );

        expect(moved).toEqual([]);
      } finally {
        app.destroy();
      }
    }, 60_000);
  });
}
