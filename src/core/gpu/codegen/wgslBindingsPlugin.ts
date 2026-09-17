import { warn } from 'pixi.js';

import { bindingType, isStorageType, parseStorageType, RESOURCE_TYPES } from '../../shader/codegen/parseBindingType';
import type { ShaderBit, StructDefinition } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

interface BindGroupData {
  groupIndex: number;
  bindingIndex: number;
  resources: Record<string, string>;
  storages: Record<string, string>;
  bindAsUniform: boolean;
}

function createBindGroupData(groupIndex: number): BindGroupData {
  return {
    groupIndex,
    bindingIndex: 0,
    resources: Object.create(null),
    storages: Object.create(null),
    bindAsUniform: false,
  };
}

function warnBindingConflict(name: string, newType: string, existingType: string): void {
  warn(
    `[compileBindingsWgsl] Binding "${name}" redefined with different type: ` +
      `"${existingType}" → "${newType}". Keeping original.`,
  );
}

function warnInvalidStorageType(bitName: string, bindingName: string, type: string): void {
  warn(
    `[compileBindingsWgsl] Bit "${bitName}" binding "${bindingName}" has invalid storage type: "${type}". ` +
      `Expected format: storage<StructName>`,
  );
}

const WGSL_BUILTIN_TYPES = new Set(['u32', 'i32', 'f32', 'f16', 'bool']);

/**
 * Capitalizes the first letter of a string (for PascalCase struct names)
 * @param str - The group name to turn into a struct name
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * The structured data returned by `collectBindings`
 *
 * Stored on `context.data.bindings` and consumed by `emitBindingsWgsl`.
 * @internal
 */
export interface CollectedBindings {
  /** All struct definitions: explicit (`bit.structs`) plus group-generated */
  structs: Record<string, StructDefinition>;
  /** Per-bind-group uniform/resource/storage data, keyed by group name */
  bindGroups: Record<string, BindGroupData>;
  /** The template the bindings were collected against */
  template: ShaderBitTemplate;
}

/**
 * Collects binding data from shader bits into structured objects without
 * generating any WGSL source
 *
 * The returned data is stored on `context.data` so that `preCompile` plugins
 * can modify it before emission.
 * @param bits - Array of shader bits containing binding definitions
 * @param template - Template defining bind group names
 * @returns The collected structs and per-group binding data
 * @internal
 */
export function collectBindings(bits: ShaderBit[], template: ShaderBitTemplate): CollectedBindings {
  const bindGroupNames = new Set(template.bindGroups);

  const bindGroups: Record<string, BindGroupData> = Object.create(null);
  template.bindGroups.forEach((name, index) => {
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
      const structName = capitalize(groupName);
      const isBound = bindGroupNames.has(groupName);

      for (const [name, spec] of Object.entries(bindings)) {
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
        } else {
          if (!(structName in structs)) structs[structName] = {};
          const structDef = structs[structName];
          if (structDef[name] && structDef[name] !== type) {
            warnBindingConflict(name, type, structDef[name]);
          } else {
            structDef[name] = type as StructDefinition[string];
          }
          if (isBound) {
            bindGroups[groupName].bindAsUniform = true;
          }
        }
      }
    }
  }

  for (const groupName in bindGroups) {
    for (const sName in bindGroups[groupName].storages) {
      const storageStructName = bindGroups[groupName].storages[sName];
      if (!(storageStructName in structs) && !WGSL_BUILTIN_TYPES.has(storageStructName)) {
        // A storage binding may reference a struct with no declared fields —
        // e.g. a material whose bits contribute no `material` bindings. Define
        // it empty so the WGSL type resolves; the storage padding plugin gives
        // `Material` a valid body. Any other unpadded empty struct still fails
        // loudly at WGSL compile, where an empty struct is illegal.
        structs[storageStructName] = {};
      }
    }
  }

  return { structs, bindGroups, template };
}

/**
 * One `@binding` slot in a bind group, in emission order
 * @internal
 */
interface BindingMapEntry {
  /** Binding name — the uniform-block entry uses the group's own name, matching `generateGroupMap` */
  name: string;
  /** Binding index within the group */
  binding: number;
  /** What the binding declares: a uniform block, a texture/sampler resource, or a storage buffer */
  kind: 'uniform' | 'resource' | 'storage';
  /** WGSL type: the struct name for `uniform`/`storage`, the resource type otherwise */
  type: string;
}

/**
 * Per-group binding layout, keyed by group name
 * @internal
 */
type WgslBindingMap = Record<string, { groupIndex: number; entries: BindingMapEntry[] }>;

/**
 * Derives the binding layout from collected data: per group — uniform block
 * first, then resources, then storages, indices assigned sequentially
 *
 * `emitBindingsWgsl` emits FROM this map, so the layout the parity
 * tests inspect and the layout the GPU sees are one and the same; the GL
 * twin of this assignment lives in `generateGroupMap`.
 * @param collected - Binding data from `collectBindings`
 * @returns The per-group binding layout
 * @internal
 */
export function buildWgslBindingMap(collected: CollectedBindings): WgslBindingMap {
  const { bindGroups, template } = collected;
  const map: WgslBindingMap = Object.create(null);

  for (const groupName of template.bindGroups) {
    const group = bindGroups[groupName];
    const entries: BindingMapEntry[] = [];
    let binding = group.bindingIndex;

    if (group.bindAsUniform) {
      entries.push({ name: groupName, binding: binding++, kind: 'uniform', type: capitalize(groupName) });
    }
    for (const name in group.resources) {
      entries.push({ name, binding: binding++, kind: 'resource', type: group.resources[name] });
    }
    for (const name in group.storages) {
      entries.push({ name, binding: binding++, kind: 'storage', type: group.storages[name] });
    }

    map[groupName] = { groupIndex: group.groupIndex, entries };
  }

  return map;
}

/**
 * Generates WGSL source from previously collected binding data, emitting
 * bindings straight from `buildWgslBindingMap` so source and map cannot
 * diverge
 *
 * Struct fields are emitted as-is — any padding fields (e.g. `_pad`) should
 * already have been added by a `preCompile` plugin.
 * @param collected - Binding data from `collectBindings`
 * @returns WGSL struct and binding declaration source
 * @internal
 */
export function emitBindingsWgsl(collected: CollectedBindings): string {
  const { structs } = collected;

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

  for (const groupName of collected.template.bindGroups) {
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

/**
 * WGSL compiler plugin that collects binding data, shares the resolved structs
 * via `context.data`, and injects the struct + binding declarations into the
 * `{{header}}` slot
 * @internal
 */
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
