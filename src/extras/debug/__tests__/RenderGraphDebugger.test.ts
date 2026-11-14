import { RendererType } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { Mesh3DData, MeshPassCache } from '~/core/batcher/Mesh3DData';
import { MESH3D_LANE_VISIBILITY } from '~/core/buffers/Mesh3DDataStoreBuffer';
import type { GraphRenderPass } from '~/core/render-graph/GraphRenderPass';
import type { CullMode, View3D } from '~/scene/View3D';

import { RenderGraphDebugger } from '../GraphDebugSnapshot';

const PASS_BIT = 2;

interface Fixture {
  view: View3D;
  pass: GraphRenderPass;
  passData: {
    view: { count: number; items: Mesh3DData[]; renderableIndices: Uint32Array };
    readonly records: Uint32Array;
    rangesDirtyId: number;
    commandList: {
      count: number;
      bodyCount: number;
      dirtyId: number;
      commands: Array<{ geometry: object; topology: string }>;
    };
    drawData: { drawCalls: Uint32Array };
    gpuData: {
      bundleDirtyId: number;
      instanceBuffer: { data: Uint32Array };
    };
  };
  result: {
    indirectDrawData: { drawCalls: Uint32Array };
    lastBundleDirtyId: number;
    lastBundleCountsDirtyId: number;
    direct: boolean;
  };
  batch: { cull: CullMode; storeBuffer: { bufferVersion: number; u32Data: Uint32Array; stride: number } };
  meshes: Mesh3DData[];
  textures: Texture[];
}

