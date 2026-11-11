export async function compilationErrors(device: GPUDevice, code: string): Promise<string[]> {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const scoped = await device.popErrorScope();

  const errors = info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);

  if (scoped) errors.push(scoped.message);

  return errors;
}
