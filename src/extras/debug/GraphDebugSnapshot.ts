import { RendererType } from 'pixi.js';
import type { Texture } from 'pixi.js';

import type { Mesh3DBatch } from '../../core/batcher/Mesh3DBatch';
import type { Mesh3DData, MeshPassCache } from '../../core/batcher/Mesh3DData';
import { MESH3D_LANE_VISIBILITY } from '../../core/buffers/Mesh3DDataStoreBuffer';
import { resolveCullProducer, transformFrustumToBatch } from '../../core/cull';
import type { ShadowDataGpu } from '../../core/gpu/ShadowRenderPassGpu';
import type { GraphRenderPass } from '../../core/render-graph/GraphRenderPass';
import type { ResourceAccess } from '../../core/render-graph/PassBuilder';
import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import type { ResourceHandle, ResourceKind } from '../../core/render-graph/ResourceHandle';
import type { CullResult } from '../../core/render-passes/CullResult';
import type { CullResults } from '../../core/render-passes/CullResults';
import type { DrawList } from '../../core/render-passes/DrawList';
import { cachesDrawWork } from '../../core/render-passes/RenderForwardDescriptor';
import type { RenderForwardDescriptor } from '../../core/render-passes/RenderForwardDescriptor';
import { RenderPassBit } from '../../core/render-passes/RenderPass';
import type { RenderPass } from '../../core/render-passes/RenderPass';
import { cascadeCountFor, castsShadowThisFrame, updateRateFor } from '../../core/render-passes/shadow/shadowPassUtils';
import type { Geometry3D } from '../../geometry/Geometry3D';
import type { Light } from '../../scene/lights/Light';
import type { View3D } from '../../scene/View3D';

/**
 * Serialization version stamped onto every {@link GraphDebugSnapshot}
 * @category extras:debug
 * @advanced
 */
export const GRAPH_DEBUG_SNAPSHOT_VERSION = 4;

/**
 * Kind of scene pass: a forward pass that draws meshes, or the shadow pass
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
  /** Name of the binding a `sample` access is bound as */
  slot?: string;
  /** Whether a sample access binds into the view's global group rather than one the pass owns */
  globalGroup?: boolean;
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
  /** Which kind of scene pass this is; null for every other pass, such as a fullscreen effect */
  sceneWorkload: GraphDebugScenePassKind | null;
  /** Whether the pass survived the graph's dependency cull */
  active: boolean;
  /** Execution index among active passes; null when the pass was culled */
  passIdx: number | null;
  /**
   * Whether the pass always survives the cull: it called {@link PassBuilder#sideEffect}, or writes
   * or produces an imported resource or a camera target the graph copies out
   */
  isAnchored: boolean;
  /**
   * Ids of the colour resources this pass writes last in the frame; after the pass the graph
   * resolves the multisampled ones and generates mipmaps for those whose source has
   * `autoGenerateMipmaps` set
   */
  finishedColors: number[];
  /** Indices into {@link GraphDebugGraphSnapshot#passes} of the passes this one depends on; names can repeat */
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
  /** Source width, in pixels divided by the source's `resolution` */
  width: number;
  /** Source height, in pixels divided by the source's `resolution` */
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
  /** Whether the mesh and every one of its ancestors is visible */
  visible: boolean;
}

/**
 * Why a batch pass rebuilt or repacked its draw commands
 *
 * - `'order-changed'`: the same meshes now draw in another order, as when a pass sorted by distance
 *   sees the camera move past two of them.
 * - `'tail'`: on a repacked list, the meshes drawn by commands added after the last build, since no
 *   built command could draw them.
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
  | 'order-changed'
  | 'pipeline-changed'
  | 'shader-changed'
  | 'tail'
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
  /**
   * What happened to the pass's draw commands since the previous capture
   *
   * - `'reused'`: kept as they were.
   * - `'repacked'`: kept while meshes joined or left; their instance ranges moved, and any mesh no
   *   built command could draw got a new command after the built ones (the `'tail'` cause).
   * - `'rebuilt'`: built again; `causes` says why.
   * - `'dynamic'`: rebuilt every frame, as a pass sorted by key with `cache: 'never'` does.
   * - `'first-capture'`: no previous capture to compare with.
   */
  status: 'dynamic' | 'first-capture' | 'rebuilt' | 'repacked' | 'reused';
  /** Revision of the pass's draw commands */
  commandListDirtyId: number;
  /** Attributed causes when the commands were rebuilt or repacked */
  causes: GraphDebugDrawRebuildCause[];
}

