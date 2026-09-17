import { Buffer, BufferUsage, warn } from 'pixi.js';
import type { Topology, TypedArray } from 'pixi.js';

import { Geometry3D } from '../../../../geometry/Geometry3D';
import type { Geometry3DOptions } from '../../../../geometry/Geometry3D';
import { Box } from '../../../../math/shapes/Box';
import { Vector3 } from '../../../../math/vector/Vector3';
import type { Scene3DSource } from '../../../Scene3DSource';
import { decodeDracoPrimitive } from '../draco/decodeDracoPrimitive';
import type { GltfFormat, MeshPrimitive } from '../GltfFormat';
import { accessorToVertexFormat } from '../utils/accessorToVertexFormat';
import { getBuffer } from '../utils/getBuffer';
import { GLTF_SEMANTIC_TO_ATTRIBUTE } from '../utils/gltfAttributeMap';
import { widenColorToRgba } from '../utils/widenColorToRgba';

const GL_FLOAT = 5126;

const topologyMap: Record<number, Topology> = {
  0: 'point-list',
  1: 'line-list',
  2: 'line-strip',
  3: 'line-strip', // WebGPU doesn't strictly support LINE_LOOP
  4: 'triangle-list',
  5: 'triangle-strip',
  6: 'triangle-list', // TRIANGLE_FAN not supported in WebGPU
};

async function processPrimitive(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
  primitiveRaw: MeshPrimitive,
): Promise<Geometry3D> {
  const options: Geometry3DOptions = {};
  const dracoExt = primitiveRaw.extensions?.KHR_draco_mesh_compression;

  if (dracoExt) {
    Object.assign(options, await decodeDracoPrimitive(gltfRaw, buffers, primitiveRaw, dracoExt));
  } else {
    // Process indices. `getBuffer` returns the typed array matching the
    // accessor's componentType (Uint8Array for 5121, Uint16Array for 5123,
    // Uint32Array for 5125). Geometry3DOptions.indices accepts only 16/32-bit,
    // and WebGPU doesn't support 8-bit index buffers at all — upcast UINT8.
    if (primitiveRaw.indices !== undefined) {
      const raw = getBuffer(gltfRaw, buffers, primitiveRaw.indices);
      options.indices = raw instanceof Uint8Array ? new Uint16Array(raw) : (raw as Uint16Array | Uint32Array);
    }

    for (const i in primitiveRaw.attributes) {
      const attributeName = GLTF_SEMANTIC_TO_ATTRIBUTE[i];
      if (attributeName) {
        const accessorIndex = primitiveRaw.attributes[i];
        const data = getBuffer(gltfRaw, buffers, accessorIndex);

        // UVs need explicit format when non-float: the Geometry3D typed-array
        // heuristic treats any non-Float32Array as *normalized*, which auto-scales
        // raw integer UVs (e.g. KHR_mesh_quantization uint16 in [0, 4095]) into
        // [0, 1] before the shader sees them — collapsing the atlas transform.
        const accessor = gltfRaw.accessors?.[accessorIndex];

        // Colors are VEC3 or VEC4 in glTF; widen here so Geometry3D always sees
        // RGBA and shaders get one `vec4` contract.
        if ((attributeName === 'colors' || attributeName === 'colors1') && accessor) {
          (options as Record<string, unknown>)[attributeName] = widenColorToRgba(
            data as TypedArray,
            accessor.type === 'VEC3' ? 3 : 4,
          );
          continue;
        }

        if (attributeName === 'uvs' && accessor && accessor.componentType !== GL_FLOAT) {
          options.uvs = {
            buffer: new Buffer({
              data: data as Uint16Array,
              usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
            }),
            format: accessorToVertexFormat(accessor),
          };
        } else {
          (options as Record<string, unknown>)[attributeName] = data;
        }
      } else {
        // Custom attribute - strictly we could support this by adding to options.attributes
        // But for now we'll warn as Geometry3D expects standard attributes for interleaving
        // oxlint-disable-next-line no-console
        console.warn(`[gb-model-tools] custom attribute ${i} skipped`);
      }
    }

    // Morph targets — POSITION always, NORMAL when present (see decodeMorphTargets).
    if (primitiveRaw.targets) {
      const morphTargets = decodeMorphTargets(gltfRaw, buffers, primitiveRaw.targets);
      if (morphTargets) options.morphTargets = morphTargets;
    }
  }

  // Extract bounds from POSITION accessor if available.
  // Quantized non-normalized positions are in integer space — so are the shader-output
  // vertex positions (the position bit multiplies aPosition by the divisor),
  // so accessor.min/max are used as-is. Node TRS scale (S/D) maps both to world space.
  // VEC3→VEC4 padding for non-float attributes is handled inside Geometry3D.
  const positionAccessorIndex = primitiveRaw.attributes.POSITION;
  if (positionAccessorIndex !== undefined && gltfRaw.accessors) {
    const positionAccessor = gltfRaw.accessors[positionAccessorIndex];
    if (positionAccessor.min && positionAccessor.max) {
      options.bounds3D = new Box(
        new Vector3(positionAccessor.min[0], positionAccessor.min[1], positionAccessor.min[2]),
        new Vector3(positionAccessor.max[0], positionAccessor.max[1], positionAccessor.max[2]),
      );
    }
  }

  options.topology = topologyMap[primitiveRaw.mode ?? 4];

  // This will automatically handle interleaving, quantization and alignment!
  return new Geometry3D(options);
}

