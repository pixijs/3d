import { Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { createRaycastHit3D } from '~/events/HitResult3D';
import type { Pointer3DEvent } from '~/events/Pointer3DEvent';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);

function makeCube(halfExtent = 1): Mesh3D {
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 2, 6, 7, 2, 7, 3, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4,
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

function tickPick(view3d: View3D): void {
  view3d.camera.localTransform.compose(view3d.camera.position, view3d.camera.quaternion, view3d.camera.scale);
  view3d.camera.worldTransform.copyFrom(view3d.camera.localTransform);
  updateCameraProjectionForView(view3d, view3d.camera, SCREEN, { x: 0, y: 0 });
  updateView3DTransforms(view3d);
}

describe('Container3D.eventMode — interactive list maintenance', () => {
  test('removing a node swap-fills its slot, and every remaining entry still indexes itself, also after re-adding and removing the tail entry', () => {
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
    cube.hitVolume = 'geometry';
    view3d.root.addChild(cube);
    tickPick(view3d);

    expect(view3d.events._interactiveList).not.toContain(cube);
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });
});

describe('Mesh3D geometry swap — string hitVolumes follow the new geometry', () => {
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

describe('View3D — propagation on a 3D hit', () => {
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

function makeEvent(type: string): FederatedPointerEvent {
  return {
    type,
    target: null,
    currentTarget: null,
    propagationStopped: false,
    propagationImmediatelyStopped: false,
  } as unknown as FederatedPointerEvent;
}

describe('View3D.raycast — depth sort & distance in world space', () => {
  test('picks the closer node and reports its world distance, even when its small scale makes its local-space distance the larger one', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

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
    expect(hit!.distance).toBeCloseTo(4.9, 2);
  });

  test('picks a small geometry node tested after a farther hit, comparing the bounds in world units', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const big = makeCube();
    big.interactive = true;

    const small = makeCube();
    small.position.set(0, 0, 5);
    small.scale.set(0.1, 0.1, 0.1);
    small.interactive = true;
    small.hitVolume = 'geometry';

    view3d.root.addChild(big);
    view3d.root.addChild(small);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit?.target).toBe(small);
    expect(hit?.distance).toBeCloseTo(4.9, 2);
  });

  test('reports distance and point in world units for a scaled node, and localPoint in its own units', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

    const cube = makeCube();
    cube.scale.set(2, 2, 2);
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(8, 2);
    expect(hit!.point.z).toBeCloseTo(2, 2);
    expect(hit!.localPoint.z).toBeCloseTo(1, 2);
  });
});

describe('View3D.raycast — out', () => {
  function cubeView(): { view3d: View3D; cube: Mesh3D } {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);
    return { view3d, cube };
  }

  test('writes a hit into out and returns it', () => {
    const { view3d, cube } = cubeView();
    const out = createRaycastHit3D();

    expect(view3d.raycast({ x: 50, y: 50 }, out)).toBe(out);
    expect(out.target).toBe(cube);
    expect(out.distance).toBeCloseTo(9, 2);
  });

  test('leaves out untouched on a miss', () => {
    const { view3d } = cubeView();
    const out = createRaycastHit3D();
    view3d.raycast({ x: 50, y: 50 }, out);
    const { target, distance } = out;

    expect(view3d.raycast({ x: 1, y: 1 }, out)).toBeNull();
    expect(out.target).toBe(target);
    expect(out.distance).toBe(distance);
  });

  test('without out, each hit is a new object that a later pick leaves alone', () => {
    const { view3d } = cubeView();
    const first = view3d.raycast({ x: 50, y: 50 })!;
    const firstPoint = first.point.clone();

    view3d.raycast({ x: 1, y: 1 });
    const second = view3d.raycast({ x: 52, y: 52 })!;

    expect(second).not.toBe(first);
    expect(first.point.equals(firstPoint)).toBe(true);
    expect(second.point.equals(firstPoint)).toBe(false);
  });
});

