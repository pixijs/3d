import type { Scene3DDescriptor, Scene3DNode } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';

/**
 * Gives a primitive with no material the index after the file's materials, where
 * `processMaterials` adds the default one
 * @internal
 */
export function processNodes(gltfRaw: GltfFormat, descriptor: Scene3DDescriptor): void {
  if (!gltfRaw.nodes) return;

  descriptor.nodes = gltfRaw.nodes.map((nodeRaw, index) => {
    const children = nodeRaw.children ?? [];

    const node: Scene3DNode = {
      label: nodeRaw.name || `node_${index}`,
      children,
    };

    if (nodeRaw.matrix && nodeRaw.matrix.length === 16) {
      node.position = new Float32Array(3);
      node.rotation = new Float32Array(4);
      node.scale = new Float32Array(3);

      decomposeMatrix(nodeRaw.matrix, node.position, node.rotation, node.scale);
    } else {
      if (nodeRaw.translation) {
        node.position = new Float32Array(nodeRaw.translation);
      }

      if (nodeRaw.scale) {
        node.scale = new Float32Array(nodeRaw.scale);
      }

      if (nodeRaw.rotation) {
        node.rotation = new Float32Array(nodeRaw.rotation);
      }
    }

    if (nodeRaw.camera !== undefined) {
      node.camera = nodeRaw.camera;
    }

    if (nodeRaw.mesh !== undefined) {
      node.geometry = nodeRaw.mesh;

      const mesh = gltfRaw.meshes?.[nodeRaw.mesh];
      if (mesh) {
        const defaultMaterial = gltfRaw.materials?.length ?? 0;

        node.materials = mesh.primitives.map((p) => p.material ?? defaultMaterial);

        const weights = nodeRaw.weights ?? mesh.weights;
        if (weights) node.weights = weights;
      }
    }

    if (nodeRaw.extensions) {
      if (nodeRaw.extensions.KHR_lights_punctual) {
        node.light = nodeRaw.extensions.KHR_lights_punctual.light;
      }

      if (nodeRaw.extensions.KHR_node_visibility?.visible === false) {
        node.visible = false;
      }
    }

    if (nodeRaw.skin !== undefined) {
      node.skin = nodeRaw.skin;
    }

    return node;
  });
}

function decomposeMatrix(
  matrix: Float32Array | number[],
  position: Float32Array,
  quaternion: Float32Array,
  scale: Float32Array,
): void {
  const te = matrix;

  let sx = Math.sqrt(te[0] * te[0] + te[1] * te[1] + te[2] * te[2]);
  const sy = Math.sqrt(te[4] * te[4] + te[5] * te[5] + te[6] * te[6]);
  const sz = Math.sqrt(te[8] * te[8] + te[9] * te[9] + te[10] * te[10]);

  const det =
    te[0] * (te[5] * te[10] - te[9] * te[6]) -
    te[4] * (te[1] * te[10] - te[9] * te[2]) +
    te[8] * (te[1] * te[6] - te[5] * te[2]);

  if (det < 0) sx = -sx;

  position[0] = te[12];
  position[1] = te[13];
  position[2] = te[14];

  const invSX = 1 / sx;
  const invSY = 1 / sy;
  const invSZ = 1 / sz;

  const m11 = te[0] * invSX;
  const m21 = te[1] * invSX;
  const m31 = te[2] * invSX;

  const m12 = te[4] * invSY;
  const m22 = te[5] * invSY;
  const m32 = te[6] * invSY;

  const m13 = te[8] * invSZ;
  const m23 = te[9] * invSZ;
  const m33 = te[10] * invSZ;

  const trace = m11 + m22 + m33;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);

    quaternion[3] = 0.25 / s;
    quaternion[0] = (m32 - m23) * s;
    quaternion[1] = (m13 - m31) * s;
    quaternion[2] = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);

    quaternion[3] = (m32 - m23) / s;
    quaternion[0] = 0.25 * s;
    quaternion[1] = (m12 + m21) / s;
    quaternion[2] = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);

    quaternion[3] = (m13 - m31) / s;
    quaternion[0] = (m12 + m21) / s;
    quaternion[1] = 0.25 * s;
    quaternion[2] = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);

    quaternion[3] = (m21 - m12) / s;
    quaternion[0] = (m13 + m31) / s;
    quaternion[1] = (m23 + m32) / s;
    quaternion[2] = 0.25 * s;
  }

  scale[0] = sx;
  scale[1] = sy;
  scale[2] = sz;
}
