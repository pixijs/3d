import { BufferUsage, ExtensionType } from 'pixi.js';
import type { WebGPURenderer, Buffer } from 'pixi.js';

import { Buffer3D } from '../buffers/Buffer3D';
import { MESH3D_LANE_GEOMETRY, MESH3D_LANE_VISIBILITY, MESH3D_STORE_STRIDE } from '../buffers/Mesh3DDataStoreBuffer';

const DRAW_ARGS_STRUCT = /* wgsl */ `
struct DrawArgs {
  indexCount: u32,
  instanceCount: atomic<u32>,
  firstIndex: u32,
  baseVertex: u32,
  firstInstance: u32,
};
`;

const ZERO_WGSL = /* wgsl */ `
${DRAW_ARGS_STRUCT}
@group(0) @binding(0) var<storage, read_write> drawCalls: array<DrawArgs>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= arrayLength(&drawCalls)) { return; }
  atomicStore(&drawCalls[k].instanceCount, 0u);
}
`;

const COMPACT_WGSL = /* wgsl */ `
${DRAW_ARGS_STRUCT}
struct Frustum { planes: array<vec4<f32>, 6> };

// Instance records are [storeIndex, packedTextureSlots] — 2 u32 each.
@group(0) @binding(0) var<storage, read>       srcInstances: array<u32>;
@group(0) @binding(1) var<storage, read_write> dstInstances: array<u32>;
@group(0) @binding(2) var<storage, read_write> drawCalls:    array<DrawArgs>;
// Batch store rows (see Mesh3DDataStoreBuffer's lane constants): row 'id' = the instance's local
// matrix in lanes 0-15 (column-major mat4x4, bitcast) + the GEOM_LANE bounds slot + VIS_LANE flag.
// (Row 0 holds the batch world matrix for the vertex shader; the cull works in batch-local space
// so never reads it.)
@group(0) @binding(3) var<storage, read>       store:        array<u32>;
// Per-geometry data rows (stride 2 vec4s — see GeometryDataStoreBuffer), keyed
// by the lane-18 slot. The cull reads only the first texel: the bounding sphere
// (center.xyz, radius.w). radius < 0 = dynamic geometry — registered for its
// morph texel but never frustum-culled (streamed contents, unknowable bounds).
@group(0) @binding(4) var<storage, read>       geomBounds:   array<vec4<f32>>;
@group(0) @binding(5) var<uniform>             frustum:      Frustum;

const STRIDE: u32 = ${MESH3D_STORE_STRIDE}u;
const GEOM_LANE: u32 = ${MESH3D_LANE_GEOMETRY}u;
const VIS_LANE: u32 = ${MESH3D_LANE_VISIBILITY}u; // per-instance visibility: 0 = hidden, non-zero = visible
const NO_BOUNDS: u32 = 0xffffffffu; // geometry-lane sentinel for dynamic / unregistered geometry

// Matrix lanes are stored as f32 bit patterns in the u32-bound store. Column-major,
// the same bytes the vertex shader reads as the renderable's 'transform'.
fn loadMatrix(base: u32) -> mat4x4<f32> {
  return mat4x4<f32>(
    bitcast<f32>(store[base + 0u]),  bitcast<f32>(store[base + 1u]),  bitcast<f32>(store[base + 2u]),  bitcast<f32>(store[base + 3u]),
    bitcast<f32>(store[base + 4u]),  bitcast<f32>(store[base + 5u]),  bitcast<f32>(store[base + 6u]),  bitcast<f32>(store[base + 7u]),
    bitcast<f32>(store[base + 8u]),  bitcast<f32>(store[base + 9u]),  bitcast<f32>(store[base + 10u]), bitcast<f32>(store[base + 11u]),
    bitcast<f32>(store[base + 12u]), bitcast<f32>(store[base + 13u]), bitcast<f32>(store[base + 14u]), bitcast<f32>(store[base + 15u]),
  );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let instanceCount = arrayLength(&srcInstances) / 2u;
  if (i >= instanceCount) { return; }

  // Visibility first — it needs only the instance id, so a hidden instance skips the
  // command binary-search entirely (a hidden subtree is warp-coherent, the win is real).
  // Set from Container3D.worldVisible; lets a hide/show land without rebuilding the draw commands.
  let id = srcInstances[i * 2u];
  if (store[id * STRIDE + VIS_LANE] == 0u) { return; }

  // Resolve this instance's draw command: the greatest command whose
  // firstInstance <= i (instances are contiguous per command in draw order,
  // so firstInstance lanes are cumulative and ascending).
  var lo = 0u;
  var hi = arrayLength(&drawCalls) - 1u;
  while (lo < hi) {
    let mid = (lo + hi + 1u) >> 1u;
    if (drawCalls[mid].firstInstance <= i) { lo = mid; } else { hi = mid - 1u; }
  }

  // Frustum cull in the batch's local frame. The instance's own matrix 'local' (store row 'id')
  // places the geometry's bounding sphere; the frustum was transformed into this same frame on the
  // CPU (by Bᵀ), so the batch world matrix never enters here — no per-instance B x L combine. The
  // bound is loose: only false negatives (draw something off-screen), never false positives.
  // Skipped when the geometry has no registered bounds.
  let boundsSlot = store[id * STRIDE + GEOM_LANE];
  if (boundsSlot != NO_BOUNDS) {
    // Rows are two texels; the sphere is the first. radius < 0 = no bounds.
    let sphere = geomBounds[boundsSlot * 2u];
    if (sphere.w >= 0.0) {
      let local = loadMatrix(id * STRIDE);
      let center = local * vec4<f32>(sphere.xyz, 1.0);
      // Conservative radius under scale: the longest basis column.
      let sx = dot(local[0].xyz, local[0].xyz);
      let sy = dot(local[1].xyz, local[1].xyz);
      let sz = dot(local[2].xyz, local[2].xyz);
      let radius = sphere.w * sqrt(max(sx, max(sy, sz)));
      for (var p = 0u; p < 6u; p = p + 1u) {
        let plane = frustum.planes[p];
        if (dot(plane.xyz, center.xyz) + plane.w < -radius) { return; }
      }
    }
  }

  let slot = atomicAdd(&drawCalls[lo].instanceCount, 1u);
  let dst = (drawCalls[lo].firstInstance + slot) * 2u;
  dstInstances[dst] = srcInstances[i * 2u];
  dstInstances[dst + 1u] = srcInstances[i * 2u + 1u];
}
`;

