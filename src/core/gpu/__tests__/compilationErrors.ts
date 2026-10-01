/**
 * Every error WebGPU reports for `code`, as `line:column message`
 *
 * pixi reports a broken module only through the device's uncaptured-error path, which the test
 * setup does not hook, so a test that needs a module to compile asks the device directly.
 * @param device - The device that compiles the module
 * @param code - The WGSL source
 * @returns The validation errors, empty when the module compiles without errors
 */
export async function compilationErrors(device: GPUDevice, code: string): Promise<string[]> {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const scoped = await device.popErrorScope();

  const errors = info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);

  if (scoped) errors.push(scoped.message);

  return errors;
}
