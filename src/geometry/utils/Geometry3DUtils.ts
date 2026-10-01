import { Buffer, BufferUsage, getAttributeInfoFromFormat } from 'pixi.js';
import type { Attribute, TypedArray, VertexFormat } from 'pixi.js';

import { Box } from '../../math/shapes/Box';
import { Vector3 } from '../../math/vector/Vector3';
import type { Geometry3DOptions } from '../Geometry3D';

/**
 * Splits an attribute input into its raw data and, for an `Attribute`, the format it declares
 * @param input - Attribute input from the geometry options; `undefined` when absent
 * @internal
 */
export function resolveAttributeInput(
  input: TypedArray | Attribute | undefined,
): { data: TypedArray; format?: VertexFormat } | undefined {
  if (!input) return undefined;
  if (ArrayBuffer.isView(input)) return { data: input as TypedArray };
  return { data: input.buffer.data as TypedArray, format: input.format };
}

/**
 * Turns an attribute input into the data, component count and vertex format to upload
 *
 * An `Attribute` is used as given. A typed array is padded or quantized by `prepareAttributeData`
 * and gets its format from `getAttributeFormat`.
 * @param input - Attribute input from the geometry options; `undefined` when absent
 * @param size - Components per vertex before any padding
 * @param normalized - Whether integer data maps to a normalized (snorm/unorm) format. For positions,
 * UVs and colours, callers pass `true` for any typed array other than `Float32Array`, a rule
 * pixijs/pixi-3d#41 plans to replace with explicit formats.
 * @param quantize - Quantize Float32 data into Int16 snorm
 * @internal
 */
export function resolveAttribute(
  input: TypedArray | Attribute | undefined,
  size: number,
  normalized: boolean,
  quantize: boolean,
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

  const prepared = prepareAttributeData(resolved.data, size, normalized, quantize);
  return {
    data: prepared.data,
    size: prepared.size,
    format: getAttributeFormat(prepared.data, prepared.size, prepared.normalized),
  };
}

/**
 * Pads three-component integer data to four components, leaving the fourth at zero
 *
 * WebGPU has no three-component vertex format for 8- or 16-bit integers. The shader reads only
 * the first three components.
 * @param data - Vertex data to widen
 * @internal
 */
function padTo4Components<T extends TypedArray>(data: T): T {
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

/**
 * Quantizes or pads raw attribute data ahead of upload
 *
 * With `quantize`, Float32 data is clamped to `[-1, 1]` and stored as Int16 snorm, three
 * components padded to four. Otherwise three-component integer data is padded to four by
 * `padTo4Components`. Anything else passes through.
 *
 * The clamp is written as ternaries rather than `Math.min` / `Math.max` because it runs once per
 * component of every quantized normal and tangent.
 * @param data - Raw attribute data
 * @param size - Components per vertex in `data`
 * @param normalized - Whether integer data is normalized; passed through unless quantizing
 * @param quantize - Map Float32 data in `[-1, 1]` to Int16 snorm
 * @internal
 */
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

/**
 * Computes the box around raw xyz position data of any typed-array type
 *
 * The box is in the space the vertex shader's `position` lives in, so integer data is used as
 * stored. For quantized data that is integer space: the position bit multiplies the normalized
 * `aPosition` back up by the format's divisor, and the exporter bakes the inverse into the node's
 * scale.
 * @param positions - Packed xyz positions, three components per vertex
 * @internal
 */
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

/**
 * Infers a `VertexFormat` from a typed array's type, component count, and normalized flag
 * @param data - Attribute data; its array type picks the base format
 * @param size - Components per vertex; 3 maps to an x4 format for integer data, matching the
 * padding `prepareAttributeData` adds
 * @param normalized - Pick a snorm/unorm format for integer data
 * @internal
 */
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
 * Builds an interleaved attribute map from {@link Geometry3DOptions} inputs, packing every
 * per-vertex attribute into one shared buffer
 *
 * The copy loop is unrolled for two, three and four components, which covers every attribute the
 * options produce once padded; a generic loop handles any other size.
 * @param options - Geometry options supplying the per-vertex attributes
 * @param shrinkToFit - Whether the shared buffer may shrink to fit its data on resize
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
    normalized: boolean,
    quantize = false,
  ) => {
    const r = resolveAttribute(input, size, normalized, quantize);
    if (!r) return;

    arrays.push({
      data: r.data,
      attribute,
      size: r.size,
      bytesPerElement: r.data.BYTES_PER_ELEMENT,
      format: r.format,
    });
  };

  add(options.positions, 'aPosition', 3, !!options.positions && !(options.positions instanceof Float32Array));
  add(options.uvs, 'aUV', 2, !!options.uvs && !(options.uvs instanceof Float32Array));
  add(options.normals, 'aNormal', 3, true, options.quantizeNormals ?? true);
  add(options.tangents, 'aTangent', 4, true, options.quantizeTangents ?? true);
  add(options.joints, 'aJoints', 4, false);
  add(options.weights, 'aWeights', 4, true);
  add(options.colors, 'aColor', 4, !!options.colors && !(options.colors instanceof Float32Array));
  add(options.colors1, 'aColor1', 4, !!options.colors1 && !(options.colors1 instanceof Float32Array));

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
 * Vertex count of an attribute map: the first non-instance attribute's byte length over its stride
 *
 * Pixi's own `Geometry.vertexCount` assumes 4-byte elements, so it miscounts quantized buffers.
 * @param attributes - Attribute map to measure
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
 * Builds a geometry's index buffer, with sequential indices `[0, vertexCount)` when none are given
 *
 * Every geometry is indexed because every batched draw is: the atlas packs geometries by index
 * range. A `Uint16Array` whose byte length isn't a multiple of 4 is copied into a `Uint32Array`,
 * because WebGPU writes buffers in 4-byte steps. Returns `undefined` when there are no vertices to
 * index.
 * @param indices - Supplied indices, or `undefined` to synthesize sequential ones
 * @param attributes - Attribute map that gives the vertex count when synthesizing
 * @param shrinkToFit - Whether the buffer may shrink to fit its data on resize
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
 * Rounds a byte offset or stride up to a multiple of 4, the alignment WebGPU requires of vertex
 * attribute offsets and strides
 * @param bytes - Byte offset or stride to align
 * @internal
 */
export function alignTo4Bytes(bytes: number): number {
  return (bytes + 3) & ~3;
}
