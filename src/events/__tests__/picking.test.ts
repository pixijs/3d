import { Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import type { Pointer3DEvent } from '~/events/Pointer3DEvent';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector2 } from '~/math/vector/Vector2';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);

// A cube centred at origin, 2×2×2 by default so each face sits one unit from the centre;
// `halfExtent` scales it.
function makeCube(halfExtent = 1): Mesh3D {
  const positions = new Float32Array([
    -1,
    -1,
    -1,
    1,
    -1,
    -1,
    1,
    1,
    -1,
    -1,
    1,
    -1, // back
    -1,
    -1,
    1,
    1,
    -1,
    1,
    1,
    1,
    1,
    -1,
    1,
    1, // front
  ]);
  const indices = new Uint16Array([
    0,
    1,
    2,
    0,
    2,
    3, // back
    4,
    6,
    5,
    4,
    7,
    6, // front
    0,
    4,
    5,
    0,
    5,
    1, // bottom
    2,
    6,
    7,
    2,
    7,
    3, // top
    1,
    5,
    6,
    1,
    6,
    2, // right
    0,
    3,
    7,
    0,
    7,
    4, // left
  ]);
  if (halfExtent !== 1) {
    for (let i = 0; i < positions.length; i++) positions[i] *= halfExtent;
  }
  const geometry = new Geometry3D({
    positions,
    indices,
    bounds3D: new Box(
      new Vector3(-halfExtent, -halfExtent, -halfExtent),
      new Vector3(halfExtent, halfExtent, halfExtent),
    ),
  });
  return new Mesh3D({ geometry, material: new Material3D({}) });
}

// Run the transform pass + camera projection so worldTransform / viewProjection
// reflect the current scene state. These tests sit outside the render loop.
function tickPick(view3d: View3D): void {
  view3d.camera.localTransform.compose(view3d.camera.position, view3d.camera.quaternion, view3d.camera.scale);
  view3d.camera.worldTransform.copyFrom(view3d.camera.localTransform);
  updateCameraProjectionForView(view3d, view3d.camera, SCREEN, { x: 0, y: 0 });
  updateView3DTransforms(view3d);
}

describe('Container3D.eventMode — interactive list maintenance', () => {
  test('setting eventMode static on an attached node pushes it onto the View3D list', () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    view3d.root.addChild(cube);

    expect(view3d.events._interactiveList).not.toContain(cube);
    cube.eventMode = 'static';
    expect(view3d.events._interactiveList).toContain(cube);
  });

  test('setting eventMode back to passive removes the node from the list', () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    view3d.root.addChild(cube);
    cube.eventMode = 'static';

    cube.eventMode = 'passive';

    expect(view3d.events._interactiveList).not.toContain(cube);
  });

  test('an interactive node picks up the list when parented in', () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    // Made interactive before attaching to any View3D — list is empty.
    cube.interactive = true;
    expect(view3d.events._interactiveList).not.toContain(cube);

    view3d.root.addChild(cube);

    expect(view3d.events._interactiveList).toContain(cube);
  });

  test('removeChild detaches and removes from the list', () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    view3d.root.addChild(cube);
    cube.interactive = true;

    view3d.root.removeChild(cube);

    expect(view3d.events._interactiveList).not.toContain(cube);
  });

  test('two transitions on the same node do not duplicate in the list', () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    view3d.root.addChild(cube);

    cube.eventMode = 'static';
    cube.eventMode = 'dynamic'; // still interactive — no list churn

    expect(view3d.events._interactiveList.filter((n) => n === cube)).toHaveLength(1);
  });

  test('removing a node swap-fills its slot, and every remaining entry still indexes itself', () => {
    const view3d = new View3D({ ...SIZE });
    const cubes = [makeCube(), makeCube(), makeCube(), makeCube()];
    for (const cube of cubes) {
      view3d.root.addChild(cube);
      cube.interactive = true;
    }
    const list = view3d.events._interactiveList;

    cubes[1].interactive = false;

    expect(list).toHaveLength(3);
    expect(list).not.toContain(cubes[1]);
    expect(cubes[1]._pickIndex).toBe(-1);
    for (const node of list) expect(list[node._pickIndex], `slot ${node._pickIndex}`).toBe(node);

    // Re-registering appends at the tail; removing the tail needs no swap.
    cubes[1].interactive = true;
    expect(list[cubes[1]._pickIndex]).toBe(cubes[1]);
    cubes[1].interactive = false;
    expect(list).toHaveLength(3);
    for (const node of list) expect(list[node._pickIndex], `slot ${node._pickIndex}`).toBe(node);
  });

  test('hitVolume alone is inert — eventMode is the opt-in (2D hitArea parity)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.hitVolume = 'geometry'; // shape set, but the node was never made interactive
    view3d.root.addChild(cube);
    tickPick(view3d);

    expect(view3d.events._interactiveList).not.toContain(cube);
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });
});

