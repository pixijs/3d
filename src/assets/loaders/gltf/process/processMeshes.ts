import { Buffer, BufferUsage, warn } from 'pixi.js';
import type { Attribute, Topology, TypedArray } from 'pixi.js';

import { Geometry3D } from '../../../../geometry/Geometry3D';
import type { Geometry3DOptions } from '../../../../geometry/Geometry3D';
import { padTo4Components } from '../../../../geometry/utils/Geometry3DUtils';
import { Box } from '../../../../math/shapes/Box';
import { Vector3 } from '../../../../math/vector/Vector3';
import { warnOnce } from '../../../../utils/warnOnce';
import type { Scene3DSource } from '../../../Scene3DSource';
import { decodeDracoPrimitive } from '../draco/decodeDracoPrimitive';
import type { GltfFormat } from '../GltfFormat';
import { accessorToVertexFormat, NORMALIZED_SCALE } from '../utils/accessorToVertexFormat';
import { getBuffer } from '../utils/getBuffer';
import { GLTF_SEMANTIC_TO_ATTRIBUTE } from '../utils/gltfAttributeMap';
import { widenColorToRgba } from '../utils/widenColorToRgba';

const GL_FLOAT = 5126;

/**
 * Pixi's `Topology` has no line loop (2) or triangle fan (6), as WebGPU lacks them: a loop loses its
 * closing segment, and a fan draws wrong
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

async function processPrimitive(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
  primitiveRaw: GltfFormat.MeshPrimitive,
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

        (options as Record<string, unknown>)[attributeName] = data;
      } else {
        warnOnce(`pixijs-3d-custom-attribute-${i}`, `[@pixi/3d] custom attribute ${i} skipped`);
      }
    }

    if (primitiveRaw.targets) {
      const morphTargets = decodeMorphTargets(gltfRaw, buffers, primitiveRaw.targets);
      if (morphTargets) options.morphTargets = morphTargets;
    }
  }

  const uvAccessorIndex = primitiveRaw.attributes.TEXCOORD_0;
  if (uvAccessorIndex !== undefined && gltfRaw.accessors) {
    options.uvs = accessorToAttribute(options.uvs, gltfRaw.accessors[uvAccessorIndex]);
  }

  const positionAccessorIndex = primitiveRaw.attributes.POSITION;
  if (positionAccessorIndex !== undefined && gltfRaw.accessors) {
    const positionAccessor = gltfRaw.accessors[positionAccessorIndex];
    options.positions = accessorToAttribute(options.positions, positionAccessor);

    const { min, max } = positionAccessor;
    if (min && max) {
      const scale = positionAccessor.normalized ? NORMALIZED_SCALE[positionAccessor.componentType] : 1;
      options.bounds3D = new Box(
        new Vector3(min[0] * scale, min[1] * scale, min[2] * scale),
        new Vector3(max[0] * scale, max[1] * scale, max[2] * scale),
      );
    } else if (positionAccessor.componentType !== GL_FLOAT) {
      throw new Error(
        `[@pixi/3d] POSITION accessor ${positionAccessorIndex} stores integers but has no min and max, ` +
          'which glTF requires and the bounds come from.',
      );
    }
  }

  options.topology = topologyMap[primitiveRaw.mode ?? 4];

  return new Geometry3D(options);
}

/**
 * Pads integer VEC3 data to the `x4` format `accessorToVertexFormat` gives it. Draco data comes
 * through here too, as `draco.worker.ts` decodes into the accessor's component type
 */
function accessorToAttribute(
  data: Float32Array | Attribute | undefined,
  accessor: GltfFormat.Accessor,
): Float32Array | Attribute | undefined {
  if (accessor.componentType === GL_FLOAT || !ArrayBuffer.isView(data)) return data;

  return {
    buffer: new Buffer({
      data: accessor.type === 'VEC3' ? padTo4Components(data) : data,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    }),
    format: accessorToVertexFormat(accessor),
  };
}

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
      warn(`[@pixi/3d] morph target ${t} has no POSITION deltas; rendering base pose.`);
      return undefined;
    }

    const accessor = gltfRaw.accessors?.[accessorIndex];
    if (accessor && accessor.componentType !== GL_FLOAT) {
      warn(
        `[@pixi/3d] morph target ${t} uses non-float POSITION deltas, which are not supported; rendering base pose.`,
      );
      return undefined;
    }

    const entry: { positions: Float32Array; normals?: Float32Array } = {
      positions: getBuffer(gltfRaw, buffers, accessorIndex, true) as Float32Array,
    };

    const normalIndex = targets[t].NORMAL;
    if (normalIndex !== undefined) {
      const normalAccessor = gltfRaw.accessors?.[normalIndex];
      if (normalAccessor && normalAccessor.componentType !== GL_FLOAT) {
        warn(`[@pixi/3d] morph target ${t} has non-float NORMAL deltas; morphing positions only.`);
      } else {
        entry.normals = getBuffer(gltfRaw, buffers, normalIndex, true) as Float32Array;
        normalCount++;
      }
    }

    morphTargets.push(entry);
  }

  if (normalCount > 0 && normalCount < morphTargets.length) {
    warn(`[@pixi/3d] morph targets mix NORMAL deltas; morphing positions only.`);
    for (const target of morphTargets) target.normals = undefined;
  }

  return morphTargets.length > 0 ? morphTargets : undefined;
}

/** @internal */
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
            `[@pixi/3d] mesh ${i} primitive ${p} has ${geometries[p].morphTargetCount} morph targets, ` +
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
