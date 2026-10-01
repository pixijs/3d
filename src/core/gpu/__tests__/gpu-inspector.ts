/** The part of a `GPUCommandEncoder` the inspector wraps */
interface EncoderLike {
  beginRenderPass: (...args: unknown[]) => unknown;
}

/** The part of a `GPUDevice` the inspector wraps, typed structurally so it needs no `any` */
interface DeviceLike {
  createCommandEncoder: (...args: unknown[]) => EncoderLike;
}

/** Running tally of intercepted GPU calls. Extend as more methods are wrapped. */
export interface GpuTally {
  /** `commandEncoder.beginRenderPass` calls. */
  renderPasses: number;
}

export interface GpuInspector {
  readonly tally: GpuTally;
  /** Restore the original device API. */
  restore(): void;
}

/**
 * Install the inspector on `device` (e.g. `renderer.gpu.device`). Every command
 * encoder it creates from now on tallies its `beginRenderPass` calls. Call
 * `restore()` when done.
 *
 * It shows a test what a render drove the GPU to do, which a screenshot can't, such as whether
 * several insets drew into one render pass or began one each. To watch more of the API, wrap
 * another encoder method the same way and add its count to `GpuTally`.
 */
export function inspectGpuDevice(device: unknown): GpuInspector {
  const dev = device as DeviceLike;
  const tally: GpuTally = { renderPasses: 0 };

  const createCommandEncoder = dev.createCommandEncoder;
  dev.createCommandEncoder = function (this: unknown, ...args: unknown[]): EncoderLike {
    const encoder = createCommandEncoder.apply(this, args);
    const beginRenderPass = encoder.beginRenderPass;
    encoder.beginRenderPass = function (this: unknown, ...passArgs: unknown[]): unknown {
      tally.renderPasses++;
      return beginRenderPass.apply(this, passArgs);
    };
    return encoder;
  };

  return {
    tally,
    restore() {
      dev.createCommandEncoder = createCommandEncoder;
    },
  };
}

/** Inspect `device`, run `render`, restore, and return the tally. */
export function traceGpu(device: unknown, render: () => void): GpuTally {
  const inspector = inspectGpuDevice(device);
  try {
    render();
  } finally {
    inspector.restore();
  }
  return inspector.tally;
}
