/**
 * Capitalizes the first letter of a string
 * @param str - The slot name to capitalize
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Prefixes a slot name with the stage in camelCase: `('vertex', 'input')` gives `'vertexInput'`
 *
 * WGSL needs the prefix because one template holds both stages, so the stages' slots can't share
 * names.
 * @param stage - Shader stage the slot belongs to
 * @param slotName - Bare slot name from the bit
 * @returns The stage-prefixed slot name
 * @internal
 */
export function prefixSlotName(stage: 'vertex' | 'fragment', slotName: string): string {
  return `${stage}${capitalize(slotName)}`;
}