describe('Mesh3D geometry swap — string hitVolumes follow the new geometry', () => {
  // Camera at z=10 looking at the origin: view-local (31, 50) is world x ≈ -2.2 at z=0 — outside the
  // default 2×2×2 cube, inside a 6×6×6 one.
  const OFF_SMALL_CUBE = { x: 31, y: 50 };

  function makeSwapScene(hitVolume: 'box' | 'geometry') {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const mesh = makeCube();
    mesh.interactive = true;
    mesh.hitVolume = hitVolume;
    view3d.root.addChild(mesh);
    tickPick(view3d);
    expect(view3d.raycast(OFF_SMALL_CUBE)).toBeNull();
    return { view3d, mesh };
  }

  test("'geometry' re-resolves to the new geometry, so its triangles are picked", () => {
    const { view3d, mesh } = makeSwapScene('geometry');

    mesh.geometry = makeCube(3).geometry;

    expect(mesh._hitVolumeResolved).toBe(mesh.geometry);
    expect(view3d.raycast(OFF_SMALL_CUBE)?.target).toBe(mesh);
  });

  test("'box' re-resolves to the new geometry's bounds3D", () => {
    const { view3d, mesh } = makeSwapScene('box');

    mesh.geometry = makeCube(3).geometry;

    expect(mesh._hitVolumeResolved).toBe(mesh.geometry.bounds3D);
    expect(view3d.raycast(OFF_SMALL_CUBE)?.target).toBe(mesh);
  });

  test('an explicit shape is untouched by a swap', () => {
    const view3d = new View3D({ ...SIZE });
    const mesh = makeCube();
    const sphere = new Sphere(new Vector3(), 0.5);
    mesh.interactive = true;
    mesh.hitVolume = sphere;
    view3d.root.addChild(mesh);

    mesh.geometry = makeCube(3).geometry;

    expect(mesh._hitVolumeResolved).toBe(sphere);
  });
});

describe('View3D.raycast — basic ray casts', () => {
  test('picks the closer of two cubes along the camera ray', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const near = makeCube();
    near.position.set(0, 0, 0);
    near.interactive = true;

    const far = makeCube();
    far.position.set(0, 0, -5);
    far.interactive = true;

    view3d.root.addChild(near);
    view3d.root.addChild(far);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(near);
  });

  test('returns null on viewport miss (no interactive nodes under the ray)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const cube = makeCube();
    cube.position.set(20, 0, 0); // far off-axis
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).toBeNull();
  });

  test("picks the 'geometry' volume on a Mesh3D (per-triangle path)", () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const cube = makeCube();
    cube.interactive = true;
    cube.hitVolume = 'geometry';
    view3d.root.addChild(cube);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(cube);
    // Geometry hits carry surface data — normal should be non-zero.
    const n = hit!.normal;
    expect(n.x * n.x + n.y * n.y + n.z * n.z).toBeGreaterThan(0.5);
  });

  test('interactiveChildren = false on an ancestor prunes the subtree', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const group = new Container3D();
    const cube = makeCube();
    cube.interactive = true;
    group.addChild(cube);
    view3d.root.addChild(group);
    tickPick(view3d);

    // Baseline: the pick lands before the subtree is pruned.
    expect(view3d.raycast({ x: 50, y: 50 })).not.toBeNull();

    group.interactiveChildren = false;

    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });
});

