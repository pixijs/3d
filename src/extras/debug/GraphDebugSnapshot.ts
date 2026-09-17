import { RendererType } from 'pixi.js';
import type { Texture } from 'pixi.js';

import type { Mesh3DBatch } from '../../core/batcher/Mesh3DBatch';
import type { Mesh3DData, MeshPassCache } from '../../core/batcher/Mesh3DData';
import { MESH3D_LANE_VISIBILITY } from '../../core/buffers/Mesh3DDataStoreBuffer';
import { transformFrustumToBatch } from '../../core/cull';
import type { GraphRenderPass } from '../../core/render-graph/GraphRenderPass';
import type { ResourceAccess } from '../../core/render-graph/PassBuilder';
import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import type { ResourceHandle, ResourceKind } from '../../core/render-graph/ResourceHandle';
import type { CullResult, CullResults } from '../../core/render-passes/CullResult';
import type { DrawList } from '../../core/render-passes/DrawList';
import { RenderPassBit } from '../../core/render-passes/RenderPass';
import type { RenderPass } from '../../core/render-passes/RenderPass';
import type { Geometry3D } from '../../geometry/Geometry3D';
import type { View3D } from '../../scene/View3D';

/**
 * Serialization version stamped onto every {@link GraphDebugSnapshot}
 * @category extras:debug
 * @advanced
 */
export const GRAPH_DEBUG_SNAPSHOT_VERSION = 4;

/**
 * Which retained scene-mesh workload a graph pass carries
 * @category extras:debug
 * @advanced
 */
export type GraphDebugScenePassKind = 'forward' | 'shadow';

/**
 * One resource access declared by a graph pass
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugAccessSnapshot {
  /** How the pass uses the resource */
  mode: ResourceAccess['mode'];
  /** Id of the accessed resource */
  handleId: number;
  /** Resource kind of the accessed handle */
  handleKind: ResourceHandle['_kind'];
  /** Attachment slot, for attachment accesses */
  slot?: number;
  /** Resolved load op for attachment writes; null for other access modes or inactive passes */
  effectiveLoadOp: string | null;
}

/**
 * One pass of the resolved render graph
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugPassSnapshot {
  /** Pass name as registered with the graph */
  name: string;
  /** Optional human-readable pass description */
  description: string | null;
  /** Retained scene-mesh workload; other GPU work remains represented by the graph metadata */
  sceneWorkload: GraphDebugScenePassKind | null;
  /** Whether the pass survived the graph's dependency cull */
  active: boolean;
  /** Execution index among active passes; null when the pass was culled */
  passIdx: number | null;
  /** Whether the pass writes or produces an imported resource and therefore always survives the cull */
  isAnchored: boolean;
  /**
   * Ids of colour resources whose mipmaps the graph generated right after this pass, in the
   * last frame — the pass was their final writer and their source asks for them
   */
  mipmapHandles: number[];
  /**
   * Declaration indices of the passes this pass depends on
   *
   * Indices, not names: two passes may share a name when they draw it from different cameras,
   * so a name doesn't identify one.
   */
  dependsOn: number[];
  /** Resource accesses declared by the pass */
  accesses: GraphDebugAccessSnapshot[];
  /** Ids of transient resources acquired when this pass runs */
  acquires: number[];
  /** Ids of transient resources released after this pass runs */
  releases: number[];
}

/**
 * One resource registered with the render graph
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugResourceSnapshot {
  /** Resource id within the graph */
  id: number;
  /** Whether the resource is imported into the graph or transient within it */
  kind: 'imported' | 'transient';
  /** What kind of GPU resource this is */
  type: ResourceKind;
  /** Whether this is the graph's default color target */
  isDefaultColor: boolean;
  /** Whether this is the graph's default depth target */
  isDefaultDepth: boolean;
  /** Active-pass index at which the resource is acquired; null when never acquired */
  firstUse: number | null;
  /** Active-pass index at which the resource is released; null when never released */
  lastUse: number | null;
}

/**
 * Structure of the resolved render graph: its passes and resources
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugGraphSnapshot {
  /** Every pass added to the graph, active or not */
  passes: GraphDebugPassSnapshot[];
  /** Every resource registered with the graph */
  resources: GraphDebugResourceSnapshot[];
}

/**
 * A texture referenced by at least one captured material
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugTextureSnapshot {
  /** Texture id: the texture's own uid when present, otherwise its source uid */
  id: number;
  /** Uid of the underlying texture source */
  sourceId: number;
  /** Texture or source label; null when unlabelled */
  label: string | null;
  /** Source width in pixels */
  width: number;
  /** Source height in pixels */
  height: number;
  /** GPU texture format; null when unknown */
  format: string | null;
  /** Number of mip levels */
  mipLevelCount: number;
}

/**
 * One texture bound to a material slot
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugTextureBindingSnapshot {
  /** Binding slot index within the material */
  slot: number;
  /** Slot name; null when the slot is unnamed */
  name: string | null;
  /** Id of the bound {@link GraphDebugTextureSnapshot} */
  textureId: number;
}

/**
 * A material referenced by at least one captured mesh
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugMaterialSnapshot {
  /** Material uid */
  id: number;
  /** Material class name */
  type: string;
  /** Textures bound to the material, in slot order */
  textures: GraphDebugTextureBindingSnapshot[];
}

