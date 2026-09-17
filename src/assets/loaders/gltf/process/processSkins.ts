import type { Scene3DDescriptor, Scene3DSkin } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';
import { getBuffer } from '../utils/getBuffer';

/**
 * Converts glTF skins into descriptor skin entries with a topologically sorted skeleton layout
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers holding the inverse bind matrices
 * @param descriptor - Receives the skins; its nodes that are purely skeletal get marked as joints
 * @internal
 */
export function processSkins(gltfRaw: GltfFormat, buffers: ArrayBuffer[], descriptor: Scene3DDescriptor): void {
  if (!gltfRaw.skins) {
    descriptor.skins = [];

    return;
  }

  // 1. Invert hierarchy: Child -> Parent mapping
  const parentMap = buildParentMap(gltfRaw.nodes);

  // Memoised "does this node's subtree contain a renderable mesh?" — used to
  // decide which collected skeleton nodes may be removed from the scene graph.
  const meshSubtreeCache = new Map<number, boolean>();

  descriptor.skins = gltfRaw.skins.map((skinRaw) => {
    const inverseBindMatrices = getBuffer(gltfRaw, buffers, skinRaw.inverseBindMatrices!);
    const joints = skinRaw.joints;
    const skeletonRoot = skinRaw.skeleton ?? -1;

    // 2. Collect & Sort Nodes (Topologically)
    // We combine collection and sorting to avoid redundant traversals
    const nodes = collectSkeletonNodes(joints, skeletonRoot, parentMap);

    // 3. Build Lookups
    const globalToLocal = new Map<number, number>();

    nodes.forEach((globalIdx, localIdx) => globalToLocal.set(globalIdx, localIdx));

    // 4. Build Structure Arrays
    const nodeCount = nodes.length;
    const skeletonParent = new Int16Array(nodeCount);
    const skeletonNodes = new Int32Array(nodeCount);

    for (let i = 0; i < nodeCount; i++) {
      const globalIdx = nodes[i];
      const globalParent = parentMap[globalIdx];

      skeletonNodes[i] = globalIdx;
      // Map parent to local index, or -1 if parent is outside this skeleton
      const localParent = globalToLocal.get(globalParent);

      skeletonParent[i] = localParent !== undefined ? localParent : -1;
    }

    // 5. Map Joints
    const skeletonJoints = new Int16Array(joints.length);

    for (let i = 0; i < joints.length; i++) {
      skeletonJoints[i] = globalToLocal.get(joints[i])!;
    }

    // 6. Mark Model nodes.
    // `collectSkeletonNodes` walks each joint up to the skin's `skeleton` root —
    // or, when that is absent (e.g. UnityGLTF exports), all the way to the scene
    // root, sweeping in shared group nodes (the up-axis rotation, frame offsets)
    // that also parent visible geometry. `Model3D` drops the transform of
    // any `isJoint` node, so only mark nodes whose subtree is purely skeletal —
    // a node that anchors a renderable mesh must stay in the scene graph.
    if (descriptor.nodes) {
      for (const globalIdx of nodes) {
        if (subtreeHasMesh(gltfRaw.nodes, globalIdx, meshSubtreeCache)) continue;

        const node = descriptor.nodes[globalIdx];

        if (node) node.isJoint = true;
      }
    }

    const skeletonLabels = nodes.map((idx) => gltfRaw.nodes?.[idx]?.name || `node_${idx}`);

    return {
      name: skinRaw.name,
      inverseBindMatrices,
      skeletonParent,
      skeletonNodes,
      skeletonJoints,
      skeletonLabels,
      skeletonToModelRoot: skinRaw.skeleton === undefined,
    } as Scene3DSkin;
  });
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
 * Whether `index`'s glTF subtree (itself or any descendant) references a mesh
 *
 * Memoised across skins. Cycle-safe: the cache is seeded `false` before
 * recursing so a malformed cyclic hierarchy terminates.
 * @param nodes - The glTF node list
 * @param index - Index of the subtree's root node
 * @param cache - Results keyed by node index, shared across skins
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

function collectSkeletonNodes(joints: number[], root: number, parentMap: Int32Array): number[] {
  const nodeSet = new Set<number>();

  // Collect ancestors
  for (const joint of joints) {
    let curr = joint;

    while (curr !== -1 && curr !== root && !nodeSet.has(curr)) {
      nodeSet.add(curr);
      curr = parentMap[curr];
    }
    if (curr === root && curr !== -1) nodeSet.add(curr);
  }

  // Sort by depth (Topological sort)
  // Optimization: Calculate depth ONCE per node
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
