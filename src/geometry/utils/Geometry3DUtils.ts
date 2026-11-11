import { Buffer, BufferUsage, getAttributeInfoFromFormat } from 'pixi.js';
import type { Attribute, TypedArray, VertexFormat } from 'pixi.js';

import { Box } from '../../math/shapes/Box';
import { Vector3 } from '../../math/vector/Vector3';
import type { Geometry3DOptions } from '../Geometry3D';

/** @internal */
export function resolveAttributeInput(
  input: TypedArray | Attribute | undefined,
): { data: TypedArray; format?: VertexFormat } | undefined {
  if (!input) return undefined;
  if (ArrayBuffer.isView(input)) return { data: input };
  return { data: input.buffer.data, format: input.format };
}

/** @internal */
export type IntegerFormat = 'norm' | 'int';

/**
 * Positions and UVs pass no `integerFormat`, as glTF stores them as normalized or raw integers and only an
 * `Attribute`'s format can say which
 * @internal
 */
export function resolveAttribute(
  input: TypedArray | Attribute | undefined,
  name: string,
  size: number,
  integerFormat?: IntegerFormat,
  quantize = false,
): { data: TypedArray; size: number; format: VertexFormat } | undefined {
  const resolved = resolveAttributeInput(input);
  if (!resolved) return undefined;

  if (resolved.format) {
    return {
      data: resolved.data,
      size: getAttributeInfoFromFormat(resolved.format).size,
      format: resolved.format,
    };
  }

  if (!integerFormat && !(resolved.data instanceof Float32Array)) {
    throw new Error(
      `[Geometry3D] ${name} got ${resolved.data.constructor.name} data, which could be normalized or raw integers. ` +
        'Pass a Float32Array, or an Attribute whose format says which.',
    );
  }

  const prepared = prepareAttributeData(resolved.data, size, integerFormat !== 'int', quantize);
  return {
    data: prepared.data,
    size: prepared.size,
    format: getAttributeFormat(prepared.data, prepared.size, prepared.normalized),
  };
}

/**
 * WebGPU has no three-component vertex format for 8- or 16-bit integers
 * @internal
 */
export function padTo4Components<T extends TypedArray>(data: T): T {
  const Ctor = data.constructor as new (len: number) => T;
  const vertexCount = data.length / 3;
  const out = new Ctor(vertexCount * 4);

  for (let i = 0; i < vertexCount; i++) {
    const src = i * 3;
    const dst = i * 4;
    out[dst] = data[src];
    out[dst + 1] = data[src + 1];
    out[dst + 2] = data[src + 2];
  }
  return out;
}

/** Clamps with ternaries, not `Math.min`/`Math.max`, as it runs per component of every quantized normal and tangent */
function prepareAttributeData(
  data: TypedArray,
  size: number,
  normalized: boolean,
  quantize: boolean,
): { data: TypedArray; size: number; normalized: boolean } {
  if (quantize && data instanceof Float32Array) {
    const vertexCount = data.length / size;
    const outSize = size === 3 ? 4 : size;
    const quantized = new Int16Array(vertexCount * outSize);

    for (let i = 0; i < vertexCount; i++) {
      const src = i * size;
      const dst = i * outSize;
      for (let j = 0; j < size; j++) {
        const v = data[src + j];
        quantized[dst + j] = (v < -1 ? -1 : v > 1 ? 1 : v) * 32767;
      }
    }

    return { data: quantized, size: outSize, normalized: true };
  }

  if (size === 3 && !(data instanceof Float32Array)) {
    return { data: padTo4Components(data), size: 4, normalized };
  }

  return { data, size, normalized };
}

