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

/**
 * Reads rows as `Mesh3DDataStoreBuffer` lays them out and never culls a negative radius, which
 * `GeometryDataStoreBuffer` writes for dynamic geometry; the command search needs `firstInstance` ascending
 */
const COMPACT_WGSL = /* wgsl */ `
${DRAW_ARGS_STRUCT}
struct Frustum { planes: array<vec4<f32>, 6> };

@group(0) @binding(0) var<storage, read>       srcInstances: array<u32>;
@group(0) @binding(1) var<storage, read_write> dstInstances: array<u32>;
@group(0) @binding(2) var<storage, read_write> drawCalls:    array<DrawArgs>;
@group(0) @binding(3) var<storage, read>       store:        array<u32>;
@group(0) @binding(4) var<storage, read>       geomBounds:   array<vec4<f32>>;
@group(0) @binding(5) var<uniform>             frustum:      Frustum;

const STRIDE: u32 = ${MESH3D_STORE_STRIDE}u;
const GEOM_LANE: u32 = ${MESH3D_LANE_GEOMETRY}u;
const VIS_LANE: u32 = ${MESH3D_LANE_VISIBILITY}u;
const NO_BOUNDS: u32 = 0xffffffffu;

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
  let instanceCount = arrayLength(&srcInstances);
  if (i >= instanceCount) { return; }

  let id = srcInstances[i];
  if (store[id * STRIDE + VIS_LANE] == 0u) { return; }

  var lo = 0u;
  var hi = arrayLength(&drawCalls) - 1u;
  while (lo < hi) {
    let mid = (lo + hi + 1u) >> 1u;
    if (drawCalls[mid].firstInstance <= i) { lo = mid; } else { hi = mid - 1u; }
  }

  let boundsSlot = store[id * STRIDE + GEOM_LANE];
  if (boundsSlot != NO_BOUNDS) {
    let sphere = geomBounds[boundsSlot * 2u];
    if (sphere.w >= 0.0) {
      let local = loadMatrix(id * STRIDE);
      let center = local * vec4<f32>(sphere.xyz, 1.0);
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
  dstInstances[drawCalls[lo].firstInstance + slot] = id;
}
`;

interface CompactionJob {
  drawCalls: Buffer;
  src: Buffer;
  dst: Buffer;
  store: Buffer;
  bounds: Buffer;
  params: Buffer3D;
  paramsF32: Float32Array;
  commandCount: number;
  instanceCount: number;
}

interface ZeroBindEntry {
  readonly bindGroup: GPUBindGroup;
  readonly commandCount: number;
}

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
 * Submits its own encoder in `renderEnd`, between the frame's buffer writes and its render submit,
 * since pixi holds the frame encoder's render pass open; zeroing is its own pass, as WebGPU has no barrier within one
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
  private _zeroBinds = new WeakMap<GPUBuffer, ZeroBindEntry>();
  private _compactBinds = new WeakMap<GPUBuffer, CompactBindEntry>();
  /** Reused every frame, since `dispatch` runs per batch per frame and must not allocate */
  private readonly _jobs: CompactionJob[] = [];
  private _jobCount = 0;
  private _destroyed = false;

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
  }

  /** Resets the jobs in case a throw skipped the last `renderEnd` */
  public renderStart(): void {
    this._jobCount = 0;
  }

  /**
   * Only records the job, since `renderEnd` must encode every zero before any compact; copies `planes`,
   * which callers reuse as scratch
   * @param drawCalls - The result's indirect args, 5 `u32` per command
   * @param src - The list's instance records, one store index each
   * @param dst - Receives the survivors
   * @param store - The batch's store
   * @param bounds - The per-geometry store
   * @param planes - The 24 frustum plane floats, in the batch's frame
   * @param commandCount - Commands in `drawCalls`
   * @param instanceCount - Records in `src`
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
    job.paramsF32.set(planes);
    job.params.update();
    job.commandCount = commandCount;
    job.instanceCount = instanceCount;
    this._jobCount++;
  }

  /**
   * Drops each job's batch buffers after the submit, so a pooled slot pins no destroyed batch; `params`
   * is the slot's own and stays
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

    const zeroPass = encoder.beginComputePass();
    zeroPass.setPipeline(zeroPipeline);
    for (let i = 0; i < jobCount; i++) {
      const job = jobs[i];
      const drawCalls = bufferSys.getGPUBuffer(job.drawCalls);
      zeroPass.setBindGroup(0, this._zeroBindGroup(device, zeroPipeline, drawCalls, job.commandCount));
      zeroPass.dispatchWorkgroups(Math.ceil(job.commandCount / 64));
    }
    zeroPass.end();

    const compactPass = encoder.beginComputePass();
    compactPass.setPipeline(compactPipeline);
    for (let i = 0; i < jobCount; i++) {
      const job = jobs[i];
      compactPass.setBindGroup(0, this._compactBindGroup(device, compactPipeline, job, bufferSys));
      compactPass.dispatchWorkgroups(Math.ceil(job.instanceCount / 64));
    }
    compactPass.end();

    device.queue.submit([encoder.finish()]);

    for (let i = 0; i < jobCount; i++) {
      jobs[i].drawCalls = null!;
      jobs[i].src = null!;
      jobs[i].dst = null!;
      jobs[i].store = null!;
      jobs[i].bounds = null!;
    }
  }

  /** Binds `drawCalls` tight, since the kernel reads the command count from `arrayLength` */
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

  /** Binds `src`, `dst` and `drawCalls` tight, since the kernel reads its counts from `arrayLength` */
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
        { binding: 0, resource: { buffer: src, offset: 0, size: job.instanceCount * 4 } },
        { binding: 1, resource: { buffer: dst, offset: 0, size: job.instanceCount * 4 } },
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

  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const job of this._jobs) job.params?.destroy();
    (this._jobs as CompactionJob[] | null) = null;
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
      /** Culls batched instances on the GPU */
      compute3d: ComputeSystemGpu;
    }
  }
}