describe('View3D — propagation on a 3D hit', () => {
  test('pointerdown emitted via raycast-equivalent ray fires on mesh then bubbles to root3D', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    // 2D parity: passive ancestors don't fire bubbled listeners.
    view3d.root.eventMode = 'static';
    const order: string[] = [];
    cube.on('pointerdown', () => order.push('mesh'));
    view3d.root.on('pointerdown', () => order.push('root'));

    // Hit test first, the way Pixi does before every dispatch.
    view3d.containsPoint({ x: 50, y: 50 });
    expect(view3d.events._currentPick3D).toBe(cube);

    // Simulate a high-level emit on view3d as Pixi would do at AT_TARGET.
    const evt = { type: 'pointerdown', target: view3d, currentTarget: view3d, propagationStopped: false } as never;
    view3d.emit('pointerdown', evt);

    expect(order).toEqual(['mesh', 'root']);
  });

  test('stopPropagation on the mesh halts the 3D-chain walk before reaching root3D', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    view3d.root.eventMode = 'static';
    const order: string[] = [];
    cube.on('pointerdown', (e: { propagationStopped: boolean }) => {
      order.push('mesh');
      e.propagationStopped = true;
    });
    view3d.root.on('pointerdown', () => order.push('root'));

    view3d.containsPoint({ x: 50, y: 50 });
    const evt = { type: 'pointerdown', target: view3d, currentTarget: view3d, propagationStopped: false } as never;
    view3d.emit('pointerdown', evt);

    expect(order).toEqual(['mesh']);
  });
});

// A single triangle whose local geometric normal (e1 × e2) is ∝ (0, -1, 2),
// chosen so a non-uniform scale separates the inverse-transpose normal from a
// naive upper-3x3 transform.
function makeTriangleMesh(): Mesh3D {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const geometry = new Geometry3D({
    positions,
    indices,
    bounds3D: new Box(new Vector3(-1, -1, 0), new Vector3(1, 1, 1)),
  });
  return new Mesh3D({ geometry, material: new Material3D({}) });
}

// Minimal stand-in for a pooled FederatedPointerEvent — the dispatcher only
// reads `type` and the propagation flags and writes the 3D fields onto it.
function makeEvent(type: string): FederatedPointerEvent {
  return {
    type,
    target: null,
    currentTarget: null,
    propagationStopped: false,
    propagationImmediatelyStopped: false,
  } as unknown as FederatedPointerEvent;
}

describe('View3D.raycast — depth sort & distance in world space (C2)', () => {
  test('picks the closer node even when it is smaller-scaled', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    // Closer to the camera in world space, but the small scale inflates its
    // local-space `t`, so a depth sort in local units would rank it behind.
    const small = makeCube();
    small.position.set(0, 0, 5);
    small.scale.set(0.1, 0.1, 0.1);
    small.interactive = true;

    const big = makeCube();
    big.position.set(0, 0, 0);
    big.interactive = true;

    view3d.root.addChild(small);
    view3d.root.addChild(big);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(small);
    // Front face at z = 5.1, camera at z = 10 → world distance 4.9, not local 49.
    expect(hit!.distance).toBeCloseTo(4.9, 2);
  });

  test('reports distance in world units for a scaled node', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const cube = makeCube();
    cube.scale.set(2, 2, 2);
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    // Front face at z = 2 → distance 8, not the local-units 4.
    expect(hit!.distance).toBeCloseTo(8, 2);
    expect(hit!.point.z).toBeCloseTo(2, 2);
    // The local point stays in the node's own units.
    expect(hit!.localPoint.z).toBeCloseTo(1, 2);
  });
});

describe('View3D.raycast — triangleIndex from the winning node (C3)', () => {
  test('returns the winner triangleIndex, not the last node tested', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    // Winner: a Box volume (triangleIndex -1). The farther Geometry volume is
    // added second so it is iterated last and overwrites the shared scratch.
    const near = makeCube();
    near.position.set(0, 0, 3);
    near.interactive = true;

    const far = makeCube();
    far.position.set(0, 0, -3);
    far.interactive = true;
    far.hitVolume = 'geometry';

    view3d.root.addChild(near);
    view3d.root.addChild(far);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(near);
    expect(hit!.triangleIndex).toBe(-1);
  });
});

