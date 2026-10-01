import { Rectangle } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
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
const CENTER = { x: 50, y: 50 };

/** A 2×2×2 cube mesh centred on the origin, so each face sits one unit from the centre */
function makeCube(): Mesh3D {
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 2, 6, 7, 2, 7, 3, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4,
  ]);
  const geometry = new Geometry3D({
    positions,
    indices,
    bounds3D: new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
  });
  return new Mesh3D({ geometry, material: new Material3D({}) });
}

/** Runs the transform pass and camera projection a render would, so picks see the current scene without rendering */
function tickPick(view3d: View3D): void {
  view3d.camera.localTransform.compose(view3d.camera.position, view3d.camera.quaternion, view3d.camera.scale);
  view3d.camera.worldTransform.copyFrom(view3d.camera.localTransform);
  updateCameraProjectionForView(view3d, view3d.camera, SCREEN, { x: 0, y: 0 });
  updateView3DTransforms(view3d);
}

function makeView(): View3D {
  const view3d = new View3D({ ...SIZE });
  view3d.camera.position.set(0, 0, 10);
  return view3d;
}

describe('passive nodes under an interactive ancestor — implicit pick registration', () => {
  test('parent made static before attach registers the subtree through the attach walk', () => {
    const view3d = makeView();
    const robot = new Container3D();
    robot.eventMode = 'static';
    const mesh = makeCube();
    robot.addChild(mesh);

    view3d.root.addChild(robot);
    tickPick(view3d);

    expect(view3d.events._interactiveList).toContain(mesh);
    const hit = view3d.raycast(CENTER);
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(robot);
  });

  test('nested interactive ancestors: the nearest one is the target, and mode churn never duplicates', () => {
    const view3d = makeView();
    const grandparent = new Container3D();
    const parent = new Container3D();
    const mesh = makeCube();
    parent.addChild(mesh);
    grandparent.addChild(parent);
    view3d.root.addChild(grandparent);

    grandparent.eventMode = 'static';
    parent.eventMode = 'static';
    tickPick(view3d);

    expect(view3d.raycast(CENTER)!.target).toBe(parent);

    parent.eventMode = 'passive';
    parent.eventMode = 'static';
    grandparent.eventMode = 'passive';
    grandparent.eventMode = 'static';

    expect(view3d.events._interactiveList.filter((n) => n === mesh)).toHaveLength(1);
    expect(view3d.raycast(CENTER)!.target).toBe(parent);
  });

  test('turning the nearer ancestor off retargets to the remaining interactive ancestor', () => {
    const view3d = makeView();
    const grandparent = new Container3D();
    const parent = new Container3D();
    const mesh = makeCube();
    parent.addChild(mesh);
    grandparent.addChild(parent);
    view3d.root.addChild(grandparent);
    grandparent.eventMode = 'static';
    parent.eventMode = 'static';
    tickPick(view3d);

    parent.eventMode = 'passive';

    expect(view3d.events._interactiveList).toContain(mesh);
    const hit = view3d.raycast(CENTER);
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(grandparent);
  });

  test('turning the only interactive ancestor off unregisters the subtree', () => {
    const view3d = makeView();
    const robot = new Container3D();
    const mesh = makeCube();
    robot.addChild(mesh);
    view3d.root.addChild(robot);
    robot.eventMode = 'static';
    tickPick(view3d);
    expect(view3d.raycast(CENTER)).not.toBeNull();

    robot.eventMode = 'passive';

    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();
  });

  test("'none' on a mid node blocks the subtree; leaving 'none' restores it", () => {
    const view3d = makeView();
    const parent = new Container3D();
    const mid = new Container3D();
    const mesh = makeCube();
    mid.addChild(mesh);
    parent.addChild(mid);
    view3d.root.addChild(parent);
    parent.eventMode = 'static';
    tickPick(view3d);
    expect(view3d.raycast(CENTER)!.target).toBe(parent);

    mid.eventMode = 'none';
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();

    mid.eventMode = 'passive';
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(parent);
  });

  test('re-parenting moves a passive mesh in and out of implicit registration', () => {
    const view3d = makeView();
    const inertGroup = new Container3D();
    const liveGroup = new Container3D();
    liveGroup.eventMode = 'static';
    const mesh = makeCube();
    inertGroup.addChild(mesh);
    view3d.root.addChild(inertGroup);
    view3d.root.addChild(liveGroup);
    tickPick(view3d);

    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();

    liveGroup.addChild(mesh);
    tickPick(view3d);
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(liveGroup);

    inertGroup.addChild(mesh);
    tickPick(view3d);
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();
  });

  test('hitVolume on a passive plain container, which has no default volume, registers and unregisters it', () => {
    const view3d = makeView();
    const parent = new Container3D();
    const shape = new Container3D();
    parent.addChild(shape);
    view3d.root.addChild(parent);
    parent.eventMode = 'static';
    tickPick(view3d);

    expect(view3d.events._interactiveList).not.toContain(shape);
    expect(view3d.raycast(CENTER)).toBeNull();

    shape.hitVolume = new Sphere(new Vector3(0, 0, 0), 1);
    expect(view3d.events._interactiveList).toContain(shape);
    expect(view3d.raycast(CENTER)!.target).toBe(parent);

    shape.hitVolume = null;
    expect(view3d.events._interactiveList).not.toContain(shape);
    expect(view3d.raycast(CENTER)).toBeNull();
  });

  test('implicit registrations never touch the dynamic-node count', () => {
    const view3d = makeView();
    const robot = new Container3D();
    const mesh = makeCube();
    robot.addChild(mesh);
    view3d.root.addChild(robot);

    robot.eventMode = 'dynamic';
    expect(view3d.eventMode).toBe('dynamic');
    expect(view3d.events._interactiveList).toContain(mesh);

    robot.removeChild(mesh);
    expect(view3d.eventMode).toBe('dynamic');

    robot.eventMode = 'passive';
    expect(view3d.eventMode).toBe('static');
  });

  test("interactive = false still ray-tests under an interactive ancestor; 'none' opts out", () => {
    const view3d = makeView();
    const robot = new Container3D();
    const mesh = makeCube();
    mesh.interactive = true;
    robot.addChild(mesh);
    view3d.root.addChild(robot);
    robot.eventMode = 'static';
    tickPick(view3d);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);

    mesh.interactive = false;
    expect(view3d.raycast(CENTER)!.target).toBe(robot);

    mesh.eventMode = 'none';
    expect(view3d.raycast(CENTER)).toBeNull();
  });
});