/** @internal */
export function computeBoundsFromPositions(positions: TypedArray): Box {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return new Box(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

function getAttributeFormat(data: TypedArray, size: number, normalized: boolean): VertexFormat {
  if (data instanceof Float32Array) {
    if (size === 1) return 'float32';
    if (size === 2) return 'float32x2';
    if (size === 3) return 'float32x3';
    return 'float32x4';
  }

  const suffix = size === 3 ? 'x4' : `x${size}`;

  if (normalized) {
    if (data instanceof Int8Array) return `snorm8${suffix}` as VertexFormat;
    if (data instanceof Uint8Array) return `unorm8${suffix}` as VertexFormat;
    if (data instanceof Int16Array) return `snorm16${suffix}` as VertexFormat;
    if (data instanceof Uint16Array) return `unorm16${suffix}` as VertexFormat;
  } else {
    if (data instanceof Int8Array) return `sint8${suffix}` as VertexFormat;
    if (data instanceof Uint8Array) return `uint8${suffix}` as VertexFormat;
    if (data instanceof Int16Array) return `sint16${suffix}` as VertexFormat;
    if (data instanceof Uint16Array) return `uint16${suffix}` as VertexFormat;
    if (data instanceof Int32Array) return `sint32${suffix}` as VertexFormat;
    if (data instanceof Uint32Array) return `uint32${suffix}` as VertexFormat;
  }

  return 'float32x4';
}

/**
 * The copy is unrolled for 2, 3 and 4 components, as that beats a loop per component
 * @internal
 */
export function interleaveData(options: Geometry3DOptions, shrinkToFit?: boolean): Record<string, Attribute> {
  const arrays: {
    data: TypedArray;
    attribute: string;
    size: number;
    bytesPerElement: number;
    format: VertexFormat;
  }[] = [];

  const add = (
    input: TypedArray | Attribute | undefined,
    attribute: string,
    size: number,
    integerFormat?: IntegerFormat,
    quantize?: boolean,
  ) => {
    const r = resolveAttribute(input, attribute, size, integerFormat, quantize);
    if (!r) return;

    arrays.push({
      data: r.data,
      attribute,
      size: r.size,
      bytesPerElement: r.data.BYTES_PER_ELEMENT,
      format: r.format,
    });
  };

  add(options.positions, 'aPosition', 3);
  add(options.uvs, 'aUV', 2);
  add(options.normals, 'aNormal', 3, 'norm', options.quantizeNormals ?? true);
  add(options.tangents, 'aTangent', 4, 'norm', options.quantizeTangents ?? true);
  add(options.joints, 'aJoints', 4, 'int');
  add(options.weights, 'aWeights', 4, 'norm');
  add(options.colors, 'aColor', 4, 'norm');
  add(options.colors1, 'aColor1', 4, 'norm');

  let stride = 0;
  const offsets: number[] = [];

  for (let i = 0; i < arrays.length; i++) {
    const info = arrays[i];
    stride = alignTo4Bytes(stride);
    offsets.push(stride);
    stride += info.size * info.bytesPerElement;
  }

  stride = alignTo4Bytes(stride);

  let positionsEntry: (typeof arrays)[number] | undefined;
  for (let i = 0; i < arrays.length; i++) {
    if (arrays[i].attribute === 'aPosition') {
      positionsEntry = arrays[i];
      break;
    }
  }
  const vertexCount = positionsEntry!.data.length / positionsEntry!.size;
  const totalSize = stride * vertexCount;

  const interleavedBuffer = new ArrayBuffer(totalSize);

  const attributes: Record<string, Attribute> = {};
  const buffer = new Buffer({
    data: new Uint8Array(interleavedBuffer),
    label: 'interleaved-mesh-buffer',
    shrinkToFit,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });

  for (let index = 0; index < arrays.length; index++) {
    const info = arrays[index];
    const { data, attribute, size, bytesPerElement } = info;
    const offset = offsets[index];

    const Type = data.constructor as new (buffer: ArrayBuffer) => TypedArray;
    const view = new Type(interleavedBuffer);
    const strideInElements = stride / bytesPerElement;
    const offsetInElements = offset / bytesPerElement;

    if (size === 2) {
      for (let i = 0; i < vertexCount; i++) {
        const dst = i * strideInElements + offsetInElements;
        const src = i * 2;
        view[dst] = data[src];
        view[dst + 1] = data[src + 1];
      }
    } else if (size === 3) {
      for (let i = 0; i < vertexCount; i++) {
        const dst = i * strideInElements + offsetInElements;
        const src = i * 3;
        view[dst] = data[src];
        view[dst + 1] = data[src + 1];
        view[dst + 2] = data[src + 2];
      }
    } else if (size === 4) {
      for (let i = 0; i < vertexCount; i++) {
        const dst = i * strideInElements + offsetInElements;
        const src = i * 4;
        view[dst] = data[src];
        view[dst + 1] = data[src + 1];
        view[dst + 2] = data[src + 2];
        view[dst + 3] = data[src + 3];
      }
    } else {
      for (let i = 0; i < vertexCount; i++) {
        const destIndex = i * strideInElements + offsetInElements;
        const srcIndex = i * size;
        for (let j = 0; j < size; j++) {
          view[destIndex + j] = data[srcIndex + j];
        }
      }
    }

    attributes[attribute] = {
      buffer,
      format: info.format,
      stride,
      offset,
    };
  }

  return attributes;
}

/**
 * Pixi's own `Geometry.vertexCount` assumes 4-byte elements, so it miscounts quantized buffers
 * @internal
 */
export function vertexCountFromAttributes(attributes: Record<string, Attribute>): number {
  for (const i in attributes) {
    const attribute = attributes[i];
    if (attribute.instance) continue;
    const stride = attribute.stride;
    if (!stride) continue;
    return attribute.buffer.data.byteLength / stride;
  }
  return 0;
}

/**
 * Indexes every geometry, as the atlas packs by index range, and widens an odd-length `Uint16Array`, as
 * WebGPU writes buffers in 4-byte steps
 * @internal
 */
export function createIndexBuffer(
  indices: Uint16Array | Uint32Array | undefined,
  attributes: Record<string, Attribute>,
  shrinkToFit?: boolean,
): Buffer | undefined {
  if (!indices) {
    const vertexCount = vertexCountFromAttributes(attributes);
    if (vertexCount === 0) return undefined;

    indices = vertexCount > 65536 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) indices[v] = v;
  }

  if (indices instanceof Uint16Array && indices.byteLength % 4 !== 0) {
    indices = new Uint32Array(indices);
  }

  return new Buffer({
    data: indices,
    label: 'index-mesh-buffer',
    shrinkToFit,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });
}

/**
 * WebGPU requires vertex attribute offsets and strides to be multiples of 4
 * @internal
 */
export function alignTo4Bytes(bytes: number): number {
  return (bytes + 3) & ~3;
}
