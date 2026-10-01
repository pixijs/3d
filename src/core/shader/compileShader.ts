import { fillTemplateSlots } from './codegen/fillTemplateSlots';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from './ShaderCompilerPlugin';

/**
 * Compiles one template source by running the plugins' phases, then filling its slots
 *
 * See {@link ShaderCompilerPlugin} for the phases. Slot code can contain markers of its own, which
 * the fill resolves too.
 * @param context - The bits, the template and its source, and the shared data
 * @param plugins - The plugins, in the order each phase runs them
 * @returns The compiled shader source
 * @category rendering
 * @advanced
 */
export function compileShader(context: ShaderCompilerContext, plugins: ShaderCompilerPlugin[]): string {
  for (const plugin of plugins) {
    plugin.collectData?.(context);
  }

  for (const plugin of plugins) {
    plugin.preCompile?.(context);
  }

  const slotCode: Record<string, string[]> = {};

  for (const plugin of plugins) {
    const injected = plugin.injectCode?.(context);
    if (injected) {
      for (const [slot, code] of Object.entries(injected)) {
        if (!code || !/\S/.test(code)) continue;
        slotCode[slot] ??= [];
        slotCode[slot].push(code);
      }
    }
  }

  return fillTemplateSlots(context.templateString, slotCode);
}
