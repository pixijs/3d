/**
 * The transform maths of a frame, timed in Node: rebuilding a node's local matrix from its position, rotation and
 * scale (`Container3D.updateLocalTransform`), folding local matrices into their parents' world matrices down a tree
 * (`Matrix4.multiplyAffine`), writing joint matrices as three rows of four (`Matrix4.multiplyAffineTo3x4`), and
 * interpolating between a quaternion track's keys (`Quaternion.slerpFlat`). Each takes its data in the shape a frame
 * holds it: nodes, flat buffers with offsets, a track's flat key array.
 *
 * A sample is a thousand calls, a large scene's worth. Every bench writes into buffers it made in setup and folds
 * every result it writes into a checksum, so a change in the maths shows up as a changed snapshot rather than as a
 * silently faster run.
 */

import { Container3D, Matrix4, Quaternion } from '@pixi/3d';
import { cpu } from 'benchy';

import { mulberry32 } from './data/rng.ts';

/** Calls a sample makes: a large scene's transform update. */
const NODES = 1000;

/** Largest rotation between two keys of the quaternion track, in radians: 8°. */
const MAX_KEY_STEP = (8 * Math.PI) / 180;

/** A random unit quaternion, from an axis and an angle drawn from `random`. */
function rotation(random: () => number, maxAngle = Math.PI): Quaternion {
  const x = random() - 0.5;
  const y = random() - 0.5;
  const z = random() - 0.5;
  const length = Math.hypot(x, y, z) || 1;
  return new Quaternion().setFromAxisAngle({ x: x / length, y: y / length, z: z / length }, random() * maxAngle);
}

/** `count` composed affine matrices, sixteen floats each in one buffer, with scales near 1. */
function affineMatrices(count: number, seed: number): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(count * 16);
  const matrix = new Matrix4();
  for (let i = 0; i < count; i++) {
    const scale = { x: 0.9 + random() * 0.2, y: 0.9 + random() * 0.2, z: 0.9 + random() * 0.2 };
    const position = { x: random() * 4 - 2, y: random() * 4 - 2, z: random() * 4 - 2 };
    out.set(matrix.compose(position, rotation(random), scale).elements, i * 16);
  }
  return out;
}

cpu('rebuild 1k local matrices', function* () {
  const random = mulberry32(0x5eed_1234);
  const nodes = Array.from({ length: NODES }, () => {
    const node = new Container3D();
    node.position.set(random() * 20 - 10, random() * 20 - 10, random() * 20 - 10);
    node.quaternion.copyFrom(rotation(random));
    node.scale.set(0.5 + random(), 0.5 + random(), 0.5 + random());
    return node;
  });
  let sum = 0;
  yield {
    bench: () => {
      let checksum = 0;
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        node.updateLocalTransform();
        const out = node.localTransform.elements;
        checksum += out[0] + out[6] + out[9] + out[14];
      }
      sum = checksum;
      return checksum;
    },
    // The checksum reads a lane of every column of every node's matrix; the matrix left behind is the last node's.
    snapshot: () => [sum, ...Array.from(nodes[NODES - 1].localTransform.elements)],
  };
});

/**
 * A tree of nodes in parent-before-child order, so one sweep finds every parent's world matrix before its children
 * need it: each node's world matrix is its parent's times its local. The locals sit in a buffer of their own, so
 * every sample starts from the same input.
 */
cpu('fold 1k local matrices into world matrices', function* () {
  const random = mulberry32(0x7ee5_0001);
  const parents = Int32Array.from({ length: NODES }, (_, node) => (node === 0 ? -1 : Math.floor(random() * node)));
  const locals = affineMatrices(NODES, 0x7ee5_0002);
  const world = new Float32Array(NODES * 16);
  world.set(locals.subarray(0, 16));
  let sum = 0;
  yield {
    bench: () => {
      let checksum = 0;
      for (let node = 1; node < NODES; node++) {
        const at = node * 16;
        Matrix4.multiplyAffine(world, at, world, parents[node] * 16, locals, at);
        checksum += world[at] + world[at + 6] + world[at + 9] + world[at + 14];
      }
      sum = checksum;
      return checksum;
    },
    snapshot: () => [sum, ...Array.from(world.subarray((NODES - 1) * 16))],
  };
});

/** Joint matrices: each joint's node world matrix times its inverse bind matrix, stored as three rows of four. */
cpu('write 1k joint matrices', function* () {
  const world = affineMatrices(NODES, 0x7ee5_0003);
  const inverseBinds = affineMatrices(NODES, 0x7ee5_0004);
  const joints = new Float32Array(NODES * 12);
  let sum = 0;
  yield {
    bench: () => {
      let checksum = 0;
      for (let joint = 0; joint < NODES; joint++) {
        const at = joint * 12;
        Matrix4.multiplyAffineTo3x4(joints, at, world, joint * 16, inverseBinds, joint * 16);
        checksum += joints[at] + joints[at + 5] + joints[at + 10] + joints[at + 11];
      }
      sum = checksum;
      return checksum;
    },
    snapshot: () => [sum, ...Array.from(joints.subarray((NODES - 1) * 12))],
  };
});

/**
 * A baked quaternion track's interpolation: from one key to the next of the track's flat values, into a four-float
 * target. The keys are a random walk that turns by up to 8° from one key to the next, so the pairs range from all but
 * parallel to several degrees apart.
 */
cpu('slerp 1k quaternion keys', function* () {
  const random = mulberry32(0xb01d_face);
  const values = new Float32Array((NODES + 1) * 4);
  const key = new Quaternion();
  for (let at = 0; at < values.length; at += 4) {
    key.multiply(rotation(random, MAX_KEY_STEP)).normalize();
    values.set([key.x, key.y, key.z, key.w], at);
  }
  const progress = Float64Array.from({ length: NODES }, () => random());
  const target = new Float32Array(4);
  // `slerpFlat` is typed for plain arrays and reads typed ones alike.
  const keys = values as unknown as number[];
  const out = target as unknown as number[];
  let sum = 0;
  yield {
    bench: () => {
      let checksum = 0;
      for (let index = 0; index < NODES; index++) {
        Quaternion.slerpFlat(out, 0, keys, index * 4, keys, index * 4 + 4, progress[index]);
        checksum += target[0] + target[1] * 0.5 + target[2] * 0.25 + target[3] * 0.125;
      }
      sum = checksum;
      return checksum;
    },
    snapshot: () => [sum, ...Array.from(target)],
  };
});
