import { warn } from 'pixi.js';

import {
  bindingFields,
  bindingType,
  capitalize,
  isStorageType,
  isUniformBufferType,
  parseStorageType,
  parseUniformBufferType,
  RESOURCE_TYPES,
} from '../../shader/codegen/parseBindingType';
import type { ShaderBit, StructDefinition } from '../../shader/ShaderBit';
import { resolveBindGroups } from '../../shader/ShaderBitTemplate';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

interface BindGroupData {
  groupIndex: number;
  bindingIndex: number;
  resources: Record<string, string>;
  storages: Record<string, string>;
  uniformBuffers: Record<string, string>;
  uniformGroups: Record<string, boolean>;
}

function createBindGroupData(groupIndex: number): BindGroupData {
  return {
    groupIndex,
    bindingIndex: 0,
    resources: Object.create(null),
    storages: Object.create(null),
    uniformBuffers: Object.create(null),
    uniformGroups: Object.create(null),
  };
}

function warnBindingConflict(name: string, newType: string, existingType: string): void {
  warn(
    `[collectBindings] Binding "${name}" redefined with different type: ` +
      `"${existingType}" → "${newType}". Keeping original.`,
  );
}

function warnInvalidStorageType(bitName: string, bindingName: string, type: string): void {
  warn(
    `[collectBindings] Bit "${bitName}" binding "${bindingName}" has invalid storage type: "${type}". ` +
      `Expected format: storage<StructName>`,
  );
}

function warnInvalidUniformBufferType(bitName: string, bindingName: string, type: string): void {
  warn(
    `[collectBindings] Bit "${bitName}" binding "${bindingName}" has invalid uniform buffer type: "${type}". ` +
      `Expected format: uniform<StructName>`,
  );
}

/** @internal */
export interface CollectedBindings {
  structs: Record<string, StructDefinition>;
  bindGroups: Record<string, BindGroupData>;
}

/**
 * The first bit to declare a binding sets its type, as it sets its stage tag in `compileWgslSource`
 * @internal
 */
export function collectBindings(bits: ShaderBit[], template: ShaderBitTemplate): CollectedBindings {
  const bindGroups: Record<string, BindGroupData> = Object.create(null);
  resolveBindGroups(template).forEach(({ name }, index) => {
    bindGroups[name] = createBindGroupData(index);
  });

  const structs: Record<string, StructDefinition> = Object.create(null);

  for (const bit of bits) {
    if (!bit.structs) continue;
    for (const [structName, structDef] of Object.entries(bit.structs)) {
      if (!(structName in structs)) {
        structs[structName] = structDef;
      }
    }
  }

  for (const bit of bits) {
    if (!bit.bindings) continue;

    for (const [groupName, bindings] of Object.entries(bit.bindings)) {
      if (!bindings) continue;
      const isBound = groupName in bindGroups;

      for (const { name, spec, uniformGroup: fieldGroup } of bindingFields(bindings, groupName)) {
        const type = bindingType(spec);
        if (RESOURCE_TYPES.has(type)) {
          if (isBound) {
            const res = bindGroups[groupName].resources;
            if (!(name in res)) {
              res[name] = type;
            } else if (res[name] !== type) {
              warnBindingConflict(name, type, res[name]);
            }
          }
        } else if (isStorageType(type)) {
          if (isBound) {
            const storageStructName = parseStorageType(type);
            if (!storageStructName) {
              warnInvalidStorageType(bit.name, name, type);
              continue;
            }
            const sto = bindGroups[groupName].storages;
            if (!(name in sto)) {
              sto[name] = storageStructName;
            }
          }
        } else if (isUniformBufferType(type)) {
          if (isBound) {
            const structName = parseUniformBufferType(type);
            if (!structName) {
              warnInvalidUniformBufferType(bit.name, name, type);
              continue;
            }
            const buffers = bindGroups[groupName].uniformBuffers;
            if (!(name in buffers)) {
              buffers[name] = structName;
              structs[structName] ??= {};
            } else if (buffers[name] !== structName) {
              warnBindingConflict(name, structName, buffers[name]);
            }
          }
        } else {
          const uniformGroup = isBound ? fieldGroup : groupName;
          const structName = capitalize(uniformGroup);
          if (!(structName in structs)) structs[structName] = {};
          const structDef = structs[structName];
          if (structDef[name] && structDef[name] !== type) {
            warnBindingConflict(name, type, structDef[name]);
          } else {
            structDef[name] = type as StructDefinition[string];
          }
          if (isBound) bindGroups[groupName].uniformGroups[uniformGroup] = true;
        }
      }
    }
  }

  return { structs, bindGroups };
}