/**
 * Why a batch pass recorded or invalidated its WebGPU bundle
 *
 * - `'first-capture'`: the first capture to see the bundle, so earlier activity is unknown.
 * - `'draws-rebuilt'`: the pass rebuilt its draw commands.
 * - `'bundle-only-change'`: the draws weren't rebuilt, but a resource the bundle baked changed, such as
 *   the environment map, the shadow map or a texture the pass samples.
 * - `'counts-changed'`: hiding or showing a mesh changed an instance count the bundle baked in. Only
 *   a batch with `cull: 'off'` drawn with direct draws, as on Safari and iOS, bakes its counts.
 * @category extras:debug
 * @advanced
 */
export type GraphDebugBundleCauseCode = 'bundle-only-change' | 'counts-changed' | 'draws-rebuilt' | 'first-capture';

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
  /**
   * What happened to the pass's bundle since the previous capture
   *
   * - `'reused'`: drawn again as recorded.
   * - `'recorded'`: recorded anew; `causes` says why.
   * - `'invalidated'`: still due to be recorded when the frame was captured. The shadow pass can stay
   *   here for several frames, until every cascade that its {@link LightShadow.update} rate skipped
   *   has drawn again.
   * - `'first-capture'`: no previous capture to compare with.
   * - `'not-used'`: the pass keeps no bundle for the batch: on WebGL, with `cache: 'never'` (the
   *   default for a distance sort), and in a shadow pass where no visible shadow-casting light holds one.
   */
  status: 'first-capture' | 'invalidated' | 'not-used' | 'recorded' | 'reused';
  /** Bundle cache revision requested by the renderer; null when the status is `'not-used'` */
  bundleDirtyId: number | null;
  /**
   * Revision the recorded bundle was built at; null when the status is `'not-used'`, `-1` when
   * nothing is recorded yet
   *
   * In the shadow pass it's the oldest across the casting lights' cascades, and a cascade recorded
   * before the draws last rebuilt counts as `-1`. It includes cascades waiting for
   * {@link Light.refreshShadows}, which `status` ignores, so it can trail `bundleDirtyId` while
   * `status` reads `'reused'`.
   */
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
  /** The batch key every instance of the command shares: its pipeline id times 2^32 plus its geometry uid */
  batchKey: number;
  /**
   * How the command binds materials: `'direct'` binds one material's own group, `'merged'` one
   * group for every material of a texture set, each instance reading its own row, and
   * `'no-material'` none, for a pass with a shader of its own
   */
  form: 'direct' | 'merged' | 'no-material';
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
  /**
   * How `drawnInstanceCount` was obtained: an exact CPU count, a CPU rerun of the GPU cull, or not at
   * all without a GPU readback
   */
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
  /** Draw commands in the pass's list, each counted once even when the pass replays the list */
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
  /** Draw commands summed across passes */
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
  /** Draw commands across active scene passes, each counted once however often its pass replays it */
  drawCallCount: number;
  /** Batcher-assigned instances summed across batches */
  sourceInstanceCount: number;
  /** Surviving instances summed across batches; null when any pass would need a GPU readback */
  drawnInstanceCount: number | null;
}

/**
 * JSON-serialisable capture of one rendered frame
 *
 * Holds the render graph and every batch, mesh, geometry, material and texture the scene passes
 * drew. A scene pass keeps ("retains") its draw commands between frames and rebuilds them only
 * when something they depend on changes.
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugSnapshot {
  /** Serialization version of this shape */
  version: typeof GRAPH_DEBUG_SNAPSHOT_VERSION;
  /** Starts at 1 and counts up with each capture; {@link RenderGraphDebugger#reset} restarts it */
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
  finishedColors: { _id: number }[];
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
  rangesDirtyId: number;
  bufferVersion: number;
  alwaysRebuild: boolean;
  usesBundle: boolean;
  bundleDirtyId: number | null;
  lastBundleDirtyId: number | null;
  /** `null` unless a bundle of direct draws is kept; in the shadow pass, a sum over every light's cascades */
  lastBundleCountsDirtyId: number | null;
  /** `lastBundleDirtyId` without cascades waiting for `Light.refreshShadows`; `null` when they all wait */
  scheduledBundleDirtyId: number | null;
  /** Cause of a bundle still stale at this capture, reported when it finally records */
  pendingBundleCause: GraphDebugBundleCauseCode | null;
  /** Mesh uids in draw order, so a capture can tell `'order-changed'` */
  meshIds: number[];
  tailMeshIds: number[];
  meshes: Map<number, GraphDebugMeshInputState>;
}

