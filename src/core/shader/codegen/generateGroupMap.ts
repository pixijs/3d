import type { ShaderBit } from '../ShaderBit';
import type { ShaderBitTemplate } from '../ShaderBitTemplate';
import { bindingType, isStorageType, RESOURCE_TYPES } from './parseBindingType';

interface GroupData {
  hasUniforms: boolean;
  resources: Record<string, boolean>;
  storages: Record<string, boolean>;
}

/**
 * Maps each group's binding indices to binding names, for WebGL
 *
 * Within a group, the uniform struct takes the first index, under the group's name. Textures and
 * samplers follow, then storage buffers, each in the order bits first declare them. A group the
 * template doesn't list, such as `material`, only adds struct fields, so it gets no indices.
 *
 * WebGPU assigns its indices in `buildWgslBindingMap`, and the two must agree;
 * `bindingParity.test.ts` checks that they do.
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
      if (!group) continue;

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

    if (group.hasUniforms) {
      map[bindingIndex++] = groupName;
    }

    for (const name in group.resources) map[bindingIndex++] = name;

    for (const name in group.storages) map[bindingIndex++] = name;

    result[groupIndex] = map;
  });

  return result;
}