interface BindingMapEntry {
  name: string;
  binding: number;
  kind: 'uniform' | 'resource' | 'storage';
  type: string;
}

type WgslBindingMap = Record<string, { groupIndex: number; entries: BindingMapEntry[] }>;

/**
 * Must number bindings as `generateGroupMap` does for WebGL; `bindingParity.test.ts` checks it
 * @internal
 */
export function buildWgslBindingMap(collected: CollectedBindings): WgslBindingMap {
  const { bindGroups } = collected;
  const map: WgslBindingMap = Object.create(null);

  for (const groupName in bindGroups) {
    const group = bindGroups[groupName];
    const entries: BindingMapEntry[] = [];
    let binding = group.bindingIndex;

    if (group.uniformGroups[groupName]) {
      entries.push({ name: groupName, binding: binding++, kind: 'uniform', type: capitalize(groupName) });
    }
    for (const name in group.resources) {
      entries.push({ name, binding: binding++, kind: 'resource', type: group.resources[name] });
    }
    for (const name in group.storages) {
      entries.push({ name, binding: binding++, kind: 'storage', type: group.storages[name] });
    }
    for (const name in group.uniformBuffers) {
      entries.push({ name, binding: binding++, kind: 'uniform', type: group.uniformBuffers[name] });
    }
    for (const name in group.uniformGroups) {
      if (name !== groupName) entries.push({ name, binding: binding++, kind: 'uniform', type: capitalize(name) });
    }

    map[groupName] = { groupIndex: group.groupIndex, entries };
  }

  return map;
}

/**
 * Emits from `buildWgslBindingMap`, so the source can't drift from the map the parity test checks
 * @internal
 */
export function emitBindingsWgsl(collected: CollectedBindings): string {
  const { structs, bindGroups } = collected;

  for (const groupName in bindGroups) {
    const { uniformBuffers } = bindGroups[groupName];
    for (const name in uniformBuffers) {
      const structName = uniformBuffers[name];
      if (Object.keys(structs[structName] ?? {}).length === 0) {
        throw new Error(
          `[emitBindingsWgsl] Binding "${name}" is "uniform<${structName}>", but no bit declares fields for a ` +
            `"${structName}" struct.`,
        );
      }
    }
  }

  const out: string[] = [];

  for (const structName in structs) {
    const structDef = structs[structName];
    out.push(`struct ${structName} {`);
    for (const [fieldName, fieldType] of Object.entries(structDef)) {
      out.push(`  ${fieldName}: ${fieldType},`);
    }
    out.push('}');
  }

  const map = buildWgslBindingMap(collected);

  for (const groupName in map) {
    const { groupIndex, entries } = map[groupName];

    for (const entry of entries) {
      const at = `@group(${groupIndex}) @binding(${entry.binding})`;
      if (entry.kind === 'uniform') {
        out.push(`${at} var<uniform> ${entry.name}: ${entry.type};`);
      } else if (entry.kind === 'resource') {
        out.push(`${at} var ${entry.name}: ${entry.type};`);
      } else {
        out.push(`${at} var<storage, read> ${entry.name}: array<${entry.type}>;`);
      }
    }
  }

  return out.join('\n');
}

/** @internal */
export const wgslBindingsPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.bindings = collectBindings(context.bits, context.template);
    context.data.structs = context.data.bindings.structs;
  },
  injectCode(context) {
    const bindingsSource = emitBindingsWgsl(context.data.bindings!);
    return { header: bindingsSource };
  },
};
