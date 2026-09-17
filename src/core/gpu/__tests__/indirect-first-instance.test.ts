import { describe, expect, it } from 'vitest';

/**
 * Layer-2 probe — is a non-zero `firstInstance` in an INDIRECT draw honored by
 * `@builtin(instance_index)` on this platform's WebGPU backend?
 *
 * madison's indirect forward path bakes `firstInstance = batchStart` (non-zero
 * for the 2nd+ draw command in a batch) into the draw-args and indexes the
 * per-instance storage buffer by `instance_index`, relying on the builtin to
 * include firstInstance. That requires the optional `indirect-first-instance`
 * feature. Metal (Apple / iOS — a first-class target) does NOT offer it: an
 * indirect draw's baseInstance can't be threaded into the shader's zero-based
 * `[[instance_id]]`, so there every command reads instances from slot 0 and the
 * 2nd+ command in a batch mis-renders.
 *
 * The probe draws a full-target triangle with `drawIndirect(firstInstance = 7)`
 * and a shader that writes the `instance_index` it saw into the red channel,
 * then reads the pixel back:
 *   - red == 7  → firstInstance HONORED (the platform supports + we enabled it)
 *   - red == 0  → firstInstance DROPPED  → Layer 2 is REAL on this backend
 *
 * The feature governs `drawIndexedIndirect` identically, so the verdict applies
 * to madison's indexed path.
 */
async function probeInstanceIndex(device: GPUDevice, firstInstance: number): Promise<number> {
  const module = device.createShaderModule({
    code: /* wgsl */ `
      struct VOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) ii: u32 };
      @vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
        var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        var o: VOut;
        o.pos = vec4f(p[vi], 0.0, 1.0);
        o.ii = ii;
        return o;
      }
      @fragment fn fs(vin: VOut) -> @location(0) vec4f {
        return vec4f(f32(vin.ii) / 255.0, 0.0, 0.0, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });

  const target = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  // Indirect args: [vertexCount, instanceCount, firstVertex, firstInstance].
  const indirect = device.createBuffer({ size: 16, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(indirect, 0, new Uint32Array([3, 1, 0, firstInstance]));
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  // A firstInstance the backend can't honor raises a validation error rather
  // than drawing — expected on Metal; capture it so it doesn't fail the run.
  device.pushErrorScope('validation');
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
    ],
  });
  pass.setPipeline(pipeline);
  pass.drawIndirect(indirect, 0);
  pass.end();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
  device.queue.submit([encoder.finish()]);
  await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const red = new Uint8Array(readback.getMappedRange().slice(0, 4))[0];
  readback.unmap();
  target.destroy();
  indirect.destroy();
  readback.destroy();
  return red;
}

describe('indirect draw firstInstance (Layer-2 probe)', () => {
  it('reports whether a non-zero firstInstance reaches instance_index', async () => {
    const gpu = navigator.gpu;
    expect(gpu).toBeTruthy();
    const adapter = await gpu.requestAdapter();
    expect(adapter).toBeTruthy();

    const supported = adapter!.features.has('indirect-first-instance');
    // Enable the feature when the adapter offers it, so a "dropped" result can
    // only mean the platform fundamentally can't honor firstInstance (Metal).
    const device = await adapter!.requestDevice({
      requiredFeatures: supported ? ['indirect-first-instance'] : [],
    });

    const FIRST = 7;
    const observed = await probeInstanceIndex(device, FIRST);
    const honored = observed === FIRST;

    // The shader saw either the honored value or a dropped-to-zero one — nothing else.
    expect([0, FIRST]).toContain(observed);
    // Core invariant (safe on any adapter): pixi's GpuDeviceSystem enables
    // `indirect-first-instance` whenever the adapter has it, so support ⇒ honored.
    // A backend WITHOUT the feature (`supported === false` — the iOS/WebKit risk)
    // drops firstInstance to 0, so the 2nd+ command in a batch reads instances
    // from slot 0. That is Layer 2 being real. To get a loud pass/fail signal on
    // a suspect device, temporarily assert `expect(observed).toBe(FIRST)` — it
    // fails iff firstInstance was dropped.
    expect(honored).toBe(supported);

    device.destroy();
  });
});
