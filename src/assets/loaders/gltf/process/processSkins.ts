import { Matrix4 } from '../../../../math/matrix/Matrix4';
import { Quaternion } from '../../../../math/rotation/Quaternion';
import { Vector3 } from '../../../../math/vector/Vector3';
import type { Scene3DDescriptor, Scene3DNode, Scene3DSkin } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';
import { getBuffer } from '../utils/getBuffer';

const _jointRest = new Matrix4();
const _nodeLocal = new Matrix4();
const _inverseBind = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _unitScale = new Vector3(1, 1, 1);

/** Composing a rest pose with inverse binds that cancel it leaves float noise near 1e-7 */
const BIND_SHAPE_TOLERANCE = 1e-6;

/**
 * Ignores each skin's `skeleton` property, which glTF says skinning doesn't need (§3.7.3.1). Skins with
 * the same nodes and inverse binds merge, so a node's `skin` indexes the descriptor's skins, not the file's
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - By glTF buffer index
 * @param descriptor - Receives the skins; its joint nodes get marked and its skin indices remapped
 * @internal
 */
export function processSkins(gltfRaw: GltfFormat, buffers: ArrayBuffer[], descriptor: Scene3DDescriptor): void {
  if (!gltfRaw.skins) {
    descriptor.skins = [];

    return;
  }

  const parentMap = buildParentMap(gltfRaw.nodes);

  const meshSubtreeCache = new Map<number, boolean>();

  const skins: Scene3DSkin[] = [];

  const skinIndices: number[] = [];

  const entries = gltfRaw.skins.map((skinRaw) => ({
    skinRaw,
    parentNode: findParentNode(skinRaw.joints, parentMap),
    nodes: [] as number[],
  }));

  const collect = (entry: (typeof entries)[number]): void => {
    entry.nodes = collectSkeletonNodes(entry.skinRaw.joints, entry.parentNode, parentMap);

    if (!descriptor.nodes) return;

    for (const globalIdx of entry.nodes) {
      if (subtreeHasMesh(gltfRaw.nodes, globalIdx, meshSubtreeCache)) continue;

      const node = descriptor.nodes[globalIdx];

      if (node) node.isJoint = true;
    }
  };

  entries.forEach(collect);

  /** A lift marks new joints, which can sit above another skin's parent node, so loop until none moves */
  let moved = true;

  while (moved) {
    moved = false;

    for (const entry of entries) {
      const parentNode = liftParentNode(entry.parentNode, parentMap, gltfRaw.nodes, descriptor.nodes);

      if (parentNode === entry.parentNode) continue;

      entry.parentNode = parentNode;
      collect(entry);
      moved = true;
    }
  }

  for (const { skinRaw, parentNode, nodes } of entries) {
    const inverseBindMatrices = getBuffer(gltfRaw, buffers, skinRaw.inverseBindMatrices!) as Float32Array;
    const joints = skinRaw.joints;

    const globalToLocal = new Map<number, number>();

    nodes.forEach((globalIdx, localIdx) => globalToLocal.set(globalIdx, localIdx));

    const nodeCount = nodes.length;
    const skeletonParent = new Int16Array(nodeCount);
    const skeletonNodes = new Int32Array(nodeCount);

    for (let i = 0; i < nodeCount; i++) {
      const globalIdx = nodes[i];
      const globalParent = parentMap[globalIdx];

      skeletonNodes[i] = globalIdx;
      const localParent = globalToLocal.get(globalParent);

      skeletonParent[i] = localParent !== undefined ? localParent : -1;
    }

    const skeletonJoints = new Int16Array(joints.length);

    for (let i = 0; i < joints.length; i++) {
      skeletonJoints[i] = globalToLocal.get(joints[i])!;
    }

    const skeletonLabels = nodes.map((idx) => gltfRaw.nodes?.[idx]?.name || `node_${idx}`);

    const duplicateOf = skins.findIndex(
      (other) =>
        sameValues(other.skeletonNodes, skeletonNodes) && sameValues(other.inverseBindMatrices, inverseBindMatrices),
    );

    if (duplicateOf !== -1) {
      skinIndices.push(duplicateOf);

      continue;
    }

    skinIndices.push(skins.length);
    skins.push({
      name: skinRaw.name,
      inverseBindMatrices,
      skeletonParent,
      skeletonNodes,
      skeletonJoints,
      skeletonLabels,
      parentNode,
      bindShapeMatrix: readBindShapeMatrix(joints[0], parentNode, parentMap, descriptor.nodes, inverseBindMatrices),
    });
  }

  descriptor.skins = skins;

  if (descriptor.nodes) {
    for (const node of descriptor.nodes) {
      if (node.skin !== undefined) node.skin = skinIndices[node.skin];
    }
  }
}

/**
 * `undefined` near the identity or for a matrix with no inverse. Any other is rebuilt from its
 * position, rotation and scale, dropping shear, so a mesh given those three has exactly this matrix
 * @param joint - The skin's first joint
 * @param parentNode - Where the walk up from the joint stops
 * @param parentMap - Parent node index per node, `-1` for none
 * @param nodes - The descriptor's nodes, which hold the rest pose
 * @param inverseBindMatrices - The skin's inverse bind matrices
 */
