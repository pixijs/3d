import { fillTemplateSlots } from './codegen/fillTemplateSlots';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from './ShaderCompilerPlugin';

/**
 * Compiles a shader template by running plugins through three phases
 *
 * 1. `collectData`  — plugins populate `context.data` with structured objects
 * 2. `preCompile`   — plugins modify `context.data` (e.g. struct padding)
 * 3. `injectCode`   — plugins read `context.data` and return slot code strings
 *
 * After all phases, slot code is assembled into the final source via template substitution.
 * @param context - The compilation context (bits, template, data, stage)
 * @param plugins - Array of plugins to execute in order
 * @returns The compiled shader string
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