/**
 * A geometry referenced by at least one captured mesh
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugGeometrySnapshot {
  /** Geometry uid */
  id: number;
  /** Geometry class name */
  type: string;
  /** Number of vertices */
  vertexCount: number;
  /** Number of indices; 0 when non-indexed */
  indexCount: number;
  /** Primitive topology */
  topology: string;
  /** Whether the geometry is flagged dynamic */
  dynamic: boolean;
}

/**
 * A mesh submitted to at least one active scene pass
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugMeshSnapshot {
  /** Mesh uid */
  id: number;
  /** Mesh label; null when unlabelled */
  label: string | null;
  /** Mesh class name */
  type: string;
  /** Uid of the mesh's geometry */
  geometryId: number;
  /** Uid of the mesh's material */
  materialId: number;
  /** Whether the mesh is visible in world space */
  visible: boolean;
}

/**
 * Why a batch pass rebuilt its retained draw commands
 * @category extras:debug
 * @advanced
 */
export type GraphDebugDrawRebuildCauseCode =
  | 'batch-buffer-grew'
  | 'first-capture'
  | 'geometry-changed'
  | 'material-changed'
  | 'mesh-added'
  | 'mesh-removed'
  | 'pipeline-changed'
  | 'shader-changed'
  | 'texture-changed'
  | 'unknown';

/**
 * One attributed reason for a draw-command rebuild
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugDrawRebuildCause {
  /** What changed since the previous capture */
  code: GraphDebugDrawRebuildCauseCode;
  /** Uids of the meshes involved, when the cause is mesh-specific */
  meshIds?: number[];
  /** Value before the change, for versioned causes */
  previous?: number;
  /** Value after the change, for versioned causes */
  current?: number;
}

/**
 * Draw-command build outcome for one batch pass in one capture
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugDrawBuildSnapshot {
  /** Whether the retained commands were reused, rebuilt, rebuilt-every-frame by design, or first captured */
  status: 'dynamic' | 'first-capture' | 'rebuilt' | 'reused';
  /** Revision of the pass's retained command list */
  commandListDirtyId: number;
  /** Attributed causes when the commands were rebuilt */
  causes: GraphDebugDrawRebuildCause[];
}

/**
 * Why a batch pass recorded or invalidated its WebGPU bundle
 * @category extras:debug
 * @advanced
 */
export type GraphDebugBundleCauseCode = 'bundle-only-change' | 'draws-rebuilt' | 'first-capture';

/**
 * One attributed reason for a bundle recording or invalidation
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugBundleCause {
  /** What triggered the bundle change */
  code: GraphDebugBundleCauseCode;
}

/**
 * WebGPU bundle state for one batch pass in one capture
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugBundleSnapshot {
  /** Whether the bundle was reused, recorded, invalidated, first captured, or not used at all */
  status: 'first-capture' | 'invalidated' | 'not-used' | 'recorded' | 'reused';
  /** Bundle cache revision requested by the renderer; null when this pass does not use WebGPU bundles */
  bundleDirtyId: number | null;
  /** Revision consumed by the recorded bundle cache; null when this pass does not use WebGPU bundles */
  lastBundleDirtyId: number | null;
  /** Attributed causes when the bundle was recorded or invalidated */
  causes: GraphDebugBundleCause[];
}

/**
 * One retained draw command within a batch pass
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugDrawSnapshot {
  /** Position within the pass's command list */
  index: number;
  /** Meshes covered by the command's original instance range, before culling compacts survivors */
  sourceMeshIds: number[];
  /** Uids of the distinct geometries behind the command */
  geometryIds: number[];
  /** Uids of the distinct materials behind the command */
  materialIds: number[];
  /** Ids of the distinct textures sampled by the command */
  textureIds: number[];
  /** Uid of the shared render geometry the command binds; null when it has none */
  renderGeometryId: number | null;
  /** Primitive topology of the command */
  topology: string;
  /** Indices drawn per instance */
  indexCount: number;
  /** Offset into the index buffer */
  firstIndex: number;
  /** Vertex offset added to each index */
  baseVertex: number;
  /** First instance slot covered by the command */
  firstInstance: number;
  /** Original instances assigned to this command by the batcher */
  sourceInstanceCount: number;
  /** Surviving instances when CPU-visible; null when the count only exists in a GPU-written buffer */
  drawnInstanceCount: number | null;
  /** How `drawnInstanceCount` was obtained: exact CPU count, CPU mirror of GPU culling, or unavailable without readback */
  drawnInstanceCountStatus: 'cpu-mirror' | 'exact' | 'gpu-readback-required';
  /** Triangles the command would draw with no culling; null for non-triangle topologies */
  sourceTriangleCount: number | null;
  /** Triangles actually drawn; null for non-triangle topologies or when the drawn instance count is unknown */
  drawnTriangleCount: number | null;
}

