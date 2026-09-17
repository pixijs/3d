import { Buffer, BufferUsage, getAttributeInfoFromFormat } from 'pixi.js';
import type { Attribute, TypedArray, VertexFormat } from 'pixi.js';

import { Box } from '../../math/shapes/Box';
import { Vector3 } from '../../math/vector/Vector3';
import type { Geometry3DOptions } from '../Geometry3D';

/**
 * Resolves a per-attribute input to raw data + optional explicit format
 *
 * - `TypedArray` -> infer format from the typed-array type (legacy heuristic).
 * - `Attribute`  -> trust its `format`, extract `buffer.data` as the raw array.
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
 * Resolves a per-attribute input into the canonical `{ data, size, format }`
 * triple used by both the per-attribute and interleaved geometry paths
 *
 * Combines `resolveAttributeInput` (input shape) + `prepareAttributeData`
 * (VEC3->VEC4 padding, optional float->snorm16 quantization) + `getAttributeFormat`
 * (typed-array -> `VertexFormat` heuristic) so the two callsites share one
 * inference pipeline. Inputs with an explicit `format` skip the heuristic
 * entirely; their `size` is recovered from `getAttributeInfoFromFormat`.
 *
 * Returns `undefined` for missing inputs so the callers can skip in one line.
 * @param input - Attribute input from the geometry options; `undefined` when absent
 * @param size - Components per vertex before any padding
 * @param normalized - Whether integer data maps to a normalized (snorm/unorm) format
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
 * Pads VEC3 non-float data to VEC4
 *
 * WebGPU has no x3 vertex formats for integer/normalized types, so 3-component
 * integer data must be widened to 4 components (the 4th lane is zero-filled
 * and ignored by the shader).
 * @param data - Vertex data to widen
 * @internal
 */
function padTo4Components<T extends TypedArray>(data: T): T {
  const Ctor = data.constructor as new (len: number) => T;
  const vertexCount = data.length / 3;
  const out = new Ctor(vertexCount * 4);

  // The 4th lane is left zero from the typed-array constructor.
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
 * Normalises raw attribute data ahead of upload
 *
 *   - `quantize=true` + Float32: maps `[-1, 1]` floats into `Int16` snorm,
 *     widening 3-component data to 4 components (no x3 snorm format exists).
 *   - non-float VEC3 (KHR_mesh_quantization): widens to VEC4 for the same
 *     reason; the snorm/unorm format is selected automatically downstream.
 *
 * Both paths return `{ data, size, normalized }` so the caller doesn't need
 * to know whether widening or quantization happened.
 *
 * NOTE: relies on the "non-Float32Array means normalized" inference rule
 * (tracked in pixijs/pixi-3d#41).
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

    // Inline ternary clamps avoid the Math.min/Math.max function-call dispatch
    // on the per-component hot path. This loop runs vertexCount * size times
    // for every quantized normal/tangent attribute uploaded.
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
 * Computes a Box from raw VEC3 position data of any supported typed-array type
 *
 * Bounds are returned in the same space the vertex shader's `position` output
 * lives in: for quantized data, that's integer-space `Q` (the position bit
 * multiplies the normalized `aPosition` by the format divisor `D` before any
 * model transform, and the exporter-baked `node.scale = S/D` maps `Q` back to
 * world space). So min/max are used directly, with no divisor applied.
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
 * @param size - Components per vertex; 3 maps to an x4 format for non-float data
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

  // WebGPU only supports x2 and x4 for most integer/normalized types (no x3)
  // So we map 3 components to x4 (assuming padding)
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

  return 'float32x4'; // Fallback
}

/**
 * Builds an interleaved attribute map from {@link Geometry3DOptions} inputs, packing every
 * per-vertex attribute into one shared buffer
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
    // Align to 4 bytes (WebGPU requirement)
    stride = (stride + 3) & ~3;
    offsets.push(stride);
    stride += info.size * info.bytesPerElement;
  }

  // Align total stride to 4 bytes
  stride = (stride + 3) & ~3;

  // Derive vertex count from the already-resolved positions entry: its `size`
  // accounts for any VEC3->VEC4 padding inserted by `prepareAttributeData`.
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

    // Hot path: every glTF attribute is size 2 (UVs), 3 (positions/normals)
    // or 4 (tangents/joints/weights). Unrolling the inner copy loop saves
    // millions of iterations on heavy meshes and lets V8 keep the indices
    // in registers. Generic fallback retained for safety.
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
 * Vertex count from an attribute map — `byteLength / stride` of the first
 * non-instance attribute
 *
 * Correct for all typed-array types (unlike pixi's `getSize()`, which assumes
 * `Float32Array` and breaks for quantized buffers).
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
 * Resolves a geometry's index buffer
 *
 * Supplied `indices` are used as-is; when none are given, a sequential
 * `[0..vertexCount)` buffer is synthesized — the batched draw path is
 * index-based (the atlas packs by index range and the indirect draw args use
 * one uniform indexed layout), so every geometry is indexed. The synthesized
 * buffer depends only on the vertex count, so it's static — one upload, even
 * for `dynamic` geometry whose positions stream every frame. Returns
 * `undefined` for empty geometry (no vertices to index).
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

  // WebGPU requires index buffer size to be a multiple of 4 bytes; an odd-count
  // Uint16Array (e.g. 3 indices = 6 bytes) violates that — upgrade to Uint32.
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
