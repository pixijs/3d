import { warn } from 'pixi.js';

import { collectSlotCode } from '../../shader/codegen/collectSlotCode';
import { getCachedTemplateSlots } from '../../shader/codegen/getTemplateSlots';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { prefixSlotName } from './prefixSlotName';

const NESTED_MARKER_PATTERN = /\{\{(.*?)\}\}/g;

/** Slots that other slots' code names; `fillTemplateSlots` fills them on a later pass, so they don't count as unused */
function collectIndirectSlots(values: Iterable<string>): Set<string> {
  const indirect = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(NESTED_MARKER_PATTERN)) {
      indirect.add(match[1]);
    }
  }
  return indirect;
}

function warnUnusedSlots(templateSource: string, result: Record<string, string>): void {
  const templateSlots = getCachedTemplateSlots(templateSource);
  const indirectSlots = collectIndirectSlots(Object.values(result));
  for (const [slotName, code] of Object.entries(result)) {
    if (code && /\S/.test(code) && !templateSlots.has(slotName) && !indirectSlots.has(slotName)) {
      warn(
        `[compileShader] Generated code for slot {{${slotName}}} but template doesn't have it. ` +
          `Slot names are prefixed with stage: vertex.input → {{vertexInput}}, fragment.end → {{fragmentEnd}}.`,
      );
    }
  }
}

/** @internal */
export const wgslStageSlotsPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.vertexSlots = collectSlotCode(context.bits, 'gpu', 'vertex');
    context.data.fragmentSlots = collectSlotCode(context.bits, 'gpu', 'fragment');
  },

  injectCode(context) {
    const result: Record<string, string> = {};

    for (const [slotName, code] of Object.entries(context.data.vertexSlots!)) {
      result[prefixSlotName('vertex', slotName)] = code.join('\n');
    }

    for (const [slotName, code] of Object.entries(context.data.fragmentSlots!)) {
      result[prefixSlotName('fragment', slotName)] = code.join('\n');
    }

    warnUnusedSlots(context.templateString, result);

    return result;
  },
};