/**
 * One batch's retained draw work for one scene pass
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugBatchPassSnapshot {
  /** Pass name */
  name: string;
  /** Render-pass bit identifying the pass on meshes */
  bit: number;
  /** Meshes submitted to the pass */
  renderableCount: number;
  /** Retained logical draw commands; self-managed passes may replay these commands more than once */
  drawCallCount: number;
  /** Batcher-assigned instances summed across the pass's draws */
  sourceInstanceCount: number;
  /** Surviving instances summed across the pass's draws; null when only a GPU buffer holds the counts */
  drawnInstanceCount: number | null;
  /** Draw-command build outcome for this capture */
  drawBuild: GraphDebugDrawBuildSnapshot;
  /** WebGPU bundle state for this capture */
  bundle: GraphDebugBundleSnapshot;
  /** The retained draw commands */
  draws: GraphDebugDrawSnapshot[];
}

/**
 * One mesh batch and its per-pass retained draw work
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugBatchSnapshot {
  /** Batch uid */
  id: number;
  /** Display label; the first batch is labelled `scene` */
  label: string;
  /** Allocated mesh slots, including free ones */
  slotCount: number;
  /** Distinct meshes active in at least one pass */
  meshCount: number;
  /** Mesh submissions summed across passes */
  submittedMeshCount: number;
  /** Distinct geometries used by the active meshes */
  geometryCount: number;
  /** Distinct materials used by the active meshes */
  materialCount: number;
  /** Distinct textures sampled by the active meshes */
  textureCount: number;
  /** Retained logical draw commands summed across passes */
  drawCallCount: number;
  /** Batcher-assigned instances summed across passes */
  sourceInstanceCount: number;
  /** Surviving instances summed across passes; null when any pass would need a GPU readback */
  drawnInstanceCount: number | null;
  /** Per-pass breakdown of the batch's draw work */
  passes: GraphDebugBatchPassSnapshot[];
}

/**
 * Frame totals across every captured batch
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugSummarySnapshot {
  /** Number of captured batches */
  batchCount: number;
  /** Distinct meshes summed across batches */
  meshCount: number;
  /** Mesh submissions summed across batches and passes */
  submittedMeshCount: number;
  /** Distinct geometries captured this frame */
  geometryCount: number;
  /** Distinct materials captured this frame */
  materialCount: number;
  /** Distinct textures captured this frame */
  textureCount: number;
  /** Retained logical draw commands across active mesh passes; does not multiply internal pass replays */
  drawCallCount: number;
  /** Batcher-assigned instances summed across batches */
  sourceInstanceCount: number;
  /** Surviving instances summed across batches; null when any pass would need a GPU readback */
  drawnInstanceCount: number | null;
}

/**
 * Complete JSON-serialisable capture of one rendered frame
 *
 * Combines the resolved graph structure with every batch, mesh, geometry, material, and texture
 * that contributed retained draw work.
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugSnapshot {
  /** Serialization version of this shape */
  version: typeof GRAPH_DEBUG_SNAPSHOT_VERSION;
  /** Monotonic within one {@link RenderGraphDebugger}; starts at 1 and resets with the debugger */
  captureId: number;
  /** Structure of the resolved render graph */
  graph: GraphDebugGraphSnapshot;
  /** Frame totals across all batches */
  summary: GraphDebugSummarySnapshot;
  /** Per-batch retained draw work */
  batches: GraphDebugBatchSnapshot[];
  /** Every mesh active in at least one captured pass */
  meshes: GraphDebugMeshSnapshot[];
  /** Every geometry referenced by a captured mesh */
  geometries: GraphDebugGeometrySnapshot[];
  /** Every material referenced by a captured mesh */
  materials: GraphDebugMaterialSnapshot[];
  /** Every texture bound by a captured material */
  textures: GraphDebugTextureSnapshot[];
}

interface DebugAddedPass {
  pass: GraphRenderPass;
  record: { accesses: ResourceAccess[] };
  dependsOn: DebugAddedPass[];
  isAnchored: boolean;
  mipmapHandles: { _id: number }[];
}

interface DebugResourceEntry {
  kind: 'imported' | 'transient';
  type: ResourceKind;
}

/** Mirror of the private `RenderGraph` fields the capture reads; must stay in sync with that class */
interface DebugRenderGraphInternals {
  _passes: DebugAddedPass[];
  _resources: DebugResourceEntry[];
  _activePasses: DebugAddedPass[];
  _acquireAt: number[][];
  _releaseAt: number[][];
  _effectiveLoadOp(access: ResourceAccess, passIdx: number): string;
}

interface GraphDebugMeshInputState {
  geometryId: number;
  materialId: number;
  textureSourceIds: number[];
  shader: object;
  batchKey: number;
}

interface GraphDebugBatchPassState {
  key: string;
  commandListDirtyId: number;
  bufferVersion: number;
  alwaysRebuild: boolean;
  usesBundle: boolean;
  bundleDirtyId: number | null;
  lastBundleDirtyId: number | null;
  meshIds: number[];
  meshes: Map<number, GraphDebugMeshInputState>;
}

interface GraphDebugCaptureResult {
  snapshot: GraphDebugSnapshot;
  states: Map<string, GraphDebugBatchPassState>;
}

type GraphDebugGeometryCapture = (geometry: Geometry3D) => void;

/**
 * Capture the resolved render-graph structure without adding serialization code to the graph itself
 * @param graph - The graph to inspect; its private resolution state is read reflectively
 * @returns The graph's passes and resources as plain data
 * @category extras:debug
 * @advanced
 */
