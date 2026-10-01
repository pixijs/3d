import type { BindingSpec, BindingVisibility } from '../ShaderBit';

/**
 * Returns a {@link BindingSpec}'s WGSL type, whether it was written bare or as `{ type, visibility }`
 * @param spec - The binding spec to normalise
 * @returns The WGSL type string
 * @internal
 */
export function bindingType(spec: BindingSpec): string {
  return typeof spec === 'string' ? spec : spec.type;
}

/**
 * Returns the stages a binding is visible to: its `visibility`, or `'both'`
 *
 * Only the WebGPU pipeline layout reads it.
 * @param spec - The binding spec to read
 * @returns The declared visibility, or `'both'`
 * @internal
 */
export function bindingVisibility(spec: BindingSpec): BindingVisibility {
  return typeof spec === 'string' ? 'both' : (spec.visibility ?? 'both');
}

/**
 * The WGSL texture and sampler types, each of which gets a binding of its own rather than a field
 * in the group's uniform struct
 *
 * It lists every type of `ResourceType` in `ShaderBit.ts`, and the two must stay in step.
 * @internal
 */
export const RESOURCE_TYPES = new Set([
  'texture_2d<f32>',
  'texture_2d<u32>',
  'texture_2d<i32>',
  'texture_2d_array<f32>',
  'texture_3d<f32>',
  'texture_cube<f32>',
  'texture_cube_array<f32>',
  'texture_depth_2d',
  'texture_depth_2d_array',
  'texture_depth_cube',
  'texture_depth_cube_array',
  'sampler',
  'sampler_comparison',
]);

/**
 * Whether `type` is a storage buffer type, `storage<StructName>`
 *
 * It matches a malformed one such as `storage<>` too, so the caller can warn about it;
 * `parseStorageType` returns `null` for those.
 * @param type - The binding type string to test
 * @returns Whether the type is a storage buffer binding
 * @internal
 */
export function isStorageType(type: string): boolean {
  return /^storage<[^>]*>$/.test(type);
}

/**
 * Parses a storage buffer binding type and returns the referenced struct name
 * @example
 * ```ts
 * parseStorageType("storage<Renderable>") // "Renderable"
 * parseStorageType("vec4<f32>") // null
 * ```
 * @param type - The binding type string to parse
 * @returns The struct name, or `null` when not a storage type
 * @internal
 */
export function parseStorageType(type: string): string | null {
  const match = type.match(/^storage<(\w+)>$/);
  return match ? match[1] : null;
}
