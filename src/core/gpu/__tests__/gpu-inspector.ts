/**
 * A tiny WebGPU inspector for tests. Wraps a `GPUDevice`'s command-encoder API
 * so a test can observe what the renderer drives the GPU to do during a render —
 * the structural view a pixel screenshot can't give (e.g. "did these insets weave
 * into one render pass, or begin a pass each?").
 *
 * Today it tallies render-pass begins. It's intentionally a thin, extensible shim:
 * to watch more of the API (draws, copies, …) wrap the relevant method inside
 * `createCommandEncoder` / the returned encoder the same way.
 *
 * The device + encoder are taken structurally, so the inspector wraps only the
 * methods it watches — no `any`.
 */

interface EncoderLike {
  beginRenderPass: (...args: unknown[]) => unknown;
}

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