function readBindShapeMatrix(
  joint: number | undefined,
  parentNode: number,
  parentMap: Int32Array,
  nodes: Scene3DNode[] | undefined,
  inverseBindMatrices: Float32Array,
): Float32Array | undefined {
  if (joint === undefined || !nodes) return undefined;

  _jointRest.identity();

  for (let curr = joint; curr !== -1 && curr !== parentNode; curr = parentMap[curr]) {
    const node = nodes[curr];

    if (!node) continue;

    if (node.position) _position.fromArray(node.position);
    else _position.set(0, 0, 0);

    if (node.rotation) _quaternion.fromArray(node.rotation);
    else _quaternion.set(0, 0, 0, 1);

    _jointRest.premultiply(
      _nodeLocal.compose(_position, _quaternion, node.scale ? _scale.fromArray(node.scale) : _unitScale),
    );
  }

  _jointRest.multiply(_inverseBind.fromArray(inverseBindMatrices));

  const elements = _jointRest.elements;
  let isIdentity = true;

  for (let i = 0; i < 16 && isIdentity; i++) {
    isIdentity = Math.abs(elements[i] - (i % 5 === 0 ? 1 : 0)) < BIND_SHAPE_TOLERANCE;
  }

  if (isIdentity) return undefined;

  const determinant = _jointRest.determinant();

  if (determinant === 0 || !Number.isFinite(determinant)) return undefined;

  _jointRest.decompose(_position, _quaternion, _scale);
  _jointRest.compose(_position, _quaternion, _scale);

  return new Float32Array(_jointRest.elements);
}

function sameValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;

  return true;
}

function buildParentMap(nodes?: { children?: number[] }[]): Int32Array {
  const map = new Int32Array(nodes?.length || 0).fill(-1);

  nodes?.forEach((node, parentIndex) => {
    node.children?.forEach((childIndex) => {
      map[childIndex] = parentIndex;
    });
  });

  return map;
}

/**
 * Seeds the cache with `false` before recursing, so a cyclic hierarchy terminates
 * @param nodes - The glTF node list
 * @param index - The subtree's root node
 * @param cache - Results by node index, shared across skins
 */
function subtreeHasMesh(nodes: GltfFormat['nodes'], index: number, cache: Map<number, boolean>): boolean {
  const cached = cache.get(index);
  if (cached !== undefined) return cached;

  cache.set(index, false);

  const node = nodes?.[index];
  let result = node?.mesh !== undefined;

  if (!result && node?.children) {
    for (const child of node.children) {
      if (subtreeHasMesh(nodes, child, cache)) {
        result = true;
        break;
      }
    }
  }

  cache.set(index, result);

  return result;
}

/**
 * The lowest node above every joint, or `-1` for none
 * @param joints - The skin's joint node indices
 * @param parentMap - Parent node index per node, `-1` for none
 */
function findParentNode(joints: number[], parentMap: Int32Array): number {
  const jointSet = new Set(joints);

  let common: number[] | undefined;

  for (const joint of joints) {
    const parent = parentMap[joint];

    if (jointSet.has(parent)) continue;

    const chain: number[] = [];

    for (let curr = parent; curr !== -1; curr = parentMap[curr]) chain.push(curr);

    common = common ? common.filter((node) => chain.includes(node)) : chain;

    if (!common.length) return -1;
  }

  return common?.[0] ?? -1;
}

/**
 * Moves a skin's parent node above every joint and skinned mesh on its way to the root, as
 * `Model3D` builds neither in place
 * @param parentNode - The skin's parent node, `-1` for the root
 * @param parentMap - Parent node index per node, `-1` for none
 * @param gltfNodes - The glTF node list
 * @param nodes - The descriptor's nodes, with the joints found so far marked
 */
function liftParentNode(
  parentNode: number,
  parentMap: Int32Array,
  gltfNodes: GltfFormat['nodes'],
  nodes: Scene3DNode[] | undefined,
): number {
  let lifted = parentNode;

  for (let curr = parentNode; curr !== -1; curr = parentMap[curr]) {
    const nodeRaw = gltfNodes?.[curr];
    const isSkinnedMesh = nodeRaw?.mesh !== undefined && nodeRaw.skin !== undefined;

    if (isSkinnedMesh || nodes?.[curr]?.isJoint) lifted = parentMap[curr];
  }

  return lifted;
}

/**
 * The joints plus their ancestors below `parentNode`, parents first, as `Skeleton` requires
 * @param joints - The skin's joint node indices
 * @param parentNode - The skin's parent node, `-1` for the root
 * @param parentMap - Parent node index per node, `-1` for none
 */
function collectSkeletonNodes(joints: number[], parentNode: number, parentMap: Int32Array): number[] {
  const nodeSet = new Set<number>();

  for (const joint of joints) {
    let curr = joint;

    while (curr !== -1 && curr !== parentNode && !nodeSet.has(curr)) {
      nodeSet.add(curr);
      curr = parentMap[curr];
    }
  }

  const depthCache = new Map<number, number>();
  const getDepth = (idx: number): number => {
    if (depthCache.has(idx)) return depthCache.get(idx)!;
    let d = 0,
      p = idx;

    while (p !== -1) {
      d++;
      p = parentMap[p];
    }
    depthCache.set(idx, d);

    return d;
  };

  return Array.from(nodeSet).sort((a, b) => getDepth(a) - getDepth(b));
}