describe('RenderGraphDebugger', () => {
  it('captures one serialisable graph, batch, draw, and resource snapshot', () => {
    const fixture = makeFixture();
    const debug = new RenderGraphDebugger({ view: fixture.view });
    const capturedGeometries: Mesh3DData['geometry'][] = [];
    const snapshot = debug.capture((geometry) => capturedGeometries.push(geometry))!;

    expect(snapshot.captureId).toBe(1);
    expect(snapshot.version).toBe(4);
    expect(snapshot.graph.passes[0].sceneWorkload).toBe('forward');
    expect(snapshot.graph.passes[0].description).toBe('Draws the fixture scene workload.');

    expect(snapshot.summary).toEqual({
      batchCount: 1,
      meshCount: 2,
      submittedMeshCount: 2,
      geometryCount: 1,
      materialCount: 1,
      textureCount: 1,
      drawCallCount: 1,
      sourceInstanceCount: 2,
      drawnInstanceCount: 2,
    });

    expect(snapshot.batches[0]).toMatchObject({
      label: 'scene',
      slotCount: 2,
      meshCount: 2,
      geometryCount: 1,
      materialCount: 1,
      textureCount: 1,
      drawCallCount: 1,
    });
    expect(snapshot.batches[0].passes[0].draws[0]).toMatchObject({
      sourceMeshIds: [1, 2],
      geometryIds: [10],
      materialIds: [20],
      textureIds: [30],
      indexCount: 6,
      sourceInstanceCount: 2,
      drawnInstanceCount: 2,
      sourceTriangleCount: 4,
      drawnTriangleCount: 4,
    });
    expect(snapshot.batches[0].passes[0]).toMatchObject({
      drawBuild: { status: 'first-capture', commandListDirtyId: 1 },
      bundle: {
        status: 'first-capture',
        bundleDirtyId: 1,
        lastBundleDirtyId: 1,
        causes: [{ code: 'first-capture' }],
      },
    });
    expect(snapshot.materials[0].textures).toEqual([{ slot: 0, name: 'baseColorTexture', textureId: 30 }]);
    expect(snapshot.textures[0]).toMatchObject({
      id: 30,
      sourceId: 31,
      label: 'albedo',
      width: 256,
      height: 128,
      format: 'rgba8unorm',
      mipLevelCount: 4,
    });
    expect(capturedGeometries).toEqual([fixture.meshes[0].geometry]);

    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
  });

  it("names a user batch by its owner's label, and by its index without one", () => {
    const fixture = makeFixture();
    const views = fixture.view as unknown as { _meshBatches: object[] };

    views._meshBatches = [
      fixture.batch,
      { ...fixture.batch, uid: 51, renderData: { label: 'trees' } },
      { ...fixture.batch, uid: 52, renderData: {} },
    ];

    const snapshot = new RenderGraphDebugger({ view: fixture.view }).capture()!;

    expect(snapshot.batches.map((batch) => batch.label)).toEqual(['scene', 'trees', 'batch 2']);
  });

  it('mirrors GPU-cull survivor counts on the CPU', () => {
    const fixture = makeFixture();
    fixture.batch.cull = 'gpu';
    fixture.passData.commandList.count = 2;
    fixture.passData.commandList.bodyCount = 2;
    fixture.passData.commandList.commands.push(fixture.passData.commandList.commands[0]);
    fixture.passData.drawData.drawCalls = new Uint32Array([6, 1, 0, 0, 0, 6, 1, 0, 0, 1]);
    fixture.result.indirectDrawData.drawCalls = new Uint32Array([6, 1, 0, 0, 0, 6, 1, 0, 0, 1]);
    fixture.meshes[1].boundingSphere.center.x = -2;
    const planes = fixture.view.camera.cullFrustum.planesData;
    planes[0] = 1;
    planes[1] = 0;
    planes[2] = 0;
    planes[3] = 0;

    const snapshot = new RenderGraphDebugger({ view: fixture.view }).capture()!;
    const draws = snapshot.batches[0].passes[0].draws;

    expect(draws).toHaveLength(2);
    expect(draws[0]).toMatchObject({
      sourceInstanceCount: 1,
      drawnInstanceCount: 1,
      drawnInstanceCountStatus: 'cpu-mirror',
      drawnTriangleCount: 2,
    });
    expect(draws[1]).toMatchObject({
      sourceInstanceCount: 1,
      drawnInstanceCount: 0,
      drawnInstanceCountStatus: 'cpu-mirror',
      drawnTriangleCount: 0,
    });
    expect(snapshot.summary.drawnInstanceCount).toBe(1);
  });

  it('counts only the visible instances of an unculled WebGPU list', () => {
    const fixture = makeFixture();
    const store = fixture.batch.storeBuffer;
    store.u32Data[1 * store.stride + MESH3D_LANE_VISIBILITY] = 0;

    const snapshot = new RenderGraphDebugger({ view: fixture.view }).capture()!;

    expect(snapshot.batches[0].passes[0].draws[0]).toMatchObject({
      sourceInstanceCount: 2,
      drawnInstanceCount: 1,
      drawnInstanceCountStatus: 'exact',
    });
    expect(snapshot.summary.drawnInstanceCount).toBe(1);
  });

  it('excludes non-scene pass state from workload totals', () => {
    const fixture = makeFixture();
    delete (fixture.pass as unknown as { _forward?: unknown })._forward;

    const snapshot = new RenderGraphDebugger({ view: fixture.view }).capture()!;

    expect(snapshot.graph.passes[0].sceneWorkload).toBeNull();
    expect(snapshot.batches[0].passes).toHaveLength(0);
    expect(snapshot.summary.drawCallCount).toBe(0);
  });

  it('lists every material and texture referenced by an instanced draw', () => {
    const fixture = makeFixture();
    const texture = makeTexture(40, 41, 'normal');
    fixture.meshes[1].material = {
      uid: 21,
      _textures: [texture],
      _slotByName: { normalTexture: 0 },
    } as unknown as Mesh3DData['material'];

    const snapshot = new RenderGraphDebugger({ view: fixture.view }).capture()!;
    const draw = snapshot.batches[0].passes[0].draws[0];

    expect(draw.materialIds).toEqual([20, 21]);
    expect(draw.textureIds).toEqual([30, 40]);
    expect(snapshot.summary.materialCount).toBe(2);
    expect(snapshot.summary.textureCount).toBe(2);
  });

  it('reports reuse, explains material, texture, shader, and pipeline rebuilds, and counts a rebuild as a bundle recording although the bundle counter stays put', () => {
    const fixture = makeFixture();
    const debug = new RenderGraphDebugger({ view: fixture.view });

    expect(debug.capture()!.batches[0].passes[0].drawBuild.status).toBe('first-capture');
    expect(debug.capture()!.batches[0].passes[0].drawBuild).toEqual({
      status: 'reused',
      commandListDirtyId: 1,
      causes: [],
    });

    const texture = makeTexture(40, 41, 'normal');
    const material = {
      uid: 21,
      _textures: [texture],
      _slotByName: { normalTexture: 0 },
    };
    const mesh = fixture.meshes[0];
    mesh.material = material as unknown as Mesh3DData['material'];
    mesh._passCache[PASS_BIT].shader = {} as MeshPassCache['shader'];
    mesh._passCache[PASS_BIT].batchKey = 2;
    fixture.passData.commandList.dirtyId++;

    const captured = debug.capture()!.batches[0].passes[0];
    const rebuild = captured.drawBuild;
    expect(rebuild.status).toBe('rebuilt');
    expect(rebuild.causes).toEqual(
      expect.arrayContaining([
        { code: 'material-changed', meshIds: [1] },
        { code: 'texture-changed', meshIds: [1] },
        { code: 'shader-changed', meshIds: [1] },
        { code: 'pipeline-changed', meshIds: [1] },
      ]),
    );
    expect(captured.bundle).toEqual({
      status: 'recorded',
      bundleDirtyId: 1,
      lastBundleDirtyId: 1,
      causes: [{ code: 'draws-rebuilt' }],
    });
  });

  it('reports bundle-only recordings and pending invalidations independently from draw rebuilding', () => {
    const fixture = makeFixture();
    const debug = new RenderGraphDebugger({ view: fixture.view });
    debug.capture();

    fixture.passData.gpuData.bundleDirtyId++;
    fixture.result.lastBundleDirtyId++;
    const recorded = debug.capture()!.batches[0].passes[0];

    expect(recorded.drawBuild.status).toBe('reused');
    expect(recorded.bundle).toEqual({
      status: 'recorded',
      bundleDirtyId: 2,
      lastBundleDirtyId: 2,
      causes: [{ code: 'bundle-only-change' }],
    });

    fixture.passData.gpuData.bundleDirtyId++;
    expect(debug.capture()!.batches[0].passes[0].bundle).toEqual({
      status: 'invalidated',
      bundleDirtyId: 3,
      lastBundleDirtyId: 2,
      causes: [{ code: 'bundle-only-change' }],
    });
  });

  it('reports a direct-draw bundle re-recorded for changed counts, culled or not', () => {
    const fixture = makeFixture();
    fixture.batch.cull = 'off';
    fixture.result.direct = true;
    const debug = new RenderGraphDebugger({ view: fixture.view });
    debug.capture();

    fixture.result.lastBundleCountsDirtyId++;
    expect(debug.capture()!.batches[0].passes[0].bundle).toEqual({
      status: 'recorded',
      bundleDirtyId: 1,
      lastBundleDirtyId: 1,
      causes: [{ code: 'counts-changed' }],
    });
    expect(debug.capture()!.batches[0].passes[0].bundle.status, 'the same counts reuse it').toBe('reused');

    fixture.batch.cull = 'cpu';
    expect(debug.capture()!.batches[0].passes[0].bundle.status, 'a frustum-culled batch keeps it too').toBe('reused');
  });

  it('reports mesh membership and batch-buffer growth causes independently', () => {
    const fixture = makeFixture();
    const debug = new RenderGraphDebugger({ view: fixture.view });
    debug.capture();

    const mesh = makeMesh(3, fixture.meshes[0].geometry, fixture.meshes[0].material);
    fixture.meshes.push(mesh);
    fixture.passData.view.count = 3;
    fixture.passData.view.renderableIndices = new Uint32Array([0, 1, 2]);
    fixture.passData.gpuData.instanceBuffer.data = new Uint32Array([0, 1, 2]);
    fixture.passData.drawData.drawCalls[1] = 3;
    fixture.passData.commandList.dirtyId++;
    fixture.batch.storeBuffer.bufferVersion++;

    const rebuild = debug.capture()!.batches[0].passes[0].drawBuild;
    expect(rebuild.causes).toEqual(
      expect.arrayContaining([
        { code: 'mesh-added', meshIds: [3] },
        { code: 'batch-buffer-grew', previous: 0, current: 1 },
      ]),
    );
  });

  it('names the members an edited list draws from its tail commands, wherever they sit in the view', () => {
    const fixture = makeFixture();
    const debug = new RenderGraphDebugger({ view: fixture.view });
    debug.capture();

    const { geometry, material } = fixture.meshes[0];
    fixture.meshes.push(makeMesh(3, geometry, material), makeMesh(4, geometry, material));
    fixture.passData.view.count = 4;
    fixture.passData.view.renderableIndices = new Uint32Array([0, 3, 1, 2]);
    fixture.passData.commandList.count = 2;
    fixture.passData.commandList.commands.push(fixture.passData.commandList.commands[0]);
    const drawCalls = new Uint32Array([6, 3, 0, 0, 0, 6, 1, 0, 0, 3]);
    fixture.passData.drawData.drawCalls = drawCalls;
    fixture.result.indirectDrawData.drawCalls = drawCalls;
    fixture.passData.gpuData.instanceBuffer.data = new Uint32Array([0, 1, 2, 3]);
    fixture.passData.rangesDirtyId++;

    const captured = debug.capture()!.batches[0].passes[0];
    expect(captured.drawBuild.status).toBe('repacked');
    expect(captured.drawBuild.causes).toEqual(
      expect.arrayContaining([
        { code: 'mesh-added', meshIds: [3, 4] },
        { code: 'tail', meshIds: [4] },
      ]),
    );
    expect(
      captured.draws.map((draw) => draw.sourceMeshIds),
      'mesh 3 joined the body command, mesh 4 the tail command',
    ).toEqual([[1, 2, 3], [4]]);
  });

  it('classifies a key-sorted pass that never caches as dynamic', () => {
    const fixture = makeFixture();
    (fixture.pass as unknown as { _forward: { bit: number; sort: string; cache: string } })._forward = {
      bit: PASS_BIT,
      sort: 'key',
      cache: 'never',
    };
    const debug = new RenderGraphDebugger({ view: fixture.view });
    debug.capture();
    fixture.passData.commandList.dirtyId++;

    const captured = debug.capture()!.batches[0].passes[0];
    expect(captured.drawBuild).toEqual({
      status: 'dynamic',
      commandListDirtyId: 2,
      causes: [],
    });
    expect(captured.bundle).toEqual({
      status: 'not-used',
      bundleDirtyId: null,
      lastBundleDirtyId: null,
      causes: [],
    });
  });

  it('reports a distance-sorted pass as reused while its order holds, and rebuilt when the order moves', () => {
    const fixture = makeFixture();
    (fixture.pass as unknown as { _forward: { bit: number; sort: string } })._forward = {
      bit: PASS_BIT,
      sort: 'distance',
    };
    const debug = new RenderGraphDebugger({ view: fixture.view });
    debug.capture();

    const held = debug.capture()!.batches[0].passes[0];
    expect(held.drawBuild).toEqual({ status: 'reused', commandListDirtyId: 1, causes: [] });
    expect(held.bundle.status, 'it caches no bundle').toBe('not-used');

    fixture.passData.gpuData.instanceBuffer.data = new Uint32Array([1, 0]);
    fixture.passData.commandList.dirtyId++;

    const moved = debug.capture()!.batches[0].passes[0];
    expect(moved.drawBuild).toEqual({
      status: 'rebuilt',
      commandListDirtyId: 2,
      causes: [{ code: 'order-changed' }],
    });
    expect(moved.bundle.status).toBe('not-used');
  });
});

