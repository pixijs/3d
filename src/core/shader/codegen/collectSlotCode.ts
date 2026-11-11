import type { ShaderBit } from '../ShaderBit';

/** @internal */
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
