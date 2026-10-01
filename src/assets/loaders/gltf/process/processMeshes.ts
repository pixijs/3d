import { Buffer, BufferUsage, warn } from 'pixi.js';
import type { Topology, TypedArray } from 'pixi.js';

import { Geometry3D } from '../../../../geometry/Geometry3D';
import type { Geometry3DOptions } from '../../../../geometry/Geometry3D';
import { Box } from '../../../../math/shapes/Box';
import { Vector3 } from '../../../../math/vector/Vector3';
import { warnOnce } from '../../../../utils/warnOnce';
import type { Scene3DSource } from '../../../Scene3DSource';
import { decodeDracoPrimitive } from '../draco/decodeDracoPrimitive';
import type { GltfFormat, MeshPrimitive } from '../GltfFormat';
import { accessorToVertexFormat } from '../utils/accessorToVertexFormat';
import { getBuffer } from '../utils/getBuffer';
import { GLTF_SEMANTIC_TO_ATTRIBUTE } from '../utils/gltfAttributeMap';
import { widenColorToRgba } from '../utils/widenColorToRgba';

const GL_FLOAT = 5126;

/**
 * The topology for each glTF primitive `mode`
 *
 * WebGPU has no line loop or triangle fan. A line loop (2) draws as a line strip, without its
 * closing segment. A triangle fan (6) draws as a triangle list with its indices unconverted, so it
 * renders wrong.
 */
const topologyMap: Record<number, Topology> = {
  0: 'point-list',
  1: 'line-list',
  2: 'line-strip',
  3: 'line-strip',
  4: 'triangle-list',
  5: 'triangle-strip',
  6: 'triangle-list',
};

/**
 * Builds the geometry for one primitive, decoding Draco first when the primitive uses it
 *
 * Some attributes need adapting for `Geometry3D`:
 * - 8-bit indices widen to 16-bit, as neither `Geometry3D` nor WebGPU takes 8-bit indices.
 * - Integer UVs get an explicit vertex format. Without one, `Geometry3D` reads any integer array
 *   as normalized, which would squash unnormalized quantized UVs (`KHR_mesh_quantization`) into
 *   0 to 1.
 * - VEC3 colours widen to RGBA.
 * - An attribute with no `Geometry3D` field is skipped with a warning.
 *
 * The bounds come from the `POSITION` accessor's `min` and `max`. For quantized positions those are
 * in integer space, the space `computeBoundsFromPositions` describes, so they are used as they are.
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers holding the vertex and index data
 * @param primitiveRaw - The primitive to build
 */
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
    if (primitiveRaw.indices !== undefined) {
      const raw = getBuffer(gltfRaw, buffers, primitiveRaw.indices);
      options.indices = raw instanceof Uint8Array ? new Uint16Array(raw) : (raw as Uint16Array | Uint32Array);
    }

    for (const i in primitiveRaw.attributes) {
      const attributeName = GLTF_SEMANTIC_TO_ATTRIBUTE[i];
      if (attributeName) {
        const accessorIndex = primitiveRaw.attributes[i];
        const data = getBuffer(gltfRaw, buffers, accessorIndex);
        const accessor = gltfRaw.accessors?.[accessorIndex];

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
        warnOnce(`pixi3d-custom-attribute-${i}`, `[pixi-3d] custom attribute ${i} skipped`);
      }
    }

    if (primitiveRaw.targets) {
      const morphTargets = decodeMorphTargets(gltfRaw, buffers, primitiveRaw.targets);
      if (morphTargets) options.morphTargets = morphTargets;
    }
  }

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

  return new Geometry3D(options);
}

/**
 * Reads a primitive's morph-target offsets: `POSITION` always, `NORMAL` when present
 *
 * The renderer needs float `POSITION` offsets for every target, so if a target lacks them or stores
 * them as integers this returns `undefined` and the mesh keeps its base pose. Normal offsets come for
 * every target or none, as every target is packed with the same stride, so integer or missing
 * normals on some targets fall back to morphing positions only. The offsets are copied out of the
 * file's buffers, since the geometry keeps them.
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
 *
 * A mesh's primitives share one set of morph weights, so it warns when their target counts differ.
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
