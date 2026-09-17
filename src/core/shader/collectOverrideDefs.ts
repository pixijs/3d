import type { ShaderBit, ShaderOverrideDef, ShaderOverrideType } from './ShaderBit';

/**
 * A validated override definition: either a concrete finite default or explicitly required
 * @internal
 */
export type NormalizedShaderOverrideDef =
  | { type: ShaderOverrideType; default: number; required: false }
  | { type: ShaderOverrideType; default?: never; required: true };

function normalizeDef(bitName: string, key: string, def: ShaderOverrideDef): NormalizedShaderOverrideDef {
  // A def must carry either `{ default }` or `{ required: true }` — no silent implicit defaults.
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
 * Collects and validates `overrideDefs` from all bits into a single map
 *
 * Duplicate keys must agree exactly (type, required-ness, default); conflicting definitions throw
 * so a bad bit combination fails at compile time rather than silently picking one.
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

function formatWgslLiteral(type: ShaderOverrideType, value: number): string {
  if (type === 'u32') {
    // Ensure we emit a WGSL u32 literal.
    const intValue = Math.trunc(value);
    return `${intValue}u`;
  }
  if (type === 'i32') {
    return `${Math.trunc(value)}`;
  }
  // f32: WGSL accepts "1.0" / "1" etc; ensure we keep float-y readability.
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

function formatGlslLiteral(type: ShaderOverrideType, value: number): string {
  if (type === 'u32') {
    // GLSL `#define` is textual — no `u` suffix. Use `uint(...)` cast at the
    // call site if a uint literal is required; bare integers coerce in most
    // contexts.
    return `${Math.trunc(value)}`;
  }
  if (type === 'i32') {
    return `${Math.trunc(value)}`;
  }
  // f32: GLSL needs a decimal point on float literals. Match `formatWgslLiteral`.
  if (Number.isInteger(value)) return `${value}.0`;
  return `${value}`;
}

/**
 * Generates GLSL `#define` directives from previously collected override defs
 *
 * Unlike WGSL — which uses pipeline specialization constants and only needs the `override`
 * declaration emitted with a default — GLSL has no specialization layer. Values must be baked
 * into source at compile time, so this helper resolves `values[key] ?? def.default` per key and
 * throws if a `required: true` override has no value supplied.
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