export function captureGraphDebugSnapshot(graph: RenderGraph): GraphDebugGraphSnapshot {
  const internals = graph as unknown as DebugRenderGraphInternals;
  const activeIdxByPass = new Map<DebugAddedPass, number>();
  for (let i = 0; i < internals._activePasses.length; i++) activeIdxByPass.set(internals._activePasses[i], i);

  const firstUseById: Record<number, number> = Object.create(null);
  const lastUseById: Record<number, number> = Object.create(null);
  for (let i = 0; i < internals._acquireAt.length; i++) {
    const ids = internals._acquireAt[i];
    for (let j = 0; j < ids.length; j++) firstUseById[ids[j]] = i;
  }
  for (let i = 0; i < internals._releaseAt.length; i++) {
    const ids = internals._releaseAt[i];
    for (let j = 0; j < ids.length; j++) lastUseById[ids[j]] = i;
  }

  const declaredIdxByPass = new Map<DebugAddedPass, number>();
  for (let i = 0; i < internals._passes.length; i++) declaredIdxByPass.set(internals._passes[i], i);

  const passes = internals._passes.map((addedPass) => {
    const passIdx = activeIdxByPass.get(addedPass) ?? null;
    return {
      name: addedPass.pass.name,
      description: addedPass.pass.description ?? null,
      sceneWorkload: sceneWorkloadKind(addedPass.pass),
      active: passIdx !== null,
      passIdx,
      isAnchored: addedPass.isAnchored,
      mipmapHandles: addedPass.mipmapHandles.map((handle) => handle._id),
      dependsOn: addedPass.dependsOn.map((dependency) => declaredIdxByPass.get(dependency)!),
      accesses: addedPass.record.accesses.map((access) => ({
        mode: access.mode,
        handleId: access.handle._id,
        handleKind: access.handle._kind,
        slot: access.slot,
        effectiveLoadOp:
          access.mode === 'write_attachment' && passIdx !== null ? internals._effectiveLoadOp(access, passIdx) : null,
      })),
      acquires: passIdx !== null ? internals._acquireAt[passIdx].slice() : [],
      releases: passIdx !== null ? internals._releaseAt[passIdx].slice() : [],
    };
  });

  const resources = internals._resources.map((entry, id) => ({
    id,
    kind: entry.kind,
    type: entry.type,
    isDefaultColor: id === graph.defaultColor._id,
    isDefaultDepth: id === graph.defaultDepth._id,
    firstUse: firstUseById[id] ?? null,
    lastUse: lastUseById[id] ?? null,
  }));

  return { passes, resources };
}

function sceneWorkloadKind(pass: GraphRenderPass): GraphDebugScenePassKind | null {
  if (forwardConfig(pass)) return 'forward';
  if (pass.bit === RenderPassBit.SHADOW) return 'shadow';
  return null;
}

/**
 * Build the current JSON snapshot plus private comparison state used to explain later draw and bundle changes
 * @param view - View to capture
 * @param previous - Per-pass state from the previous capture, used to explain what changed
 * @param captureId - Sequence number stamped on this capture
 * @param captureGeometry - Called once per distinct geometry in this capture, before it is snapshotted
 */
