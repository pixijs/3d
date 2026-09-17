import type { ShaderBit } from '../ShaderBit';

/**
 * Collects slot code contributions from all shader bits
 * @example
 * ```ts
 * const slotCode = collectSlotCode(bits, "gl", "vertex");
 * // { header: ["// bit1 code", "// bit2 code"], end: ["// cleanup"] }
 * ```
 * @param bits - Array of shader bits
 * @param platform - Target platform ("gl" or "gpu")
 * @param stage - Shader stage ("vertex" or "fragment")
 * @returns Record mapping slot names to arrays of code strings
 * @internal
 */
export function collectSlotCode(
  bits: ShaderBit[],
  platform: 'gl' | 'gpu',
  stage: 'vertex' | 'fragment',
): Record<string, string[]> {
  const slotCode: Record<string, string[]> = {};

  for (const bit of bits) {
    const stageData = bit[platform]?.[stage];
    if (!stageData) continue;

    for (const [slotName, code] of Object.entries(stageData)) {
      if (!code) continue;
      slotCode[slotName] ??= [];
      slotCode[slotName].push(code);
    }
  }

  return slotCode;
}
