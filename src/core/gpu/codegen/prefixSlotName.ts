/**
 * Capitalizes the first letter of a string
 * @param str - The slot name to capitalize
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Prefixes a slot name with the stage in camelCase
 *
 * e.g., ("vertex", "input") → "vertexInput", ("fragment", "end") → "fragmentEnd"
 *
 * Used by WGSL compilation where vertex and fragment share a single template.
 * @param stage - Shader stage the slot belongs to
 * @param slotName - Bare slot name from the bit
 * @returns The stage-prefixed slot name
 * @internal
 */
export function prefixSlotName(stage: 'vertex' | 'fragment', slotName: string): string {
  return `${stage}${capitalize(slotName)}`;
}
