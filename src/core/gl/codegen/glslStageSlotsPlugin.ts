import { warn } from 'pixi.js';

import { collectSlotCode } from '../../shader/codegen/collectSlotCode';
import { getCachedTemplateSlots } from '../../shader/codegen/getTemplateSlots';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const NESTED_MARKER_PATTERN = /\{\{(.*?)\}\}/g;

/**
 * Collects slot names that appear as `{{name}}` markers inside any of the
 * values about to be injected
 *
 * These count as "indirectly referenced" — the master template doesn't mention
 * them, but another slot's body does, so they will be resolved by
 * `fillTemplateSlots`'s recursive substitution. Same rationale as the WGSL
 * variant — see `wgslStageSlotsPlugin.collectIndirectSlots`.
 * @param slotCode - Code chunks about to be injected, keyed by slot name
 */
function collectIndirectSlots(slotCode: Record<string, string[]>): Set<string> {
  const indirect = new Set<string>();
  for (const codes of Object.values(slotCode)) {
    for (const code of codes) {
      if (!code) continue;
      for (const match of code.matchAll(NESTED_MARKER_PATTERN)) {
        indirect.add(match[1]);
      }
    }
  }
  return indirect;
}

function warnUnusedSlots(
  templateSource: string,
  slotCode: Record<string, string[]>,
  stage: 'vertex' | 'fragment',
): void {
  const templateSlots = getCachedTemplateSlots(templateSource);
  const indirectSlots = collectIndirectSlots(slotCode);
  for (const [slotName, codes] of Object.entries(slotCode)) {
    if (codes.some((c) => c && /\S/.test(c)) && !templateSlots.has(slotName) && !indirectSlots.has(slotName)) {
      warn(
        `[compileShader] ${stage === 'vertex' ? 'Vertex' : 'Fragment'} generated code for slot {{${slotName}}} ` +
          `but template doesn't have it.`,
      );
    }
  }
}

/**
 * GLSL compiler plugin that gathers slot code for the current stage and injects
 * it into the matching template slots
 * @internal
 */
export const glslStageSlotsPlugin: ShaderCompilerPlugin = {
  injectCode(context) {
    if (!context.stage) return {};

    const slotCode = collectSlotCode(context.bits, 'gl', context.stage);
    const result: Record<string, string> = {};

    for (const [slotName, code] of Object.entries(slotCode)) {
      result[slotName] = code.join('\n');
    }

    const checkRecord: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(result)) {
      checkRecord[k] = [v];
    }
    warnUnusedSlots(context.templateString, checkRecord, context.stage);

    return result;
  },
};