function makeFixture(): Fixture {
  const texture = makeTexture(30, 31, 'albedo');
  const geometry = {
    uid: 10,
    vertexCount: 4,
    indexBuffer: { data: new Uint16Array([0, 1, 2, 0, 2, 3]) },
    topology: 'triangle-list',
    dynamic: false,
  } as unknown as Mesh3DData['geometry'];
  const material = {
    uid: 20,
    _textures: [texture],
    _slotByName: { baseColorTexture: 0 },
  } as unknown as Mesh3DData['material'];
  const meshes = [makeMesh(1, geometry, material), makeMesh(2, geometry, material)];
  const drawCalls = new Uint32Array([6, 2, 0, 0, 0]);
  const passData = {
    view: { count: 2, items: meshes, renderableIndices: new Uint32Array([0, 1]) },
    get records() {
      return this.gpuData.instanceBuffer.data;
    },
    rangesDirtyId: 0,
    commandList: {
      count: 1,
      bodyCount: 1,
      dirtyId: 1,
      commands: [{ geometry, topology: 'triangle-list' }],
    },
    drawData: { drawCalls },
    gpuData: {
      bundleDirtyId: 1,
      instanceBuffer: { data: new Uint32Array([0, 1]) },
    },
  };
  const result = {
    indirectDrawData: { drawCalls },
    lastBundleDirtyId: 1,
    lastBundleCountsDirtyId: 0,
    direct: false,
  };
  const batchMatrix = new Float32Array(24);
  batchMatrix[0] = 1;
  batchMatrix[5] = 1;
  batchMatrix[10] = 1;
  batchMatrix[15] = 1;
  const storeU32 = new Uint32Array(48);
  storeU32[19] = 1;
  storeU32[43] = 1;
  const batch = {
    uid: 50,
    cull: 'off' as CullMode,
    items: meshes,
    drawLists: { [PASS_BIT]: passData },
    storeBuffer: { bufferVersion: 0, data: batchMatrix, u32Data: storeU32, stride: 24 },
  };
  const pass = {
    name: 'opaque',
    description: 'Draws the fixture scene workload.',
    bit: PASS_BIT,
    _forward: { bit: PASS_BIT, sort: 'key' },
    pipe: { renderer: { type: RendererType.WEBGPU } },
    cullResults: { get: () => result },
    setup() {},
    render() {},
  } as unknown as GraphRenderPass;
  const addedPass = {
    pass,
    record: { accesses: [] },
    dependsOn: [],
    isAnchored: true,
    finishedColors: [],
    lastSampleSourceUids: [],
  };
  const graph = {
    defaultColor: { _id: 0 },
    defaultDepth: { _id: 1 },
    _passes: [addedPass],
    get passes() {
      return [pass];
    },
    _activePasses: [addedPass],
    _resources: [
      { kind: 'imported', type: 'color' },
      { kind: 'imported', type: 'depth' },
    ],
    _acquireAt: [[]],
    _releaseAt: [[]],
    _effectiveLoadOp: () => 'load',
  };
  const planes = new Float32Array(24);
  for (let i = 0; i < planes.length; i += 4) {
    planes[i] = 1;
    planes[i + 3] = 100;
  }
  const frustum = { planesData: planes };
  const view = {
    _graph: graph,
    _meshBatches: [batch],
    camera: { frustum, cullFrustum: frustum },
  } as unknown as View3D;

  return { view, pass, passData, result, batch, meshes, textures: [texture] };
}

function makeMesh(id: number, geometry: Mesh3DData['geometry'], material: Mesh3DData['material']): Mesh3DData {
  return {
    uid: id,
    _storeIndex: id - 1,
    geometry,
    material,
    _worldVisible: 1,
    boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 0.5 },
    _passCache: {
      [PASS_BIT]: {
        shader: {} as MeshPassCache['shader'],
        state: {} as MeshPassCache['state'],
        topology: 'triangle-list',
        batchKey: 1,
      },
    },
  } as unknown as Mesh3DData;
}

function makeTexture(id: number, sourceId: number, label: string): Texture {
  return {
    uid: id,
    label,
    source: {
      uid: sourceId,
      width: 256,
      height: 128,
      format: 'rgba8unorm',
      mipLevelCount: 4,
    },
  } as unknown as Texture;
}