interface GraphDebugCaptureResult {
  snapshot: GraphDebugSnapshot;
  states: Map<string, GraphDebugBatchPassState>;
}

/**
 * Capture the passes and resources of a render graph's last resolve as plain data
 * @param graph - The graph to inspect, once it has resolved a frame
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
      finishedColors: addedPass.finishedColors.map((handle) => handle._id),
      dependsOn: addedPass.dependsOn.map((dependency) => declaredIdxByPass.get(dependency)!),
      accesses: addedPass.record.accesses.map((access) => ({
        mode: access.mode,
        handleId: access.handle._id,
        handleKind: access.handle._kind,
        slot: access.binding?.slot,
        globalGroup: access.binding
          ? access.binding.group === graph.globalTextureBindings.opaqueColor.group
          : undefined,
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

function captureViewDebugSnapshot(
  view: View3D,
  previous: ReadonlyMap<string, GraphDebugBatchPassState>,
  captureId: number,
  captureGeometry?: (geometry: Geometry3D) => void,
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

      const captured = captureBatchPass(batch, pass, passData, previous, view);
      passes.push(captured.snapshot);
      states.set(captured.state.key, captured.state);
      submittedMeshCount += captured.snapshot.renderableCount;
      drawCallCount += captured.snapshot.drawCallCount;
      sourceInstanceCount += captured.snapshot.sourceInstanceCount;
      drawnInstanceCount = addNullable(drawnInstanceCount, captured.snapshot.drawnInstanceCount);

      for (let i = 0; i < captured.state.meshIds.length; i++) {
        const mesh = passData.view.items[passData.view.renderableIndices[i]];
        captureMesh(mesh, meshes, geometries, materials, textures, captureGeometry);
        activeMeshIds.add(mesh.uid);
        geometryIds.add(mesh.geometry.uid);
        materialIds.add(mesh.material.uid);
        for (let t = 0; t < mesh.material._textures.length; t++) textureIds.add(textureId(mesh.material._textures[t]));
      }
    }

    batches.push({
      id: batch.uid,
      label: batchIndex === 0 ? 'scene' : batch.renderData.label || `batch ${batchIndex}`,
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
  view: View3D,
): { snapshot: GraphDebugBatchPassSnapshot; state: GraphDebugBatchPassState } {
  const bit = pass.bit;
  const key = `${batch.uid}:${bit}`;
  const meshStates = new Map<number, GraphDebugMeshInputState>();
  for (let i = 0; i < passData.view.count; i++) {
    const mesh = passData.view.items[passData.view.renderableIndices[i]];
    meshStates.set(mesh.uid, captureMeshInput(mesh, mesh._passCache[bit]));
  }
  const drawn = meshesInDrawOrder(passData);
  const meshIds = drawn.flatMap((mesh) => (mesh ? [mesh.uid] : []));
  const bodyCount = passData.commandList.bodyCount;
  const tailStart =
    bodyCount < passData.commandList.count ? passData.drawData.drawCalls[bodyCount * 5 + 4] : drawn.length;
  const tailMeshIds = drawn.slice(tailStart).flatMap((mesh) => (mesh ? [mesh.uid] : []));

  const result = cullResultFor(pass, batch);
  const args = result ? result.indirectDrawData.drawCalls : passData.drawData.drawCalls;
  const webGpu = pass.pipe.renderer.type === RendererType.WEBGPU;
  const forward = forwardConfig(pass);
  let lastBundleDirtyId: number | null = null;
  let scheduledBundleDirtyId: number | null = null;
  let lastBundleCountsDirtyId: number | null = null;
  if (webGpu && bit === RenderPassBit.SHADOW) {
    lastBundleDirtyId = shadowBundleWatermark(view.lights, batch, passData, true);
    scheduledBundleDirtyId = shadowBundleWatermark(view.lights, batch, passData, false);
    lastBundleCountsDirtyId = shadowBundleCountsDirtyId(view.lights, batch);
  } else if (webGpu && forward && cachesDrawWork(forward)) {
    lastBundleDirtyId = result?.lastBundleDirtyId ?? -1;
    scheduledBundleDirtyId = lastBundleDirtyId;
    if (result?.direct) lastBundleCountsDirtyId = result.lastBundleCountsDirtyId;
  }
  const usesBundle = lastBundleDirtyId !== null;
  const state: GraphDebugBatchPassState = {
    key,
    commandListDirtyId: passData.commandList.dirtyId,
    rangesDirtyId: passData.rangesDirtyId,
    bufferVersion: batch.storeBuffer.bufferVersion,
    alwaysRebuild: passAlwaysRebuilds(forward),
    usesBundle,
    bundleDirtyId: usesBundle ? passData.gpuData.bundleDirtyId : null,
    lastBundleDirtyId,
    lastBundleCountsDirtyId,
    scheduledBundleDirtyId,
    pendingBundleCause: null,
    meshIds,
    tailMeshIds,
    meshes: meshStates,
  };
  const previousState = previous.get(key);
  const drawBuild = compareDrawBuildState(previousState, state);
  const bundle = compareBundleState(previousState, state, drawBuild);
  const producer = resolveCullProducer(batch.cull, webGpu && forward?.sort !== 'distance' && !result?.direct);
  let mirroredDrawCounts: Uint32Array | null = null;
  if (producer === 'gpu' && forward) {
    mirroredDrawCounts = mirrorCullDrawCounts(passData, batch, drawn, view.camera.cullFrustum.planesData);
  } else if (producer === 'off' && webGpu) {
    mirroredDrawCounts = mirrorCullDrawCounts(passData, batch, drawn, null);
  }
  const draws = captureDraws(passData, drawn, args, mirroredDrawCounts, producer === 'gpu');
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

/** Mirror of `ForwardRenderPass.cullResults` */
interface CullingPass {
  cullResults?: CullResults;
}