/** One batch's compaction inputs, recorded per `ComputeSystemGpu.dispatch`, flushed in `renderEnd` */
interface CompactionJob {
  drawCalls: Buffer;
  src: Buffer;
  dst: Buffer;
  store: Buffer;
  bounds: Buffer;
  /** Per-slot uniform holding this view's 6 frustum planes — created once, reused, content refreshed per frame */
  params: Buffer3D;
  paramsF32: Float32Array;
  commandCount: number;
  instanceCount: number;
}

/** Zero-pass bind-group cache entry — invalidated when the bound command count changes */
interface ZeroBindEntry {
  readonly bindGroup: GPUBindGroup;
  readonly commandCount: number;
}

/** Compact-pass bind-group cache entry — invalidated when any bound buffer handle or count changes */
interface CompactBindEntry {
  readonly bindGroup: GPUBindGroup;
  readonly src: GPUBuffer;
  readonly dst: GPUBuffer;
  readonly drawCalls: GPUBuffer;
  readonly store: GPUBuffer;
  readonly bounds: GPUBuffer;
  readonly params: GPUBuffer;
  readonly commandCount: number;
  readonly instanceCount: number;
}

/**
 * GPU compaction over the per-batch instance + draw-call buffers, dispatched in the graph's
 * prepare pre-sweep
 *
 * Two compute passes per frame:
 *
 * 1. **zero** — one thread per draw command; resets each command's
 *    `instanceCount` lane to 0 so the compaction can accumulate from zero.
 * 2. **compact** — one thread per instance. Each thread resolves its draw
 *    command by binary-searching the draw-call buffer's `firstInstance` lanes
 *    (instances are laid out in draw-command order, so a command is a
 *    contiguous range and `firstInstance` is its cumulative start), then
 *    atomically appends its instance into the command's region of the compacted
 *    output buffer via `atomicAdd(&instanceCount)`. The command's `firstInstance`
 *    (baked, never rewritten) stays the region base, so the indirect draw reads
 *    the same slot range with a rebuilt (possibly shrunken) count.
 *
 * The two passes run in that order so the pass boundary orders the zero writes
 * ahead of the compaction's atomics — WebGPU has no intra-pass barrier.
 *
 * The compact kernel gates each append on two predicates read from the batch
 * store row: a per-instance **visibility** flag (lane 19, mirrored from
 * `Container3D.worldVisible`) and a **frustum** test of the geometry's bounding
 * sphere. An instance that fails either is simply not appended — its command's
 * rebuilt `instanceCount` shrinks, while the survivors stay contiguous from the
 * baked `firstInstance`, so the indirect draw reads a smaller slice of the same
 * bundle (no re-record).
 *
 * Runs on its **own** command encoder, built and submitted in `renderEnd`: pixi
 * keeps the frame encoder's render pass open through the pre-sweep (locking it
 * against a compute pass), and the render commands are *encoded* during the loop
 * but not *submitted* until `GpuEncoderSystem.postrender`. `renderEnd` fires
 * between the two, so the queue order (all prepare `writeBuffer`s → this compute
 * submit → render submit) makes the compaction visible to the render's
 * `drawIndexedIndirect`, no barrier. Registered as a WebGPU renderer system
 * (`renderer.compute3d`) — the renderer wires the `renderStart`/`renderEnd` runner
 * hooks; one compute submit per frame regardless of view/pass count.
 * @internal
 */
