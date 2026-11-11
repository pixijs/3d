import { createStructLayout } from '../shader/codegen/structLayout';
import type { StructDefinition } from '../shader/ShaderBit';

/**
 * The types a {@link BatchedMesh3D} instance-data field can have
 * @category scene
 * @advanced
 */
export type InstanceDataType = 'vec4<f32>' | 'vec4<u32>' | 'vec4<i32>';

/**
 * One instance-data field of a {@link BatchedMesh3D}: its type and the value every slot starts with
 * @category scene
 * @advanced
 */
export interface InstanceDataField {
  /** The four numbers every slot starts with */
  value: ArrayLike<number>;
  /** What a shader bit reads `instance.<name>` as */
  type: InstanceDataType;
}

/**
 * The instance-data fields of a {@link BatchedMesh3D}, keyed by the name shader bits read them by
 * @category scene
 * @advanced
 */
export type InstanceDataOptions = Record<string, InstanceDataField>;

/** @internal */
export interface InstanceDataLayout {
  readonly struct: StructDefinition;
  readonly offsets: Readonly<Record<string, number>>;
  readonly stride: number;
  readonly defaults: Uint32Array;
  /** Part of the shader cache key; equal for batches that declare the same fields in the same order */
  readonly key: string;
}

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const FIELD_TYPES: readonly InstanceDataType[] = ['vec4<f32>', 'vec4<u32>', 'vec4<i32>'];

/**
 * Lays a batch's instance-data fields out over one row; refuses `__` in a name, which GLSL reserves
 * @internal
 */
export function createInstanceDataLayout(fields: InstanceDataOptions): InstanceDataLayout {
  const names = Object.keys(fields);
  if (names.length === 0) {
    throw new Error('instanceData: no fields declared. Declare at least one, or leave the option out.');
  }

  const struct: StructDefinition = {};

  for (const name of names) {
    const field = fields[name];

    if (!FIELD_NAME.test(name) || name.includes('__')) {
      throw new Error(
        `instanceData: "${name}" is not a usable field name. Use letters, digits and single underscores, starting with a letter.`,
      );
    }
    if (!FIELD_TYPES.includes(field.type)) {
      throw new Error(`instanceData: field "${name}" is "${field.type}". Use ${FIELD_TYPES.join(', ')}.`);
    }
    if (field.value?.length !== 4) {
      throw new Error(`instanceData: field "${name}" needs a value of four numbers.`);
    }

    struct[name] = field.type;
  }

  const layout = createStructLayout(struct);
  const defaults = new Uint32Array(layout.size / 4);
  const floats = new Float32Array(defaults.buffer);
  const offsets: Record<string, number> = {};

  for (const element of layout.elements) {
    const word = element.offset / 4;
    const { type, value } = fields[element.name];
    const target = type === 'vec4<f32>' ? floats : defaults;

    offsets[element.name] = word;
    for (let i = 0; i < 4; i++) target[word + i] = value[i];
  }

  return {
    struct,
    offsets,
    stride: defaults.length,
    defaults,
    key: names.map((name) => `${name}:${fields[name].type}`).join(','),
  };
}
