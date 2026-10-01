import type { ShaderBit, ShaderOverrideDef, ShaderOverrideType } from './ShaderBit';

/**
 * A validated override definition: a finite default, or required
 * @internal
 */
export type NormalizedShaderOverrideDef =
  | { type: ShaderOverrideType; default: number; required: false }
  | { type: ShaderOverrideType; default?: never; required: true };

/**
 * Validates one override definition
 *
 * Throws when it has no `type`, when it has both or neither of `default` and `required: true`, or
 * when the default isn't a finite number. A definition with neither never gets an implied default.
 * @param bitName - The declaring bit, for the error
 * @param key - The override's name, for the error
 * @param def - The definition as the bit wrote it
 */
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
  } as NormalizedShaderOverrideDef;
}

/**
 * Collects and validates every bit's `overrideDefs` into one map
 *
 * Bits that declare the same name must agree on its type, whether it is required, and its
 * default. A disagreement throws, so a bad combination of bits fails to compile rather than
 * quietly picking one.
 * @param bits - Shader bits contributing override definitions
 * @returns Map of override name to its normalized definition
 * @internal
 */
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

/**
 * Formats a default as a WGSL literal of `type`
 *
 * Integers are truncated, and `u32` takes the `u` suffix. An integral `f32` gets a `.0`, which
 * WGSL doesn't need but keeps the declaration readable as a float.
 * @param type - The override's type
 * @param value - The default value
 */
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

/**
 * Generates WGSL `override` declarations from previously collected override defs
 * @param defs - Collected override definitions
 * @returns WGSL source, one `override` declaration per line
 * @internal
 */
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
 * Formats a value as the body of a GLSL `#define`
 *
 * Integers are truncated. A `u32` gets no `u` suffix, so GLSL reads it as an `int`, and GLSL ES
 * 3.00 has no implicit conversions (section 4.1.10). Shader code compares it with an int literal,
 * as `toonMaterialBit` does with `HAS_UVS == 1`, which WGSL accepts too. An integral `f32` gets a
 * `.0`, without which GLSL would read an `int`.
 * @param type - The override's type
 * @param value - The value to bake in
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

/**
 * Generates GLSL `#define` directives from previously collected override defs
 *
 * WGSL declares an `override` and leaves the value to the pipeline. GLSL has no specialization
 * constants, so each value is baked into the source: `values[key]`, else the default. A required
 * override with no value throws.
 * @param defs - Collected override definitions
 * @param values - Per-shader override values from the descriptor
 * @returns GLSL source, one `#define` per line
 * @internal
 */
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