export class ComputeSystemGpu {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGPUSystem],
    name: 'compute3d',
  } as const;

  private readonly _renderer: WebGPURenderer;
  private _zeroPipeline: GPUComputePipeline | null = null;
  private _compactPipeline: GPUComputePipeline | null = null;
  // Bind groups cached per draw-call GPUBuffer (the per-batch identity).
  private _zeroBinds = new WeakMap<GPUBuffer, ZeroBindEntry>();
  private _compactBinds = new WeakMap<GPUBuffer, CompactBindEntry>();
  // Reused job slots — dispatch() runs per batch per frame and must not allocate.
  private readonly _jobs: CompactionJob[] = [];
  private _jobCount = 0;

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
  }

  /** Reset the frame's job list — defensive if a mid-loop throw skipped `renderEnd` */
  public renderStart(): void {
    this._jobCount = 0;
  }

  /**
   * Record a batch's compaction into the frame's job list
   *
   * No encoding yet — the two passes need every zero dispatch to precede every compact
   * dispatch, so the encoder is built in `renderEnd`. `src`/`dst` are the batch's
   * instance + compacted-instance buffers (2 u32 per record); `drawCalls` holds
   * `commandCount` × 5-u32 indirect args; `store` holds the instance rows (the cull reads each
   * instance's local matrix) and `bounds` the per-geometry sphere store. `planes` is the 6 frustum
   * planes (24 floats) already transformed into this batch's local frame (see
   * `transformFrustumToBatch`), snapshotted into the slot's uniform.
   * @param drawCalls - The batch's indirect args, `commandCount` × 5 u32
   * @param src - The batch's instance records, 2 u32 each
   * @param dst - Receives the compacted survivors
   * @param store - The batch's instance rows; the cull reads each instance's local matrix
   * @param bounds - The per-geometry bounding-sphere store
   * @param planes - The 6 frustum planes (24 floats) in the batch's local frame
   * @param commandCount - Number of draw commands in `drawCalls`
   * @param instanceCount - Number of instance records in `src`
   */
  public dispatch(
    drawCalls: Buffer,
    src: Buffer,
    dst: Buffer,
    store: Buffer,
    bounds: Buffer,
    planes: Float32Array,
    commandCount: number,
    instanceCount: number,
  ): void {
    if (commandCount === 0 || instanceCount === 0) return;

    let job = this._jobs[this._jobCount];
    if (!job) {
      const paramsF32 = new Float32Array(24);
      job = this._jobs[this._jobCount] = {
        drawCalls: null!,
        src: null!,
        dst: null!,
        store: null!,
        bounds: null!,
        params: new Buffer3D({
          data: paramsF32,
          usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
          label: 'mesh3d_cull_frustum',
          shrinkToFit: false,
        }),
        paramsF32,
        commandCount: 0,
        instanceCount: 0,
      };
    }
    job.drawCalls = drawCalls;
    job.src = src;
    job.dst = dst;
    job.store = store;
    job.bounds = bounds;
    // Snapshot this frame's planes into the slot's uniform (planes is a live,
    // per-frame-mutated backing array — copy, don't alias). Upload is flushed
    // by getGPUBuffer(params) in renderEnd, queue-ordered before the compute.
    job.paramsF32.set(planes);
    job.params.update();
    job.commandCount = commandCount;
    job.instanceCount = instanceCount;
    this._jobCount++;
  }

  /**
   * Build and submit the frame's compaction
   *
   * A zero pass over every job's draw-call counts, then — after the pass boundary orders those
   * writes — a compact pass appending survivors. One submit, ahead of the render submit in
   * queue order. No-op if no batch dispatched this frame.
   */
  public renderEnd(): void {
    const jobCount = this._jobCount;
    this._jobCount = 0;
    if (jobCount === 0) return;

    const device = this._renderer.gpu.device;
    const bufferSys = this._renderer.buffer;
    const zeroPipeline = this._zeroPipeline || this._buildPipeline(device, ZERO_WGSL, '_zeroPipeline');
    const compactPipeline = this._compactPipeline || this._buildPipeline(device, COMPACT_WGSL, '_compactPipeline');
    const encoder = device.createCommandEncoder();
    const jobs = this._jobs;

    // Pass 1 — zero every command's instanceCount (the accumulation baseline).
    const zeroPass = encoder.beginComputePass();
    zeroPass.setPipeline(zeroPipeline);
    for (let i = 0; i < jobCount; i++) {
      const job = jobs[i];
      const drawCalls = bufferSys.getGPUBuffer(job.drawCalls);
      zeroPass.setBindGroup(0, this._zeroBindGroup(device, zeroPipeline, drawCalls, job.commandCount));
      zeroPass.dispatchWorkgroups(Math.ceil(job.commandCount / 64));
    }
    zeroPass.end();

    // Pass 2 — compact survivors + rebuild instanceCount.
    const compactPass = encoder.beginComputePass();
    compactPass.setPipeline(compactPipeline);
    for (let i = 0; i < jobCount; i++) {
      const job = jobs[i];
      compactPass.setBindGroup(0, this._compactBindGroup(device, compactPipeline, job, bufferSys));
      compactPass.dispatchWorkgroups(Math.ceil(job.instanceCount / 64));
    }
    compactPass.end();

    device.queue.submit([encoder.finish()]);

    // Drop buffer references so a destroyed batch isn't pinned by the pooled array
    // between frames. `params` stays — it's the slot's own reusable uniform.
    for (let i = 0; i < jobCount; i++) {
      jobs[i].drawCalls = null!;
      jobs[i].src = null!;
      jobs[i].dst = null!;
      jobs[i].store = null!;
      jobs[i].bounds = null!;
    }
  }

  /**
   * Zero-pass bind group
   *
   * Draw-calls bound tight (`commandCount` × 20 bytes) so `arrayLength(&drawCalls)` yields the
   * command count. Cached per GPUBuffer.
   * @param device - The GPU device that creates the group
   * @param pipeline - The zero pipeline whose layout the group follows
   * @param drawCalls - The batch's indirect-args buffer
   * @param commandCount - Number of commands to bind, 20 bytes each
   */
  private _zeroBindGroup(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    drawCalls: GPUBuffer,
    commandCount: number,
  ): GPUBindGroup {
    const cached = this._zeroBinds.get(drawCalls);
    if (cached && cached.commandCount === commandCount) return cached.bindGroup;

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: drawCalls, offset: 0, size: commandCount * 20 } }],
    });
    this._zeroBinds.set(drawCalls, { bindGroup, commandCount });
    return bindGroup;
  }

  /**
   * Compact-pass bind group
   *
   * Binds src (read) + dst (read_write) instances tight (`instanceCount` × 8 bytes →
   * `arrayLength / 2` = instance count), draw-calls tight (`commandCount` × 20), plus the batch
   * store, per-geometry bounds, and frustum-plane uniform (whole). Rebuilt when any bound handle
   * or count changes (buffer growth mints a new GPUBuffer).
   * @param device - The GPU device that creates the group
   * @param pipeline - The compact pipeline whose layout the group follows
   * @param job - The compaction job whose buffers and counts get bound
   * @param bufferSys - Resolves the job's buffers to their GPU buffers
   */
  private _compactBindGroup(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    job: CompactionJob,
    bufferSys: WebGPURenderer['buffer'],
  ): GPUBindGroup {
    const src = bufferSys.getGPUBuffer(job.src);
    const dst = bufferSys.getGPUBuffer(job.dst);
    const drawCalls = bufferSys.getGPUBuffer(job.drawCalls);
    const store = bufferSys.getGPUBuffer(job.store);
    const bounds = bufferSys.getGPUBuffer(job.bounds);
    const params = bufferSys.getGPUBuffer(job.params);

    const cached = this._compactBinds.get(drawCalls);
    if (
      cached &&
      cached.src === src &&
      cached.dst === dst &&
      cached.drawCalls === drawCalls &&
      cached.store === store &&
      cached.bounds === bounds &&
      cached.params === params &&
      cached.commandCount === job.commandCount &&
      cached.instanceCount === job.instanceCount
    ) {
      return cached.bindGroup;
    }

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src, offset: 0, size: job.instanceCount * 8 } },
        { binding: 1, resource: { buffer: dst, offset: 0, size: job.instanceCount * 8 } },
        { binding: 2, resource: { buffer: drawCalls, offset: 0, size: job.commandCount * 20 } },
        { binding: 3, resource: { buffer: store } },
        { binding: 4, resource: { buffer: bounds } },
        { binding: 5, resource: { buffer: params } },
      ],
    });
    this._compactBinds.set(drawCalls, {
      bindGroup,
      src,
      dst,
      drawCalls,
      store,
      bounds,
      params,
      commandCount: job.commandCount,
      instanceCount: job.instanceCount,
    });
    return bindGroup;
  }

  private _buildPipeline(
    device: GPUDevice,
    code: string,
    field: '_zeroPipeline' | '_compactPipeline',
  ): GPUComputePipeline {
    const module = device.createShaderModule({ code });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    this[field] = pipeline;
    return pipeline;
  }

  /** Free the pooled per-slot uniforms and drop cached GPU objects */
  public destroy(): void {
    for (const job of this._jobs) job.params?.destroy();
    this._jobs.length = 0;
    this._zeroPipeline = null;
    this._compactPipeline = null;
    this._zeroBinds = new WeakMap();
    this._compactBinds = new WeakMap();
    this._jobCount = 0;
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUSystems {
      /** GPU cull/compaction compute over the per-batch draw-call buffers */
      compute3d: ComputeSystemGpu;
    }
  }
}