/**
 * The pass's cull result for `batch`; none on WebGL, which culls the draw list's args in place, or
 * in the shadow pass, whose results live on each light
 */
function cullResultFor(pass: GraphRenderPass, batch: Mesh3DBatch): CullResult | undefined {
  return (pass as CullingPass).cullResults?.get(batch);
}

/**
 * Oldest bundle watermark across the casting lights' cascades, mirroring when `ShadowRenderPassGpu`
 * re-records them; `null` when no counted cascade has a result for `batch`
 */
function shadowBundleWatermark(
  lights: readonly Light[],
  batch: Mesh3DBatch,
  list: DrawList,
  includeWaiting: boolean,
): number | null {
  const commandListDirtyId = list.commandList.dirtyId;
  let watermark: number | null = null;
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i];
    const data: ShadowDataGpu | null = light._gpuShadowData;
    if (!data?.cullResults || !castsShadowThisFrame(light)) continue;
    const cascadeCount = cascadeCountFor(light);
    for (let c = 0; c < cascadeCount; c++) {
      const result = data.cullResults.get(batch, c);
      if (!result) continue;
      if (!includeWaiting && !data.cascades?.[c]?.needsRender && updateRateFor(light.shadow.update, c) === 0) {
        continue;
      }
      const recorded = result.lastCommandListDirtyId === commandListDirtyId ? result.lastBundleDirtyId : -1;
      if (watermark === null || recorded < watermark) watermark = recorded;
    }
  }
  return watermark;
}

/**
 * Sum of `lastBundleCountsDirtyId` over every shadow light's cascades for `batch`, casting this frame
 * or not, so hiding or showing a light leaves the sum alone
 */
function shadowBundleCountsDirtyId(lights: readonly Light[], batch: Mesh3DBatch): number | null {
  let sum: number | null = null;
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i];
    const data: ShadowDataGpu | null = light._gpuShadowData;
    if (!data?.cullResults) continue;
    const cascadeCount = cascadeCountFor(light);
    for (let c = 0; c < cascadeCount; c++) {
      const result = data.cullResults.get(batch, c);
      if (result?.direct) sum = (sum ?? 0) + result.lastBundleCountsDirtyId;
    }
  }
  return sum;
}

/**
 * The list's members in draw order, `null` for a record no member holds (left by an edit after this
 * frame's `DrawList.applyEdits`), so command ranges still index the result
 */
