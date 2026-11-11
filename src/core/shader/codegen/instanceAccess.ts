import type { InstanceDataLayout } from '../../batcher/instanceDataLayout';
import type { ShaderBit, StructDefinition } from '../ShaderBit';
import type { ShaderBitTemplate } from '../ShaderBitTemplate';
import { bindingFields, bindingType } from './parseBindingType';

/** @internal */
export interface InstanceAccess {
  layout: InstanceDataLayout;
  /** Every field either stage reads, all loaded in the vertex stage */
  loaded: ReadonlySet<string>;
  /** The fields the fragment stage reads, handed over as flat varyings */
  varyings: readonly string[];
}

/** @internal */
export function readsInstanceData(bits: readonly ShaderBit[]): boolean {
  for (let i = 0; i < bits.length; i++) {
    if (bits[i].bindings?.instance) return true;
  }

  return false;
}

/** @internal */
export function instanceVaryingName(field: string): string {
  return `vInstance_${field}`;
}

const INSTANCE_READ = /\binstance\b(?:\s*\.\s*([A-Za-z]\w*))?/g;
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function collectStageReads(
  bits: readonly ShaderBit[],
  platform: 'gl' | 'gpu',
  stage: 'vertex' | 'fragment',
  declared: StructDefinition,
  into: Set<string>,
): void {
  for (const bit of bits) {
    const slots = bit[platform]?.[stage];
    if (!slots) continue;

    for (const slot in slots) {
      const code = slots[slot];
      if (!code) continue;

      for (const match of code.replace(COMMENT, '').matchAll(INSTANCE_READ)) {
        if (match[1] === undefined) {
          for (const name in declared) into.add(name);
        } else if (match[1] in declared) {
          into.add(match[1]);
        }
      }
    }
  }
}

/** @internal */
export function resolveInstanceAccess(
  bits: readonly ShaderBit[],
  platform: 'gl' | 'gpu',
  layout: InstanceDataLayout | undefined,
  template: ShaderBitTemplate,
): InstanceAccess {
  if (!layout) {
    const reader = bits.find((bit) => bit.bindings?.instance);

    throw new Error(
      `[instanceData] Bit "${reader?.name}" reads instance data, but the mesh it draws has none. ` +
        `Draw it as a BatchedMesh3D slot and declare the fields in the batch's instanceData option.`,
    );
  }

  const declared: StructDefinition = {};

  for (const bit of bits) {
    const fields = bit.bindings?.instance;
    if (!fields) continue;

    for (const { name, spec } of bindingFields(fields, 'instance')) {
      const type = bindingType(spec);
      const inBatch = layout.struct[name];

      if (inBatch !== type) {
        throw new Error(
          `[instanceData] Bit "${bit.name}" reads instance.${name} as ${type}, but the batch ` +
            (inBatch ? `declares it as ${inBatch}.` : `has no such field. Its instanceData is: ${layout.key}.`),
        );
      }

      declared[name] = inBatch;
    }
  }

  const fragment = new Set<string>();
  collectStageReads(bits, platform, 'fragment', declared, fragment);

  const loaded = new Set(fragment);
  collectStageReads(bits, platform, 'vertex', declared, loaded);

  const access: InstanceAccess = { layout, loaded, varyings: [...fragment] };
  assertInstanceSlots(template, platform, access);

  return access;
}

/**
 * Without this check, a missing slot drops the access code and the compile fails at the first
 * `instance.<field>` with no hint why
 */
function assertInstanceSlots(template: ShaderBitTemplate, platform: 'gl' | 'gpu', access: InstanceAccess): void {
  const fragmentReads = access.varyings.length > 0;
  let missing: string | null = null;

  if (platform === 'gpu') {
    const source = template.gpu ?? '';
    if (!source.includes('{{vertexStoreAccess}}')) missing = '{{vertexStoreAccess}}';
    else if (fragmentReads && !source.includes('{{fragmentStoreAccess}}')) missing = '{{fragmentStoreAccess}}';
  } else if (!template.gl?.vertex.includes('{{storeAccess}}')) {
    missing = '{{storeAccess}} in its vertex source';
  } else if (fragmentReads && !template.gl.fragment.includes('{{storeAccess}}')) {
    missing = '{{storeAccess}} in its fragment source';
  }

  if (missing) {
    throw new Error(
      `[instanceData] A bit reads instance data, but the shader template has no ${missing}. ` +
        `Add the slot where the draw's store row is in scope, or use the material's own template.`,
    );
  }
}