describe('View3D — Pointer3D event fields (C4 / C5 / F2)', () => {
  test('hit3D is owned per-event and survives a later pick (C4)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    view3d.containsPoint({ x: 50, y: 50 });
    const evtA = makeEvent('pointerdown');
    view3d.emit('pointerdown', evtA);
    const pA = (evtA as Pointer3DEvent).hit3D!.point;
    const ax = pA.x;
    const ay = pA.y;

    // Off-centre but still on the cube (its projection spans ~viewport 40–60).
    view3d.containsPoint({ x: 44, y: 44 });
    const evtB = makeEvent('pointerdown');
    view3d.emit('pointerdown', evtB);
    const pB = (evtB as Pointer3DEvent).hit3D!.point;

    expect(pA).not.toBe(pB); // distinct owned vectors, not the shared View scratch
    expect(pA.x).toBeCloseTo(ax, 6); // unchanged by the second pick
    expect(pA.y).toBeCloseTo(ay, 6);
    expect(Math.abs(pB.x)).toBeGreaterThan(0.01); // the second pick really hit elsewhere
  });

  test('pointerover carries target3D / hit3D and the right type (C5)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    let overTarget: unknown = 'unset';
    let overType = '';
    let overPointZ = Number.NaN;
    cube.on('pointerover', (e: Pointer3DEvent) => {
      overTarget = e.target3D;
      overType = e.type;
      overPointZ = e.hit3D?.point.z ?? Number.NaN;
    });

    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointermove', makeEvent('pointermove'));

    expect(overTarget).toBe(cube);
    expect(overType).toBe('pointerover');
    expect(overPointZ).toBeCloseTo(1, 2);
  });

  test('raycast returns uv as a Vector2 (F2)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    cube.hitVolume = 'geometry';
    view3d.root.addChild(cube);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.uv).toBeInstanceOf(Vector2);
  });
});

describe('View3D — surface normal under non-uniform scale (C6)', () => {
  test('world normal uses the inverse-transpose, not the raw world matrix', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const tri = makeTriangleMesh();
    tri.scale.set(1, 3, 1);
    tri.interactive = true;
    tri.hitVolume = 'geometry';
    view3d.root.addChild(tri);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();

    // Local normal ∝ (0, -1, 2); inverse-transpose of scale (1,3,1) is
    // diag(1, 1/3, 1) → world normal ∝ (0, -1/3, 2), ratio z/y = -6.
    // A naive upper-3x3 transform would give (0, -3, 2), ratio ≈ -0.667.
    const n = hit!.normal;
    expect(n.x).toBeCloseTo(0, 4);
    expect(n.z / n.y).toBeCloseTo(-6, 1);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 4);
  });
});

describe('View3D — hover/press lifecycle (C7 / C10)', () => {
  test('detaching a hovered node clears pick state silently — no pointer events on removeChild (C7)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointermove', makeEvent('pointermove'));

    let outFired = false;
    cube.on('pointerout', () => {
      outFired = true;
    });

    view3d.root.removeChild(cube);

    // removeChild must not dispatch pointer events as a side effect.
    expect(outFired).toBe(false);
    // Hover state goes with it: no stale list entry, and a fresh pick over the
    // now-empty centre misses.
    expect(view3d.events._interactiveList).not.toContain(cube);
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });

  test('*upoutside routes to the pressed node after the pointer leaves the viewport (C10)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    let upFired = false;
    cube.on('pointerupoutside', () => {
      upFired = true;
    });

    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(view3d.containsPoint({ x: -10, y: -10 })).toBe(false);

    view3d.emit('pointerupoutside', makeEvent('pointerupoutside'));

    expect(upFired).toBe(true);
  });
});