function meshesInDrawOrder(passData: DrawList): (Mesh3DData | null)[] {
  const view = passData.view;
  const byRow = new Map<number, Mesh3DData>();
  for (let i = 0; i < view.count; i++) {
    const mesh = view.items[view.renderableIndices[i]];
    byRow.set(mesh._storeIndex, mesh);
  }

  const records = passData.records;
  const drawn: (Mesh3DData | null)[] = [];
  for (let i = 0; i < view.count; i++) drawn.push(byRow.get(records[i]) ?? null);

  return drawn;
}

function captureDraws(
  passData: DrawList,
  drawn: (Mesh3DData | null)[],
  args: Uint32Array,
  mirroredDrawCounts: Uint32Array | null,
  gpuCull: boolean,
): GraphDebugDrawSnapshot[] {
  const draws: GraphDebugDrawSnapshot[] = [];
  const commands = passData.commandList.commands;
  const count = passData.commandList.count;

  for (let i = 0; i < count; i++) {
    const offset = i * 5;
    const firstInstance = args[offset + 4];
    const nextFirstInstance = i + 1 < count ? args[(i + 1) * 5 + 4] : passData.view.count;
    const sourceCount = Math.max(0, nextFirstInstance - firstInstance);
    const sourceMeshes = drawn
      .slice(firstInstance, firstInstance + sourceCount)
      .flatMap((mesh) => (mesh ? [mesh] : []));

    const geometryIds = uniqueNumbers(sourceMeshes.map((mesh) => mesh.geometry.uid));
    const materialIds = uniqueNumbers(sourceMeshes.map((mesh) => mesh.material.uid));
    const textureIds = uniqueNumbers(
      sourceMeshes.flatMap((mesh) => mesh.material._textures.map((texture) => textureId(texture))),
    );
    const indexCount = args[offset];
    const drawnInstanceCount = mirroredDrawCounts ? mirroredDrawCounts[i] : gpuCull ? null : args[offset + 1];
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
      batchKey: commands[i].batchKey,
      form: commands[i].merged ? 'merged' : commands[i].batchBindGroup ? 'direct' : 'no-material',
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
 * Counts each command's survivors as `produceCpuCompaction` in `core/gpu/cull.ts` would; a WebGPU
 * `'off'` list needs it too, since the args the snapshot reads may hold its uncompacted counts
 */
function mirrorCullDrawCounts(
  passData: DrawList,
  batch: Mesh3DBatch,
  drawn: (Mesh3DData | null)[],
  planes: Float32Array | null,
): Uint32Array {
  const commandCount = passData.commandList.count;
  const counts = new Uint32Array(commandCount);
  const args = passData.drawData.drawCalls;
  const sourceInstances = passData.gpuData.instanceBuffer.data;
  const storeU32 = batch.storeBuffer.u32Data;
  const storeStride = batch.storeBuffer.stride;
  const transformedPlanes = planes && transformFrustumToBatch(planes, batch.storeBuffer.data);

  for (let command = 0; command < commandCount; command++) {
    const start = args[command * 5 + 4];
    const end = command + 1 < commandCount ? args[(command + 1) * 5 + 4] : passData.view.count;
    let survivors = 0;

    for (let instance = start; instance < end; instance++) {
      const storeIndex = sourceInstances[instance];
      if (storeU32[storeIndex * storeStride + MESH3D_LANE_VISIBILITY] === 0) continue;
      if (!transformedPlanes) {
        survivors++;
        continue;
      }

      const mesh = drawn[instance];
      if (!mesh) continue;
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
  captureGeometry?: (geometry: Geometry3D) => void,
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

function pushMembershipCauses(
  causes: GraphDebugDrawRebuildCause[],
  previous: GraphDebugBatchPassState,
  current: GraphDebugBatchPassState,
): void {
  const previousIds = new Set(previous.meshIds);
  const currentIds = new Set(current.meshIds);
  const added = current.meshIds.filter((id) => !previousIds.has(id));
  const removed = previous.meshIds.filter((id) => !currentIds.has(id));
  if (added.length > 0) causes.push({ code: 'mesh-added', meshIds: added });
  if (removed.length > 0) causes.push({ code: 'mesh-removed', meshIds: removed });
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
    if (previous.rangesDirtyId === current.rangesDirtyId) {
      return { status: 'reused', commandListDirtyId: current.commandListDirtyId, causes: [] };
    }
    const causes: GraphDebugDrawRebuildCause[] = [];
    pushMembershipCauses(causes, previous, current);
    if (current.tailMeshIds.length > 0) causes.push({ code: 'tail', meshIds: current.tailMeshIds });
    return { status: 'repacked', commandListDirtyId: current.commandListDirtyId, causes };
  }

  const causes: GraphDebugDrawRebuildCause[] = [];
  if (previous.bufferVersion !== current.bufferVersion) {
    causes.push({ code: 'batch-buffer-grew', previous: previous.bufferVersion, current: current.bufferVersion });
  }

  pushMembershipCauses(causes, previous, current);

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
  if (causes.length === 0 && !sameNumbers(previous.meshIds, current.meshIds)) causes.push({ code: 'order-changed' });
  if (causes.length === 0) causes.push({ code: 'unknown' });

  return { status: 'rebuilt', commandListDirtyId: current.commandListDirtyId, causes };
}

/**
 * A rebuilt draw list counts as recorded though `bundleDirtyId` didn't move, since `CullResult`
 * drops its bundle when the command list changes
 */
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

  const cause =
    drawBuild.status === 'rebuilt' ? 'draws-rebuilt' : (previous.pendingBundleCause ?? 'bundle-only-change');
  if (current.bundleDirtyId !== current.lastBundleDirtyId) current.pendingBundleCause = cause;

  const scheduled = current.scheduledBundleDirtyId;
  if (scheduled === null) return { ...base, status: 'reused', causes: [] };
  if (current.bundleDirtyId !== scheduled) {
    return { ...base, status: 'invalidated', causes: [{ code: cause }] };
  }
  if (
    drawBuild.status === 'rebuilt' ||
    (previous.scheduledBundleDirtyId !== null && scheduled !== previous.scheduledBundleDirtyId) ||
    current.lastBundleDirtyId! > previous.lastBundleDirtyId!
  ) {
    return { ...base, status: 'recorded', causes: [{ code: cause }] };
  }
  if (
    current.lastBundleCountsDirtyId !== null &&
    current.lastBundleCountsDirtyId !== previous.lastBundleCountsDirtyId
  ) {
    return { ...base, status: 'recorded', causes: [{ code: 'counts-changed' }] };
  }
  return { ...base, status: 'reused', causes: [] };
}

function forwardConfig(pass: GraphRenderPass): RenderForwardDescriptor | undefined {
  return (pass as unknown as { _forward?: RenderForwardDescriptor })._forward;
}

/**
 * Whether the pass rebuilds every frame; a distance-sorted pass doesn't cache either, but replays
 * its commands while its order holds
 */
function passAlwaysRebuilds(forward: RenderForwardDescriptor | undefined): boolean {
  return forward !== undefined && forward.sort === 'key' && !cachesDrawWork(forward);
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
 * Captures a {@link GraphDebugSnapshot} of a view's last frame and explains what changed since
 * the previous capture
 *
 * It only reads, and changes nothing about how the view renders. Causes compare against the
 * previous capture, so call {@link RenderGraphDebugger#capture} after every rendered frame: a
 * skipped frame folds its changes into the next one.
 * @category extras:debug
 * @advanced
 */
export class RenderGraphDebugger {
  private readonly _getView: () => View3D | null | undefined;
  private _previous = new Map<string, GraphDebugBatchPassState>();
  private _captureId = 0;

  /** @param options - Options for the debugger */
  constructor(options: RenderGraphDebuggerOptions) {
    const { view } = options;

    this._getView = typeof view === 'function' ? view : () => view;
  }

  /**
   * Captures the view's last frame; `null` when there's no view, or it hasn't rendered yet
   * @param captureGeometry - Called once for each distinct geometry in the capture
   */
  public capture(captureGeometry?: (geometry: Geometry3D) => void): GraphDebugSnapshot | null {
    const view = this._getView();
    if (!view?._graph) return null;

    const captured = captureViewDebugSnapshot(view, this._previous, ++this._captureId, captureGeometry);
    this._previous = captured.states;
    return captured.snapshot;
  }

  /** Forgets the previous capture, so the next one is a first capture numbered 1 */
  public reset(): void {
    this._previous.clear();
    this._captureId = 0;
  }
}
