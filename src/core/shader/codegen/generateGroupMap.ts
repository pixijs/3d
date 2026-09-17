import { warn } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';
import type { ShaderBitTemplate } from '../ShaderBitTemplate';
import { bindingType, isStorageType, RESOURCE_TYPES } from './parseBindingType';

interface GroupData {
  hasUniforms: boolean;
  resources: Record<string, boolean>;
  storages: Record<string, boolean>;
}

/**
 * Generates a map of binding points to uniform/resource names
 *
 * Mimics the bind group generation logic in `compileBindingsWgsl` to ensure WebGL and WebGPU
 * bind group layouts match.
 * @param bits - Shader bits contributing bindings
 * @param template - The template whose `bindGroups` order defines group indices
 * @returns Record<groupIndex, Record<bindingIndex, uniformName>>
 * @internal
 */
export function generateGroupMap(
  bits: ShaderBit[],
  template: ShaderBitTemplate,
): Record<number, Record<number, string>> {
  const groupData: Record<string, GroupData> = Object.create(null);

  for (const name of template.bindGroups) {
    groupData[name] = {
      hasUniforms: false,
      resources: Object.create(null),
      storages: Object.create(null),
    };
  }

  for (const bit of bits) {
    if (!bit.bindings) continue;

    for (const [groupName, bindings] of Object.entries(bit.bindings)) {
      const group = groupData[groupName];

      if (!group) {
        warn(
          `[generateGroupMap] Bit "${bit.name}" uses bind group "${groupName}" which is not in template.bindGroups. ` +
            `Valid groups: [${template.bindGroups.join(', ')}]. Bindings for this group will be ignored.`,
        );
        continue;
      }

      for (const [name, spec] of Object.entries(bindings!)) {
        const type = bindingType(spec);
        if (RESOURCE_TYPES.has(type)) {
          group.resources[name] = true;
        } else if (isStorageType(type)) {
          group.storages[name] = true;
        } else {
          group.hasUniforms = true;
        }
      }
    }
  }

  const result: Record<number, Record<number, string>> = {};

  template.bindGroups.forEach((groupName, groupIndex) => {
    const group = groupData[groupName];
    const map: Record<number, string> = {};
    let bindingIndex = 0;

    // 1. Uniform bindings (single binding for entire struct)
    if (group.hasUniforms) {
      // In WebGPU this binding is for the Uniform Block.
      // We map the *Group Name* to this binding index.
      map[bindingIndex++] = groupName;
    }

    // 2. Resource bindings (textures/samplers)
    for (const name in group.resources) map[bindingIndex++] = name;

    // 3. Storage buffer bindings
    for (const name in group.storages) map[bindingIndex++] = name;

    result[groupIndex] = map;
  });

  return result;
}
