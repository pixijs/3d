import { warn } from 'pixi.js';

import { getCachedTemplateSlots } from '../../shader/codegen/getTemplateSlots';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { prefixSlotName } from './prefixSlotName';

function warnUnprefixedSlots(templateSource: string): void {
  const templateSlots = getCachedTemplateSlots(templateSource);
  for (const slotName of templateSlots) {
    const isValid =
      slotName === 'header' ||
      slotName === 'textureGetters' ||
      slotName.startsWith('vertex') ||
      slotName.startsWith('fragment');
    if (!isValid) {
      const vertexSuggestion = prefixSlotName('vertex', slotName);
      const fragmentSuggestion = prefixSlotName('fragment', slotName);
      warn(
        `[compileShader] Template slot {{${slotName}}} is not prefixed with "vertex" or "fragment". ` +
          `Did you mean {{${vertexSuggestion}}} or {{${fragmentSuggestion}}}?`,
      );
    }
  }
}

/**
 * Collects each bit's WGSL `gpu.header` block and injects them into the template's `{{header}}` slot
 *
 * Also warns when a template slot lacks the `vertex`/`fragment` stage prefix the single-source
 * WGSL format expects.
 * @internal
 */
export const wgslHeadersPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    warnUnprefixedSlots(context.templateString);
    context.data.headers = context.bits.map((b) => b.gpu?.header).filter((h): h is string => !!h?.trim());
  },
  injectCode(context) {
    const headersSource = context.data.headers!.join('\n\n');
    return { header: headersSource };
  },
};
