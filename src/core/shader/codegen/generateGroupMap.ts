import type { ShaderBit } from '../ShaderBit';
import { resolveBindGroups } from '../ShaderBitTemplate';
import type { ShaderBitTemplate } from '../ShaderBitTemplate';
import { bindingFields, bindingType, isStorageType, isUniformBufferType, RESOURCE_TYPES } from './parseBindingType';

interface GroupData {
  resources: Record<string, boolean>;
  storages: Record<string, boolean>;
  uniformBuffers: Record<string, boolean>;
  uniformGroups: Record<string, boolean>;
}

/**
 * Must assign the indices `buildWgslBindingMap` does, as `bindingParity.test.ts` checks
 * @internal
 */
export function generateGroupMap(
  bits: ShaderBit[],
  template: ShaderBitTemplate,
): Record<number, Record<number, string>> {
  const groupData: Record<string, GroupData> = Object.create(null);

  const groups = resolveBindGroups(template);

  for (const { name } of groups) {
    groupData[name] = {
      resources: Object.create(null),
      storages: Object.create(null),
      uniformBuffers: Object.create(null),
      uniformGroups: Object.create(null),
    };
  }

  for (const bit of bits) {
    if (!bit.bindings) continue;

    for (const [groupName, bindings] of Object.entries(bit.bindings)) {
      const group = groupData[groupName];
      if (!group) continue;

      for (const { name, spec, uniformGroup } of bindingFields(bindings!, groupName)) {
        const type = bindingType(spec);
        if (RESOURCE_TYPES.has(type)) {
          group.resources[name] = true;
        } else if (isStorageType(type)) {
          group.storages[name] = true;
        } else if (isUniformBufferType(type)) {
          group.uniformBuffers[name] = true;
        } else {
          group.uniformGroups[uniformGroup] = true;
        }
      }
    }
  }

  const result: Record<number, Record<number, string>> = {};

  groups.forEach(({ name: groupName }, groupIndex) => {
    const group = groupData[groupName];
    const map: Record<number, string> = {};
    let bindingIndex = 0;

    if (group.uniformGroups[groupName]) map[bindingIndex++] = groupName;

    for (const name in group.resources) map[bindingIndex++] = name;

    for (const name in group.storages) map[bindingIndex++] = name;

    for (const name in group.uniformBuffers) map[bindingIndex++] = name;

    for (const name in group.uniformGroups) if (name !== groupName) map[bindingIndex++] = name;

    result[groupIndex] = map;
  });

  return result;
}