function captureViewDebugSnapshot(
  view: View3D,
  previous: ReadonlyMap<string, GraphDebugBatchPassState>,
  captureId: number,
  captureGeometry?: GraphDebugGeometryCapture,
): GraphDebugCaptureResult {
  const graph = captureGraphDebugSnapshot(view._graph);
  const activePassNames = new Set(
    graph.passes.filter((pass) => pass.active && pass.sceneWorkload !== null).map((pass) => pass.name),
  );
  const meshes = new Map<number, GraphDebugMeshSnapshot>();
  const geometries = new Map<number, GraphDebugGeometrySnapshot>();
  const materials = new Map<number, GraphDebugMaterialSnapshot>();
  const textures = new Map<number, GraphDebugTextureSnapshot>();
  const states = new Map<string, GraphDebugBatchPassState>();
  const batches: GraphDebugBatchSnapshot[] = [];
  const cullPlanes = view.camera.cullFrustum.planesData;

  const passesByBit = new Map<number, RenderPass>();
  const graphPasses = view._graph.passes;
  for (let i = 0; i < graphPasses.length; i++) {
    const pass = graphPasses[i] as RenderPass;
    if (pass.bit !== undefined && activePassNames.has(pass.name)) passesByBit.set(pass.bit, pass);
  }

  for (let batchIndex = 0; batchIndex < view._meshBatches.length; batchIndex++) {
    const batch = view._meshBatches[batchIndex];
    const activeMeshIds = new Set<number>();
    const geometryIds = new Set<number>();
    const materialIds = new Set<number>();
    const textureIds = new Set<number>();
    const passes: GraphDebugBatchPassSnapshot[] = [];
    let submittedMeshCount = 0;
    let drawCallCount = 0;
    let sourceInstanceCount = 0;
    let drawnInstanceCount: number | null = 0;

    for (const [bit, pass] of passesByBit) {
      const passData = batch.drawLists[bit];
      if (!passData || passData.view.count === 0) continue;

      const captured = captureBatchPass(batch, pass, passData, previous, cullPlanes);
      passes.push(captured.snapshot);
      states.set(captured.state.key, captured.state);
      submittedMeshCount += captured.snapshot.renderableCount;
      drawCallCount += captured.snapshot.drawCallCount;
      sourceInstanceCount += captured.snapshot.sourceInstanceCount;
      drawnInstanceCount = addNullable(drawnInstanceCount, captured.snapshot.drawnInstanceCount);

      for (let i = 0; i < captured.state.meshIds.length; i++) {
        const mesh = passData.view.items[passData.view.indices[i]];
        captureMesh(mesh, meshes, geometries, materials, textures, captureGeometry);
        activeMeshIds.add(mesh.uid);
        geometryIds.add(mesh.geometry.uid);
        materialIds.add(mesh.material.uid);
        for (let t = 0; t < mesh.material._textures.length; t++) textureIds.add(textureId(mesh.material._textures[t]));
      }
    }

    batches.push({
      id: batch.uid,
      label: batchIndex === 0 ? 'scene' : `batch ${batchIndex}`,
      slotCount: batch.items.length,
      meshCount: activeMeshIds.size,
      submittedMeshCount,
      geometryCount: geometryIds.size,
      materialCount: materialIds.size,
      textureCount: textureIds.size,
      drawCallCount,
      sourceInstanceCount,
      drawnInstanceCount,
      passes,
    });
  }

  const summary = batches.reduce<GraphDebugSummarySnapshot>(
    (total, batch) => {
      total.meshCount += batch.meshCount;
      total.submittedMeshCount += batch.submittedMeshCount;
      total.drawCallCount += batch.drawCallCount;
      total.sourceInstanceCount += batch.sourceInstanceCount;
      total.drawnInstanceCount = addNullable(total.drawnInstanceCount, batch.drawnInstanceCount);
      return total;
    },
    {
      batchCount: batches.length,
      meshCount: 0,
      submittedMeshCount: 0,
      geometryCount: 0,
      materialCount: 0,
      textureCount: 0,
      drawCallCount: 0,
      sourceInstanceCount: 0,
      drawnInstanceCount: 0,
    },
  );
  summary.geometryCount = geometries.size;
  summary.materialCount = materials.size;
  summary.textureCount = textures.size;

  return {
    snapshot: {
      version: GRAPH_DEBUG_SNAPSHOT_VERSION,
      captureId,
      graph,
      summary,
      batches,
      meshes: [...meshes.values()],
      geometries: [...geometries.values()],
      materials: [...materials.values()],
      textures: [...textures.values()],
    },
    states,
  };
}

function captureBatchPass(
  batch: Mesh3DBatch,
  pass: RenderPass,
  passData: DrawList,
  previous: ReadonlyMap<string, GraphDebugBatchPassState>,
  cullPlanes: Float32Array,
): { snapshot: GraphDebugBatchPassSnapshot; state: GraphDebugBatchPassState } {
  const bit = pass.bit!;
  const key = `${batch.uid}:${bit}`;
  const meshIds: number[] = [];
  const meshStates = new Map<number, GraphDebugMeshInputState>();
  for (let i = 0; i < passData.view.count; i++) {
    const mesh = passData.view.items[passData.view.indices[i]];
    const cache = mesh._passCache[bit];
    meshIds.push(mesh.uid);
    meshStates.set(mesh.uid, captureMeshInput(mesh, cache));
  }

  // WebGPU keeps what the pass's frustum decided — the culled counts and the bundle watermark — on
  // the pass's result for the batch; WebGL rewrites the list's own args in place and records nothing.
  const result = cullResultFor(pass, batch);
  const args = result ? result.indirectDrawData.drawCalls : passData.drawData.drawCalls;
  // Render bundles exist only on the WebGPU pipe.
  const usesBundle = pass.pipe.renderer.type === RendererType.WEBGPU && passUsesBundle(pass);
  const state: GraphDebugBatchPassState = {
    key,
    commandListDirtyId: passData.commandList.dirtyId,
    bufferVersion: batch.storeBuffer.bufferVersion,
    alwaysRebuild: passAlwaysRebuilds(pass),
    usesBundle,
    bundleDirtyId: usesBundle ? passData.gpuData.bundleDirtyId : null,
    lastBundleDirtyId: usesBundle ? (result?.lastBundleDirtyId ?? null) : null,
    meshIds,
    meshes: meshStates,
  };
  const previousState = previous.get(key);
  const drawBuild = compareDrawBuildState(previousState, state);
  const bundle = compareBundleState(previousState, state, drawBuild);
  const mirroredDrawCounts =
    passData._cullProducer === 'gpu' && forwardConfig(pass)
      ? mirrorGpuCullDrawCounts(passData, batch, cullPlanes)
      : null;
  const draws = captureDraws(passData, args, mirroredDrawCounts);
  let sourceInstanceCount = 0;
  let drawnInstanceCount: number | null = 0;
  for (let i = 0; i < draws.length; i++) {
    sourceInstanceCount += draws[i].sourceInstanceCount;
    drawnInstanceCount = addNullable(drawnInstanceCount, draws[i].drawnInstanceCount);
  }

  return {
    snapshot: {
      name: pass.name,
      bit,
      renderableCount: passData.view.count,
      drawCallCount: draws.length,
      sourceInstanceCount,
      drawnInstanceCount,
      drawBuild,
      bundle,
      draws,
    },
    state,
  };
}