describe('View3D.raycast — plain Container3D box volume (C11)', () => {
  test('a plain container with children resolves a non-empty box and registers hits', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const group = new Container3D();
    const cube = makeCube();
    group.addChild(cube);
    view3d.root.addChild(group);
    tickPick(view3d);

    group.eventMode = 'static';
    group.hitVolume = 'box';
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(group);
  });
});

describe('View3D.raycast — broadphase sphere reject stays conservative', () => {
  test('an off-centre hit volume is not wrongly culled (radius inflated by centre offset)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    // Volume sits 3 units up in local space; the node is moved 3 units down so
    // the volume lands on the central ray. The broadphase centre (the node's
    // world translation) is 3 units off the volume — only a radius inflated by
    // the centre offset keeps it from being wrongly rejected.
    const node = makeCube();
    node.position.set(0, -3, 0);
    node.interactive = true;
    node.hitVolume = new Sphere(new Vector3(0, 3, 0), 0.5);
    view3d.root.addChild(node);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(node);
  });

  test('a scaled node is not wrongly culled (broadphase radius scales with the node)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    // Off-axis and scaled up so the volume reaches the central ray only because
    // of the scale. The broadphase radius must include the max axis scale, or
    // the unscaled radius would cull the node before the exact test.
    const node = makeCube();
    node.position.set(3, 0, 0);
    node.scale.set(4, 4, 4);
    node.interactive = true;
    view3d.root.addChild(node);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(node);
  });

  test('world scale bound stays conservative under shear (ancestor non-uniform scale + child rotation)', () => {
    const view3d = new View3D({ ...SIZE });
    const parent = new Container3D();
    parent.scale.set(3, 1, 1);
    const child = new Container3D();
    child.rotation.set(0, 0, Math.PI / 4);
    child.eventMode = 'static';
    child.hitVolume = new Sphere(new Vector3(0, 0, 0), 1);
    parent.addChild(child);
    view3d.root.addChild(parent);
    tickPick(view3d);

    // True max stretch of diag(3,1,1)·Rz(45°) is 3 (squared: 9); max column
    // length (the naive bound) is only sqrt(5) ≈ 2.236, which would cull real
    // hits in the over-stretched lobe. The singular-value bound must cover the
    // true stretch.
    expect(child._getWorldScaleSq()).toBeCloseTo(9, 3);
    expect(child.worldTransform.getMaxScaleOnAxis()).toBeLessThan(3);
  });

  test('a sheared interactive node is still pickable', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const parent = new Container3D();
    parent.scale.set(3, 1, 1);
    const child = new Container3D();
    child.rotation.set(0, 0, Math.PI / 4);
    child.eventMode = 'static';
    child.hitVolume = new Sphere(new Vector3(0, 0, 0), 1);
    parent.addChild(child);
    view3d.root.addChild(parent);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 }); // central ray through the volume centre
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(child);
  });

  test('mutating a hit volume in place is reflected by the broadphase (no stale cull)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const node = new Container3D();
    node.position.set(2, 0, 0);
    const box = new Box(new Vector3(-0.1, -0.1, -0.1), new Vector3(0.1, 0.1, 0.1));
    node.eventMode = 'static';
    node.hitVolume = box;
    view3d.root.addChild(node);
    tickPick(view3d);

    // Small box off to the side — the central ray misses.
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();

    // Grow the box in place toward the ray (no hitVolume re-assignment, node
    // does not move). The broadphase must see the new extent live, not a
    // stale set-time snapshot.
    box.set(new Vector3(-3, -0.1, -0.1), new Vector3(0.1, 0.1, 0.1));

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(node);
  });

  test('a negative-radius (empty) sphere volume resolves to no shape — the node is non-hittable', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const node = new Container3D();
    node.eventMode = 'static';
    node.hitVolume = new Sphere(new Vector3(0, 0, 0)); // default radius -1 → empty
    view3d.root.addChild(node);
    tickPick(view3d);

    // Resolves to null (with a warning); a plain container has no default
    // shape to fall back to, so the pick misses.
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });
});

