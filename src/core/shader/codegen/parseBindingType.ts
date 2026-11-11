import type { BindingGroup, BindingSpec, BindingVisibility, ResourceType, UniformGroupBindings } from '../ShaderBit';

/** @internal */
export function bindingType(spec: BindingSpec): string {
  return typeof spec === 'string' ? spec : spec.type;
}

/** @internal */
export function bindingVisibility(spec: BindingSpec): BindingVisibility {
  return typeof spec === 'string' ? 'both' : (spec.visibility ?? 'both');
}

interface BindingField {
  name: string;
  spec: BindingSpec;
  /** The bind group's name, unless the field sits in a nested {@link UniformGroupBindings} */
  uniformGroup: string;
}

function isUniformGroup(entry: BindingSpec | UniformGroupBindings): entry is UniformGroupBindings {
  return typeof entry === 'object' && typeof entry.type !== 'string';
}

/**
 * @yields Each binding, a nested uniform group's fields in place of the group
 * @internal
 */
export function* bindingFields(bindings: BindingGroup, bindGroupName: string): Generator<BindingField> {
  for (const [name, entry] of Object.entries(bindings)) {
    if (isUniformGroup(entry)) {
      for (const [fieldName, spec] of Object.entries(entry)) yield { name: fieldName, spec, uniformGroup: name };
    } else {
      yield { name, spec: entry, uniformGroup: bindGroupName };
    }
  }
}

/** @internal */
export function capitalize(groupName: string): string {
  return groupName.charAt(0).toUpperCase() + groupName.slice(1);
}

/** @internal */
export const RESOURCE_TYPES: ReadonlySet<string> = new Set(
  Object.keys({
    'texture_2d<f32>': true,
    'texture_2d<u32>': true,
    'texture_2d<i32>': true,
    'texture_2d_array<f32>': true,
    'texture_3d<f32>': true,
    'texture_cube<f32>': true,
    'texture_cube_array<f32>': true,
    texture_depth_2d: true,
    texture_depth_2d_array: true,
    texture_depth_cube: true,
    texture_depth_cube_array: true,
    sampler: true,
    sampler_comparison: true,
  } satisfies Record<ResourceType, true>),
);

/**
 * Matches a malformed `storage<>` too, so the caller can warn; `parseStorageType` returns `null` for it
 * @internal
 */
export function isStorageType(type: string): boolean {
  return /^storage<.*>$/.test(type);
}

/** @internal */
export function parseStorageType(type: string): string | null {
  const match = type.match(/^storage<(\w+(?:<\w+>)?)>$/);
  return match ? match[1] : null;
}

/**
 * Matches a malformed `uniform<>` too, so the caller can warn; `parseUniformBufferType` returns `null` for it
 * @internal
 */
export function isUniformBufferType(type: string): boolean {
  return /^uniform<.*>$/.test(type);
}

/** @internal */
export function parseUniformBufferType(type: string): string | null {
  const match = type.match(/^uniform<(\w+)>$/);
  return match ? match[1] : null;
}
