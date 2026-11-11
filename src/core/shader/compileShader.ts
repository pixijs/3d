import { fillTemplateSlots } from './codegen/fillTemplateSlots';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from './ShaderCompilerPlugin';

/** @internal */
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