describe('View3D — pick caches track transform changes (C8 / P1)', () => {
  test('moving a node refreshes its cached inverse-world (pick follows the node)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);
    expect(view3d.raycast({ x: 50, y: 50 })).not.toBeNull();

    cube.position.set(20, 0, 0);
    tickPick(view3d);

    // A stale cached inverse would still hit the cube at the origin.
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });

  test('moving the camera refreshes the pick ray (P1)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);
    expect(view3d.raycast({ x: 50, y: 50 })).not.toBeNull();

    // Sidestep the camera: a stale ray would still fire through the cube.
    view3d.camera.position.set(20, 0, 10);
    tickPick(view3d);
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });
});

describe('View3D.raycast — visibility', () => {
  test('a hidden node is not pickable', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    cube.visible = false;
    tickPick(view3d);

    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });

  test('a hidden node does not occlude a visible node behind it', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const near = makeCube();
    near.position.set(0, 0, 3);
    near.interactive = true;
    near.visible = false;

    const far = makeCube();
    far.position.set(0, 0, -3);
    far.interactive = true;

    view3d.root.addChild(near);
    view3d.root.addChild(far);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(far);
  });

  test('hiding an ancestor hides the whole subtree from picking', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const group = new Container3D();
    const cube = makeCube();
    cube.interactive = true;
    group.addChild(cube);
    view3d.root.addChild(group);
    group.visible = false;
    tickPick(view3d);

    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });

  test('re-showing a node restores pickability', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    cube.visible = false;
    tickPick(view3d);
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();

    cube.visible = true;
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(cube);
  });
});

describe('View3D — hover flush on pointerout (pointer left the view)', () => {
  test('pointerout on the view emits pointerout on the hovered node and resets hover', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    // Hover the cube the way Pixi would: hit test, then dispatch the move.
    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointermove', makeEvent('pointermove'));

    let outTarget: Container3D | null = null;
    let overCount = 0;
    cube.on('pointerout', (e: Pointer3DEvent) => {
      outTarget = e.target3D;
    });
    cube.on('pointerover', () => overCount++);

    // Pixi dispatches `pointerout` on the View when the pointer moves off it
    // (onto another 2D element or out of the canvas) — no re-hit-test follows.
    view3d.emit('pointerout', makeEvent('pointerout'));
    expect(outTarget).toBe(cube);

    // Hover state was flushed: re-entering the cube fires a fresh pointerover.
    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(overCount).toBe(1);
  });

  test('pointerout with nothing hovered is a no-op that still defines the 3D miss fields', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    tickPick(view3d);

    const evt = makeEvent('pointerout');
    view3d.emit('pointerout', evt);

    expect((evt as Pointer3DEvent).target3D).toBeNull();
    expect((evt as Pointer3DEvent).hit3D).toBeNull();
  });

  test('pointerout keeps the pressed node — a later *upoutside still routes to it', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    let upOutsideFired = false;
    cube.on('pointerupoutside', () => {
      upOutsideFired = true;
    });

    // Press the cube, drag off the canvas (pointerout), then release outside.
    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    view3d.emit('pointerout', makeEvent('pointerout'));
    view3d.emit('pointerupoutside', makeEvent('pointerupoutside'));

    expect(upOutsideFired).toBe(true);
  });
});