/**
 * Decodes a primitive's morph-target deltas: POSITION always, NORMAL when present
 *
 * Sparse accessors are decoded to dense by `getBuffer`. Returns
 * `undefined` (rendering the base pose) when any target is non-float or lacks
 * POSITION — the GPU layout requires dense float deltas for every target.
 * NORMAL deltas are all-or-nothing per primitive (the packed delta stride is
 * uniform), so unusable or mixed normals degrade to positions-only morphing
 * rather than to the base pose.
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers holding the delta accessors
 * @param targets - The primitive's morph targets, each mapping an attribute semantic to an accessor index
 */
function decodeMorphTargets(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
  targets: { [k: string]: number }[],
): { positions: Float32Array; normals?: Float32Array }[] | undefined {
  const morphTargets: { positions: Float32Array; normals?: Float32Array }[] = [];
  let normalCount = 0;

  for (let t = 0; t < targets.length; t++) {
    const accessorIndex = targets[t].POSITION;
    if (accessorIndex === undefined) {
      warn(`[pixi-3d] morph target ${t} has no POSITION deltas; rendering base pose.`);
      return undefined;
    }

    const accessor = gltfRaw.accessors?.[accessorIndex];
    if (accessor && accessor.componentType !== GL_FLOAT) {
      warn(`[pixi-3d] morph target ${t} uses non-float POSITION deltas, which are not supported; rendering base pose.`);
      return undefined;
    }

    // Deltas outlive the source glTF ArrayBuffer (the renderer packs them into the
    // shared delta buffer on first render), so ask getBuffer for owned arrays. It
    // copies only a view result; sparse/interleaved decodes are already owned, so
    // the common sparse case is decoded once, not decoded-then-copied.
    const entry: { positions: Float32Array; normals?: Float32Array } = {
      positions: getBuffer(gltfRaw, buffers, accessorIndex, true) as Float32Array,
    };

    const normalIndex = targets[t].NORMAL;
    if (normalIndex !== undefined) {
      const normalAccessor = gltfRaw.accessors?.[normalIndex];
      if (normalAccessor && normalAccessor.componentType !== GL_FLOAT) {
        warn(`[pixi-3d] morph target ${t} has non-float NORMAL deltas; morphing positions only.`);
      } else {
        entry.normals = getBuffer(gltfRaw, buffers, normalIndex, true) as Float32Array;
        normalCount++;
      }
    }

    morphTargets.push(entry);
  }

  if (normalCount > 0 && normalCount < morphTargets.length) {
    warn(`[pixi-3d] morph targets mix NORMAL deltas; morphing positions only.`);
    for (const target of morphTargets) target.normals = undefined;
  }

  return morphTargets.length > 0 ? morphTargets : undefined;
}

/**
 * Converts every glTF mesh's primitives into `Geometry3D` instances on the source
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers holding the vertex and index data
 * @param source - Receives the geometries
 * @internal
 */
export async function processMeshes(gltfRaw: GltfFormat, buffers: ArrayBuffer[], source: Scene3DSource): Promise<void> {
  if (!gltfRaw.meshes) return;

  await Promise.all(
    gltfRaw.meshes.map(async (meshRaw, i) => {
      const geometries = await Promise.all(
        meshRaw.primitives.map((primitiveRaw) => processPrimitive(gltfRaw, buffers, primitiveRaw)),
      );

      // All primitives of a mesh share one weights array, so their target counts
      // must agree. A mismatch means the shared weights can't drive every
      // primitive — warn rather than render inconsistently.
      const targetCount = geometries[0]?.morphTargetCount ?? 0;
      for (let p = 1; p < geometries.length; p++) {
        if (geometries[p].morphTargetCount !== targetCount) {
          warn(
            `[pixi-3d] mesh ${i} primitive ${p} has ${geometries[p].morphTargetCount} morph targets, ` +
              `expected ${targetCount} (all primitives of a mesh must match).`,
          );
        }
      }

      source.geometries[i] = geometries;

      if (meshRaw.name && geometries.length > 0) {
        source.geometry[meshRaw.name] = geometries[0];
      }
    }),
  );
}