describe('View3D.raycast — triangleIndex from the winning node', () => {
  test("returns the winning box hit's triangleIndex of -1, not that of a farther geometry hit tested after it", () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

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

describe('View3D — Pointer3D event fields', () => {
  test('hit3D is owned per-event and survives a later pick', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    view3d.containsPoint({ x: 50, y: 50 });
    const evtA = makeEvent('pointerdown');
    view3d.emit('pointerdown', evtA);
    const pA = evtA.hit3D!.point;
    const ax = pA.x;
    const ay = pA.y;

    const offCentreOnCube = { x: 44, y: 44 };
    view3d.containsPoint(offCentreOnCube);
    const evtB = makeEvent('pointerdown');
    view3d.emit('pointerdown', evtB);
    const pB = evtB.hit3D!.point;

    expect(pA).not.toBe(pB);
    expect(pA.x).toBeCloseTo(ax, 6);
    expect(pA.y).toBeCloseTo(ay, 6);
    expect(Math.abs(pB.x)).toBeGreaterThan(0.01);
  });

  test('pointerover carries target3D / hit3D and the right type', () => {
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
});

describe('View3D — surface normal under non-uniform scale', () => {
  test('world normal under scale (1, 3, 1) uses the inverse-transpose, giving z/y = -6 where the raw world matrix gives -2/3', () => {
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

    const n = hit!.normal;
    expect(n.x).toBeCloseTo(0, 4);
    expect(n.z / n.y).toBeCloseTo(-6, 1);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 4);
  });
});

describe('View3D — hover lifecycle', () => {
  test('detaching a hovered node unregisters it from picking without dispatching any pointer event', () => {
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

    expect(outFired).toBe(false);
    expect(view3d.events._interactiveList).not.toContain(cube);
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });
});

describe('View3D.raycast — broadphase sphere reject stays conservative', () => {
  test("a hit volume offset from its node's origin is not wrongly culled (the broadphase radius includes the offset)", () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);

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

  test('world scale bound covers the true stretch of 3 under shear, where the longest column is only √5', () => {
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

    expect(child._getWorldScaleSq()).toBeCloseTo(9, 3);
    expect(child.worldTransform.getMaxScaleOnAxis()).toBeLessThan(3);
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

    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();

    box.set(new Vector3(-3, -0.1, -0.1), new Vector3(0.1, 0.1, 0.1));

    const hit = view3d.raycast({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(node);
  });
});

describe('View3D — pick caches track transform changes', () => {
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

    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });

  test('moving the camera refreshes the pick ray', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);
    expect(view3d.raycast({ x: 50, y: 50 })).not.toBeNull();

    view3d.camera.position.set(20, 0, 10);
    tickPick(view3d);
    expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();
  });
});

describe('View3D.raycast — visibility', () => {
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
});

describe('View3D — hover flush on pointerout (pointer left the view)', () => {
  test('pointerout on the view emits pointerout on the hovered node and resets hover', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    view3d.root.addChild(cube);
    tickPick(view3d);

    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointermove', makeEvent('pointermove'));

    let outTarget: Container3D | null = null;
    let overCount = 0;
    cube.on('pointerout', (e: Pointer3DEvent) => {
      outTarget = e.target3D;
    });
    cube.on('pointerover', () => overCount++);

    view3d.emit('pointerout', makeEvent('pointerout'));
    expect(outTarget).toBe(cube);

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

    expect(evt.target3D).toBeNull();
    expect(evt.hit3D).toBeNull();
  });
});

describe('View3D — eventMode / interactive (2D parity)', () => {
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

  test('bubbled 3D events skip passive ancestors and fire on interactive ones (notifyTarget parity)', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const passiveGroup = new Container3D();
    const cube = makeCube();
    cube.interactive = true;
    passiveGroup.addChild(cube);
    view3d.root.addChild(passiveGroup);
    view3d.root.eventMode = 'static';
    tickPick(view3d);

    const order: string[] = [];
    cube.on('pointerdown', () => order.push('mesh'));
    passiveGroup.on('pointerdown', () => order.push('group'));
    view3d.root.on('pointerdown', () => order.push('root'));

    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(order).toEqual(['mesh', 'root']);
  });

  test("a 'dynamic' 3D node upgrades the View3D to dynamic, and switching it to static or detaching it downgrades the View", () => {
    const view3d = new View3D({ ...SIZE });
    const cube = makeCube();
    view3d.root.addChild(cube);
    expect(view3d.eventMode).toBe('static');

    cube.eventMode = 'dynamic';
    expect(view3d.eventMode).toBe('dynamic');

    cube.eventMode = 'static';
    expect(view3d.eventMode).toBe('static');

    cube.eventMode = 'dynamic';
    expect(view3d.eventMode).toBe('dynamic');
    view3d.root.removeChild(cube);
    expect(view3d.eventMode).toBe('static');
  });
});

describe('View3D — cursor forwarding', () => {
  test("writing view3d.cursor does not shadow the getter: the hovered node's cursor wins, and empty viewport shows the written one", () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    const cube = makeCube();
    cube.interactive = true;
    cube.cursor = 'pointer';
    view3d.root.addChild(cube);
    tickPick(view3d);

    view3d.cursor = 'grab';

    view3d.containsPoint({ x: 50, y: 50 });
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(view3d.cursor).toBe('pointer');

    const emptyCorner = { x: 2, y: 2 };
    view3d.containsPoint(emptyCorner);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(view3d.cursor).toBe('grab');
  });
});