describe('View3D — eventMode / interactive (2D parity)', () => {
  test('an interactive mesh with no hitVolume picks via its live geometry AABB', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true; // no hitVolume set
    view3d.root.addChild(cube);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(cube);
    expect(hit!.point.z).toBeCloseTo(1, 2); // front face of the AABB
  });

  test("interactive sugar maps to 'static' / 'passive' and reads 'dynamic' as true", () => {
    const cube = makeCube();
    expect(cube.eventMode).toBe('passive');
    expect(cube.interactive).toBe(false);

    cube.interactive = true;
    expect(cube.eventMode).toBe('static');

    cube.eventMode = 'dynamic';
    expect(cube.interactive).toBe(true);

    cube.interactive = false;
    expect(cube.eventMode).toBe('passive');
  });

  test("eventMode 'none' on an ancestor prunes the subtree", () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const group = new Container3D();
    const cube = makeCube();
    cube.interactive = true;
    group.addChild(cube);
    view3d.root.addChild(group);
    tickPick(view3d);

    expect(view3d.raycast({ x: 50, y: 50 })).not.toBeNull();

    group.eventMode = 'none';
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });

  test('bubbled 3D events skip passive ancestors and fire on interactive ones (notifyTarget parity)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const group = new Container3D(); // stays passive
    const cube = makeCube();
    cube.interactive = true;
    group.addChild(cube);
    view3d.root.addChild(group);
    view3d.root.eventMode = 'static';
    tickPick(view3d);

    const order: string[] = [];
    cube.on('pointerdown', () => order.push('mesh'));
    group.on('pointerdown', () => order.push('group'));
    view3d.root.on('pointerdown', () => order.push('root'));

    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    // The passive group is walked but silent; the interactive root still hears it.
    expect(order).toEqual(['mesh', 'root']);
  });

  test("a 'dynamic' 3D node upgrades the View3D to dynamic and back", () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    view3d.root.addChild(cube);
    expect(view3d.eventMode).toBe('static');

    cube.eventMode = 'dynamic';
    expect(view3d.eventMode).toBe('dynamic');

    cube.eventMode = 'static';
    expect(view3d.eventMode).toBe('static');

    // Detach accounting: removing the dynamic node downgrades the View again.
    cube.eventMode = 'dynamic';
    expect(view3d.eventMode).toBe('dynamic');
    view3d.root.removeChild(cube);
    expect(view3d.eventMode).toBe('static');
  });

  test('a plain interactive container without hitVolume is bubble-only (not directly pickable)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const group = new Container3D();
    group.interactive = true; // no shape — 2D Container parity
    const cube = makeCube();
    cube.interactive = true;
    group.addChild(cube);
    view3d.root.addChild(group);
    tickPick(view3d);

    // The mesh wins the pick (the group has no shape of its own)...
    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(cube);

    // ...and the group hears it by bubbling.
    let groupHeard = false;
    group.on('pointerdown', () => {
      groupHeard = true;
    });
    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    expect(groupHeard).toBe(true);
  });
});

describe('View3D — cursor forwarding', () => {
  test('writing view3d.cursor does not shadow the getter — hovered-node cursor still wins', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    cube.cursor = 'pointer';
    view3d.root.addChild(cube);
    tickPick(view3d);

    // A plain assignment must not plant an own `cursor` data property that
    // would bypass the accessor pair on the prototype from then on.
    view3d.cursor = 'grab';

    // Hovering the cube: its cursor flows through the getter.
    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(view3d.cursor).toBe('pointer');

    // Empty viewport: falls back to the view's own cursor.
    view3d.containsPoint({ x: 2, y: 2 });
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(view3d.cursor).toBe('grab');
  });
});

describe('View3D.raycast — render-path camera updates refresh the pick ray', () => {
  // The render pipes refresh the camera each frame through the shared
  // updateCameraProjectionForView function, so a pick after an orbit has to see the
  // rotated view through that path.
  test('a pick after the render pass rotates the camera uses the fresh view', () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);

    const screen = new Rectangle(0, 0, SIZE.width, SIZE.height);
    const tickRender = () => {
      const cam = view3d.camera;
      cam.localTransform.compose(cam.position, cam.quaternion, cam.scale);
      cam.worldTransform.copyFrom(cam.localTransform);
      updateCameraProjectionForView(view3d, view3d.camera, screen, { x: 0, y: 0 });
      updateView3DTransforms(view3d);
    };

    view3d.camera.position.set(0, 0, 10);
    tickRender();
    const front = view3d.raycast({ x: 50, y: 50 });
    expect(front).not.toBeNull();
    expect(front!.point.z).toBeCloseTo(1, 5);

    // Orbit 90°: camera on +X looking back at the origin.
    view3d.camera.position.set(10, 0, 0);
    view3d.camera.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    tickRender();

    const side = view3d.raycast({ x: 50, y: 50 });
    expect(side).not.toBeNull();
    expect(side!.point.x).toBeCloseTo(1, 5);
  });
});