/** The slice of a forward pass the snapshot reads: its per-batch cull results, absent on other passes */
interface CullingPass {
  /** WebGPU's per-batch cull results (`ForwardRenderPass.cullResults`) */
  cullResults?: CullResults;
}

/**
 * The pass's cull result for `batch` — present on WebGPU once the pass has drawn the batch
 * @param pass - Pass to read the cull results from
 * @param batch - Batch whose cull result to find
 */
function cullResultFor(pass: GraphRenderPass, batch: Mesh3DBatch): CullResult | undefined {
  return (pass as CullingPass).cullResults?.get(batch);
}

function captureDraws(
  passData: DrawList,
  args: Uint32Array,
  mirroredDrawCounts: Uint32Array | null,
): GraphDebugDrawSnapshot[] {
  const draws: GraphDebugDrawSnapshot[] = [];
  const commands = passData.commandList.commands;
  const count = passData.commandList.count;

  for (let i = 0; i < count; i++) {
    const offset = i * 5;
    const firstInstance = args[offset + 4];
    const nextFirstInstance = i + 1 < count ? args[(i + 1) * 5 + 4] : passData.view.count;
    const sourceCount = Math.max(0, nextFirstInstance - firstInstance);
    const sourceMeshes: Mesh3DData[] = [];
    for (let j = firstInstance; j < firstInstance + sourceCount && j < passData.view.count; j++) {
      sourceMeshes.push(passData.view.items[passData.view.indices[j]]);
    }

    const geometryIds = uniqueNumbers(sourceMeshes.map((mesh) => mesh.geometry.uid));
    const materialIds = uniqueNumbers(sourceMeshes.map((mesh) => mesh.material.uid));
    const textureIds = uniqueNumbers(
      sourceMeshes.flatMap((mesh) => mesh.material._textures.map((texture) => textureId(texture))),
    );
    const indexCount = args[offset];
    const gpuCull = passData._cullProducer === 'gpu';
    const drawnInstanceCount = gpuCull ? (mirroredDrawCounts?.[i] ?? null) : args[offset + 1];
    let drawnInstanceCountStatus: GraphDebugDrawSnapshot['drawnInstanceCountStatus'] = 'exact';
    if (gpuCull) drawnInstanceCountStatus = mirroredDrawCounts ? 'cpu-mirror' : 'gpu-readback-required';
    const topology = String(commands[i].topology);
    const trianglesPerInstance = triangleCount(indexCount, topology);

    draws.push({
      index: i,
      sourceMeshIds: sourceMeshes.map((mesh) => mesh.uid),
      geometryIds,
      materialIds,
      textureIds,
      renderGeometryId: objectUid(commands[i].geometry),
      topology,
      indexCount,
      firstIndex: args[offset + 2],
      baseVertex: args[offset + 3],
      firstInstance,
      sourceInstanceCount: sourceCount,
      drawnInstanceCount,
      drawnInstanceCountStatus,
      sourceTriangleCount: trianglesPerInstance === null ? null : trianglesPerInstance * sourceCount,
      drawnTriangleCount:
        trianglesPerInstance === null || drawnInstanceCount === null ? null : trianglesPerInstance * drawnInstanceCount,
    });
  }

  return draws;
}

/**
 * Re-run the GPU culling tests (visibility lane + frustum-sphere) on the CPU to recover per-command
 * survivor counts without a GPU readback
 * @param passData - Draw list whose commands are counted
 * @param batch - Batch the draw list draws from, for its store buffer
 * @param planes - World-space frustum planes the GPU culls against, as packed plane data
 */
function mirrorGpuCullDrawCounts(passData: DrawList, batch: Mesh3DBatch, planes: Float32Array): Uint32Array {
  const commandCount = passData.commandList.count;
  const counts = new Uint32Array(commandCount);
  const args = passData.drawData.drawCalls;
  const items = passData.view.items;
  const indices = passData.view.indices;
  const sourceInstances = passData.gpuData.instanceBuffer.data;
  const storeU32 = batch.storeBuffer.u32Data;
  const storeStride = batch.storeBuffer.stride;
  const transformedPlanes = transformFrustumToBatch(planes, batch.storeBuffer.data);

  for (let command = 0; command < commandCount; command++) {
    const start = args[command * 5 + 4];
    const end = command + 1 < commandCount ? args[(command + 1) * 5 + 4] : passData.view.count;
    let survivors = 0;

    for (let instance = start; instance < end; instance++) {
      const storeIndex = sourceInstances[instance * 2];
      if (storeU32[storeIndex * storeStride + MESH3D_LANE_VISIBILITY] === 0) continue;

      const mesh = items[indices[instance]];
      const sphere = mesh.boundingSphere;
      const radius = sphere.radius;
      let visible = true;
      if (radius >= 0) {
        const center = sphere.center;
        for (let plane = 0; plane < 24; plane += 4) {
          if (
            transformedPlanes[plane] * center.x +
              transformedPlanes[plane + 1] * center.y +
              transformedPlanes[plane + 2] * center.z +
              transformedPlanes[plane + 3] <
            -radius
          ) {
            visible = false;
            break;
          }
        }
      }
      if (visible) survivors++;
    }

    counts[command] = survivors;
  }

  return counts;
}

