/**
 * Shared parsing helpers for binding type strings used by shader bit codegen
 *
 * Keep these in codegen (not ShaderBit authoring types) so the public bit API stays declarative
 * and the parsing stays an internal implementation detail.
 */

import type { BindingSpec, BindingVisibility } from '../ShaderBit';

/**
 * Normalises a {@link BindingSpec} to its WGSL type string
 *
 * A binding may be authored as the bare type (`'storage<Light>'`) or as `{ type, visibility }`;
 * every codegen consumer reads the type through here so the object form is transparent to
 * WGSL/GLSL emission.
 * @param spec - The binding spec to normalise
 * @returns The WGSL type string
 * @internal
 */
export function bindingType(spec: BindingSpec): string {
  return typeof spec === 'string' ? spec : spec.type;
}

/**
 * Returns the stage visibility a binding was tagged with, defaulting to `'both'` for bare-string
 * bindings
 *
 * Only the WebGPU pipeline-layout builder consults this.
 * @param spec - The binding spec to read
 * @returns The declared visibility, or `'both'`
 * @internal
 */
export function bindingVisibility(spec: BindingSpec): BindingVisibility {
  return typeof spec === 'string' ? 'both' : (spec.visibility ?? 'both');
}

/**
 * WGSL resource types that require individual `var` declarations (as opposed to uniforms which
 * are grouped into structs)
 * @internal
 */
export const RESOURCE_TYPES = new Set([
  'texture_2d<f32>',
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
 * Returns true if `type` is a WGSL storage buffer binding type (`storage<StructName>` syntax)
 * @param type - The binding type string to test
 * @returns Whether the type is a storage buffer binding
 * @internal
 */
export function isStorageType(type: string): boolean {
  // Treat any `storage<...>` as a storage type so callers can emit a warning
  // when the inner type is malformed (e.g. `storage<>`).
  return /^storage<[^>]*>$/.test(type);
}

/**
 * Parses a storage buffer binding type and returns the referenced struct name
 * @example
 * ```ts
 * parseStorageType("storage<Light>") // "Light"
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
