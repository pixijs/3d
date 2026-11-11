interface EncoderLike {
  beginRenderPass: (...args: unknown[]) => unknown;
}

interface DeviceLike {
  createCommandEncoder: (...args: unknown[]) => EncoderLike;
}

export interface GpuTally {
  renderPasses: number;
}

export interface GpuInspector {
  readonly tally: GpuTally;
  restore(): void;
}

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

export function traceGpu(device: unknown, render: () => void): GpuTally {
  const inspector = inspectGpuDevice(device);
  try {
    render();
  } finally {
    inspector.restore();
  }
  return inspector.tally;
}