function captureMesh(
  mesh: Mesh3DData,
  meshes: Map<number, GraphDebugMeshSnapshot>,
  geometries: Map<number, GraphDebugGeometrySnapshot>,
  materials: Map<number, GraphDebugMaterialSnapshot>,
  textures: Map<number, GraphDebugTextureSnapshot>,
  captureGeometry?: GraphDebugGeometryCapture,
): void {
  if (!meshes.has(mesh.uid)) {
    meshes.set(mesh.uid, {
      id: mesh.uid,
      label: objectLabel(mesh),
      type: objectType(mesh),
      geometryId: mesh.geometry.uid,
      materialId: mesh.material.uid,
      visible: mesh._worldVisible !== 0,
    });
  }

  if (!geometries.has(mesh.geometry.uid)) {
    captureGeometry?.(mesh.geometry);
    geometries.set(mesh.geometry.uid, {
      id: mesh.geometry.uid,
      type: objectType(mesh.geometry),
      vertexCount: mesh.geometry.vertexCount,
      indexCount: mesh.geometry.indexBuffer?.data.length ?? 0,
      topology: String(mesh.geometry.topology),
      dynamic: mesh.geometry.dynamic,
    });
  }

  if (!materials.has(mesh.material.uid)) {
    const namesBySlot = new Map<number, string>();
    for (const name in mesh.material._slotByName) namesBySlot.set(mesh.material._slotByName[name], name);
    materials.set(mesh.material.uid, {
      id: mesh.material.uid,
      type: objectType(mesh.material),
      textures: mesh.material._textures.map((texture, slot) => {
        captureTexture(texture, textures);
        return { slot, name: namesBySlot.get(slot) ?? null, textureId: textureId(texture) };
      }),
    });
  }
}

function captureTexture(texture: Texture, textures: Map<number, GraphDebugTextureSnapshot>): void {
  const id = textureId(texture);
  if (textures.has(id)) return;
  const source = texture.source as unknown as {
    uid: number;
    label?: string;
    width?: number;
    height?: number;
    format?: string;
    mipLevelCount?: number;
  };
  textures.set(id, {
    id,
    sourceId: source.uid,
    label: objectLabel(texture) ?? source.label ?? null,
    width: source.width ?? 0,
    height: source.height ?? 0,
    format: source.format ?? null,
    mipLevelCount: source.mipLevelCount ?? 1,
  });
}

function captureMeshInput(mesh: Mesh3DData, cache: MeshPassCache): GraphDebugMeshInputState {
  return {
    geometryId: mesh.geometry.uid,
    materialId: mesh.material.uid,
    textureSourceIds: mesh.material._textures.map((texture) => texture.source.uid),
    shader: cache.shader,
    batchKey: cache.batchKey,
  };
}

function compareDrawBuildState(
  previous: GraphDebugBatchPassState | undefined,
  current: GraphDebugBatchPassState,
): GraphDebugDrawBuildSnapshot {
  if (current.alwaysRebuild) {
    return { status: 'dynamic', commandListDirtyId: current.commandListDirtyId, causes: [] };
  }

  if (!previous) {
    return {
      status: 'first-capture',
      commandListDirtyId: current.commandListDirtyId,
      causes: [{ code: 'first-capture' }],
    };
  }

  if (previous.commandListDirtyId === current.commandListDirtyId) {
    return { status: 'reused', commandListDirtyId: current.commandListDirtyId, causes: [] };
  }

  const causes: GraphDebugDrawRebuildCause[] = [];
  if (previous.bufferVersion !== current.bufferVersion) {
    causes.push({ code: 'batch-buffer-grew', previous: previous.bufferVersion, current: current.bufferVersion });
  }

  const previousIds = new Set(previous.meshIds);
  const currentIds = new Set(current.meshIds);
  const added = current.meshIds.filter((id) => !previousIds.has(id));
  const removed = previous.meshIds.filter((id) => !currentIds.has(id));
  if (added.length > 0) causes.push({ code: 'mesh-added', meshIds: added });
  if (removed.length > 0) causes.push({ code: 'mesh-removed', meshIds: removed });

  const changedGeometry: number[] = [];
  const changedMaterial: number[] = [];
  const changedTextures: number[] = [];
  const changedShaders: number[] = [];
  const changedPipelines: number[] = [];
  for (const [meshId, mesh] of current.meshes) {
    const old = previous.meshes.get(meshId);
    if (!old) continue;
    if (old.geometryId !== mesh.geometryId) changedGeometry.push(meshId);
    if (old.materialId !== mesh.materialId) changedMaterial.push(meshId);
    if (!sameNumbers(old.textureSourceIds, mesh.textureSourceIds)) changedTextures.push(meshId);
    if (old.shader !== mesh.shader) changedShaders.push(meshId);
    if (old.batchKey !== mesh.batchKey) changedPipelines.push(meshId);
  }
  if (changedGeometry.length > 0) causes.push({ code: 'geometry-changed', meshIds: changedGeometry });
  if (changedMaterial.length > 0) causes.push({ code: 'material-changed', meshIds: changedMaterial });
  if (changedTextures.length > 0) causes.push({ code: 'texture-changed', meshIds: changedTextures });
  if (changedShaders.length > 0) causes.push({ code: 'shader-changed', meshIds: changedShaders });
  if (changedPipelines.length > 0) causes.push({ code: 'pipeline-changed', meshIds: changedPipelines });
  if (causes.length === 0) causes.push({ code: 'unknown' });

  return { status: 'rebuilt', commandListDirtyId: current.commandListDirtyId, causes };
}

