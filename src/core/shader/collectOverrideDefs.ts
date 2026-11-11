import type { ShaderBit, ShaderOverrideDef, ShaderOverrideType } from './ShaderBit';

/** @internal */
export type NormalizedShaderOverrideDef =
  | { type: ShaderOverrideType; default: number; required: false }
  | { type: ShaderOverrideType; default?: never; required: true };

function normalizeDef(bitName: string, key: string, def: ShaderOverrideDef): NormalizedShaderOverrideDef {
  const anyDef = def as unknown as {
    type?: ShaderOverrideType;
    default?: unknown;
    required?: unknown;
  };

  if (!anyDef?.type) {
    throw new Error(`[ShaderBit:${bitName}] overrideDefs.${key} missing 'type'.`);
  }

  const hasDefault = Object.prototype.hasOwnProperty.call(anyDef, 'default');
  const isRequired = anyDef.required === true;

  if (hasDefault && isRequired) {
    throw new Error(`[ShaderBit:${bitName}] overrideDefs.${key} cannot specify both 'default' and 'required: true'.`);
  }

  if (!hasDefault && !isRequired) {
    throw new Error(`[ShaderBit:${bitName}] overrideDefs.${key} must specify either 'default' or 'required: true'.`);
  }

  if (isRequired) {
    return { type: anyDef.type, required: true };
  }

  if (typeof anyDef.default !== 'number' || !Number.isFinite(anyDef.default)) {
    throw new Error(`[ShaderBit:${bitName}] overrideDefs.${key}.default must be a finite number.`);
  }

  return {
    type: anyDef.type,
    default: anyDef.default,
    required: false,
  };
}

/** @internal */
export function collectOverrideDefs(bits: ShaderBit[]): Record<string, NormalizedShaderOverrideDef> {
  const defs: Record<string, NormalizedShaderOverrideDef> = Object.create(null);

  for (const bit of bits) {
    if (!bit.overrideDefs) continue;

    for (const [key, rawDef] of Object.entries(bit.overrideDefs)) {
      const normalized = normalizeDef(bit.name, key, rawDef);

      const existing = defs[key];

      if (
        existing &&
        (existing.type !== normalized.type ||
          existing.required !== normalized.required ||
          (!existing.required && existing.default !== normalized.default))
      ) {
        throw new Error(
          `[ShaderBit overrides] Duplicate override '${key}' has conflicting definitions.\n` +
            `Existing: ${JSON.stringify(existing)}\n` +
            `New (from '${bit.name}'): ${JSON.stringify(normalized)}`,
        );
      }

      defs[key] = existing ?? normalized;
    }
  }

  return defs;
}

function formatWgslLiteral(type: ShaderOverrideType, value: number): string {
  if (type === 'u32') {
    const intValue = Math.trunc(value);
    return `${intValue}u`;
  }
  if (type === 'i32') {
    return `${Math.trunc(value)}`;
  }
  if (Number.isInteger(value)) return `${value}.0`;
  return `${value}`;
}

/** @internal */
export function emitOverridesWgsl(defs: Record<string, NormalizedShaderOverrideDef>): string {
  const lines: string[] = [];

  for (const key of Object.keys(defs).sort()) {
    const def = defs[key];

    if (def.required) {
      lines.push(`override ${key}: ${def.type};`);
    } else {
      const lit = formatWgslLiteral(def.type, def.default);
      lines.push(`override ${key}: ${def.type} = ${lit};`);
    }
  }

  return lines.length ? lines.join('\n') : '';
}

/**
 * Gives an integral `f32` a `.0`, or GLSL reads an `int`, and a `u32` no `u` suffix, so shader code
 * compares it with a bare int in both languages, as `toonMaterialBit` does with `HAS_UVS == 1`
 */
function formatGlslLiteral(type: ShaderOverrideType, value: number): string {
  if (type === 'u32') {
    return `${Math.trunc(value)}`;
  }
  if (type === 'i32') {
    return `${Math.trunc(value)}`;
  }
  if (Number.isInteger(value)) return `${value}.0`;
  return `${value}`;
}

/** @internal */
export function emitOverridesGlsl(
  defs: Record<string, NormalizedShaderOverrideDef>,
  values: Record<string, number>,
): string {
  const lines: string[] = [];

  for (const key of Object.keys(defs).sort()) {
    const def = defs[key];
    const provided = values[key];
    const hasProvided = provided !== undefined;

    if (def.required && !hasProvided) {
      throw new Error(`[glslOverrides] required override '${key}' has no value supplied via descriptor.overrides.`);
    }

    const value = hasProvided ? provided : (def as { default: number }).default;
    lines.push(`#define ${key} ${formatGlslLiteral(def.type, value)}`);
  }

  return lines.length ? lines.join('\n') : '';
}
