/**
 * `Skeleton.updateWorld` on a posed rig, timed in Node: the pass that composes every node's matrix from its
 * parent's and multiplies each joint by its inverse bind. A sample poses the rig (marks it dirty) and updates it,
 * returning a checksum of the bone matrices, so the skinning math itself is what's timed, with no render around it.
 * Every sample writes the same pose, so the checksum is the same on every call and every tree.
 *
 * The ladder is a Fox-sized rig of 24 nodes and a 256-node rig, each a binary tree of bones under one root.
 */

import { Skeleton } from '@pixi/3d';
import { cpu } from 'benchy';

function buildRig(nodeCount: number): Skeleton {
  const parent = new Int16Array(nodeCount);
  const joints = new Int16Array(nodeCount);
  const inverseBindMatrices = new Float32Array(nodeCount * 16);

  for (let i = 0; i < nodeCount; i++) {
    parent[i] = i === 0 ? -1 : (i - 1) >> 1;
    joints[i] = i;
    const m = i * 16;
    inverseBindMatrices[m] = inverseBindMatrices[m + 5] = inverseBindMatrices[m + 10] = inverseBindMatrices[m + 15] = 1;
    inverseBindMatrices[m + 13] = -i * 0.1;
  }

  return new Skeleton({ parent, joints, inverseBindMatrices });
}

cpu('skeleton update', {
  variants: { n24: { nodeCount: 24 }, n256: { nodeCount: 256 } },
  *run({ nodeCount }) {
    const skeleton = buildRig(nodeCount);
    const rotation = skeleton.localRotation;
    const position = skeleton.localPosition;
    let sum = 0;
    yield {
      bench: () => {
        for (let i = 0; i < nodeCount; i++) {
          const half = i * 0.05;
          rotation[i * 4 + 2] = Math.sin(half);
          rotation[i * 4 + 3] = Math.cos(half);
          position[i * 3 + 1] = 0.1;
        }
        skeleton.dirty = true;
        skeleton.updateWorld();
        const world = skeleton.worldMatrix;
        let s = 0;
        for (let i = 0; i < world.length; i += 7) s += world[i];
        sum = s;
        return s;
      },
      snapshot: () => Math.round(sum * 1e3) | 0,
    };
  },
});