function compareBundleState(
  previous: GraphDebugBatchPassState | undefined,
  current: GraphDebugBatchPassState,
  drawBuild: GraphDebugDrawBuildSnapshot,
): GraphDebugBundleSnapshot {
  if (!current.usesBundle) {
    return {
      status: 'not-used',
      bundleDirtyId: null,
      lastBundleDirtyId: null,
      causes: [],
    };
  }

  const base = {
    bundleDirtyId: current.bundleDirtyId,
    lastBundleDirtyId: current.lastBundleDirtyId,
  };
  if (!previous?.usesBundle) {
    return { ...base, status: 'first-capture', causes: [{ code: 'first-capture' }] };
  }

  const cause = drawBuild.status === 'rebuilt' ? 'draws-rebuilt' : 'bundle-only-change';
  if (current.bundleDirtyId !== current.lastBundleDirtyId) {
    return { ...base, status: 'invalidated', causes: [{ code: cause }] };
  }
  // A rebuilt draw list always re-records: the result drops its bundle when the command list
  // moves, without touching the bundle counter. Only a bundle-only change shows in the watermark.
  if (drawBuild.status === 'rebuilt' || current.lastBundleDirtyId !== previous.lastBundleDirtyId) {
    return { ...base, status: 'recorded', causes: [{ code: cause }] };
  }
  return { ...base, status: 'reused', causes: [] };
}

function forwardConfig(pass: GraphRenderPass): { cache?: 'auto' | 'never'; sort: 'distance' | 'key' } | undefined {
  return (pass as unknown as { _forward?: { sort: 'key' | 'distance'; cache?: 'auto' | 'never' } })._forward;
}

function passAlwaysRebuilds(pass: GraphRenderPass): boolean {
  const forward = forwardConfig(pass);
  if (!forward) return false;
  return (forward.cache ?? (forward.sort === 'key' ? 'auto' : 'never')) === 'never';
}

function passUsesBundle(pass: GraphRenderPass): boolean {
  if (pass.bit === RenderPassBit.SHADOW) return true;
  return Boolean(forwardConfig(pass) && !passAlwaysRebuilds(pass));
}

function textureId(texture: Texture): number {
  return (texture as unknown as { uid?: number }).uid ?? texture.source.uid;
}

function objectUid(value: object | null | undefined): number | null {
  if (!value) return null;
  return (value as { uid?: number }).uid ?? null;
}

function objectLabel(value: object): string | null {
  const label = (value as { label?: unknown }).label;
  return typeof label === 'string' && label.length > 0 ? label : null;
}

function objectType(value: object): string {
  return value.constructor?.name || 'Object';
}

function triangleCount(indexCount: number, topology: string): number | null {
  if (topology === 'triangle-list') return Math.floor(indexCount / 3);
  if (topology === 'triangle-strip') return Math.max(0, indexCount - 2);
  return null;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function addNullable(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/**
 * Where a {@link RenderGraphDebugger} finds its view: a fixed {@link View3D} or a getter for one
 * @category extras:debug
 * @advanced
 */
export type RenderGraphDebugSource = View3D | (() => View3D | null | undefined);

/**
 * Constructor options for {@link RenderGraphDebugger}
 * @example
 * ```ts
 * const debug = new RenderGraphDebugger({ view });
 * app.ticker.add(() => debug.capture(), undefined, UPDATE_PRIORITY.UTILITY);
 * ```
 * @category extras:debug
 * @advanced
 */
export interface RenderGraphDebuggerOptions {
  /** The view to debug, given directly or through a getter evaluated on every capture */
  view: RenderGraphDebugSource;
}

/**
 * Stateful, passive render-debug capture
 *
 * Call {@link RenderGraphDebugger#capture} after every rendered frame when draw-rebuild and
 * bundle-recording attribution is required: causes describe changes since the previous capture,
 * while a skipped capture necessarily collapses several frames into one comparison.
 * @category extras:debug
 * @advanced
 */
export class RenderGraphDebugger {
  private readonly _getView: () => View3D | null | undefined;
  private _previous = new Map<string, GraphDebugBatchPassState>();
  private _captureId = 0;

  /** @param options - Debugger options; see {@link RenderGraphDebuggerOptions} */
  constructor(options: RenderGraphDebuggerOptions) {
    const { view } = options;

    this._getView = typeof view === 'function' ? view : () => view;
  }

  /**
   * Capture one fully JSON-serialisable view of the resolved graph and its retained draw work
   * @param captureGeometry - Called once per distinct geometry in this capture, before it is snapshotted
   * @returns The frame snapshot, or null when the source resolves to no view with a graph
   */
  public capture(captureGeometry?: GraphDebugGeometryCapture): GraphDebugSnapshot | null {
    const view = this._getView();
    if (!view?._graph) return null;

    const captured = captureViewDebugSnapshot(view, this._previous, ++this._captureId, captureGeometry);
    this._previous = captured.states;
    return captured.snapshot;
  }

  /** Forget the comparison baseline, so the next snapshot starts again at capture 1 */
  public reset(): void {
    this._previous.clear();
    this._captureId = 0;
  }
}
