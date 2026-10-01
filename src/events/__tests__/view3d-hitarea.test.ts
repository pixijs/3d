import 'pixi.js/browser';
import { Container, EventBoundary, Rectangle } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Vector3 } from '~/math/vector/Vector3';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);

/** View-local point over cube A of `makeScene`, at world x = -2 (camera at z = 10, fov 60) */
const AT_A = { x: 31, y: 50 };
/** View-local point over cube B of `makeScene`, at world x = +2 */
const AT_B = { x: 69, y: 50 };

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

/**
 * Two cubes in a View3D under a bare 2D root, hit-tested through pixi's real EventBoundary so each test takes
 * the `hitTestFn` / `hitPruneFn` path pointer events do
 */
function makeScene() {
  const view3d = new View3D({ ...SIZE });
  view3d.camera.position.set(0, 0, 10);

  const a = makeCube();
  a.position.set(-2, 0, 0);
  a.interactive = true;
  const b = makeCube();
  b.position.set(2, 0, 0);
  b.interactive = true;
  view3d.root.addChild(a);
  view3d.root.addChild(b);
  tickPick(view3d);

  const root = new Container();
  root.addChild(view3d);
  const boundary = new EventBoundary(root);

  return { view3d, a, b, boundary };
}

describe('View3D hitArea', () => {
  test('a full-viewport shape still refreshes the 3D pick on each hit test', () => {
    const { view3d, a, b, boundary } = makeScene();

    boundary.hitTest(AT_A.x, AT_A.y);
    expect(view3d.events._currentPick3D).toBe(a);

    view3d.hitArea = new Rectangle(0, 0, 100, 100);

    expect(boundary.hitTest(AT_B.x, AT_B.y)).toBe(view3d);
    expect(view3d.events._currentPick3D).toBe(b);
  });

  test('a restricting shape keeps hits inside it and drops hits outside', () => {
    const { view3d, a, boundary } = makeScene();
    view3d.hitArea = new Rectangle(0, 0, 50, 100);

    expect(boundary.hitTest(AT_A.x, AT_A.y)).toBe(view3d);
    expect(view3d.events._currentPick3D).toBe(a);

    expect(boundary.hitTest(AT_B.x, AT_B.y)).toBeNull();
    expect(view3d.events._currentPick3D).toBeNull();
  });

  test('the region is shape ∩ view rect: a shape cannot extend past the viewport', () => {
    const { view3d, boundary } = makeScene();
    view3d.hitArea = new Rectangle(-50, 0, 200, 100);

    expect(boundary.hitTest(-10, 50)).toBeNull();
    expect(view3d.events._currentPick3D).toBeNull();
  });

  test('hitArea = null restores the plain containsPoint path', () => {
    const { view3d, b, boundary } = makeScene();
    view3d.hitArea = new Rectangle(0, 0, 50, 100);
    view3d.hitArea = null;

    expect(view3d.hitArea).toBeNull();
    expect(boundary.hitTest(AT_B.x, AT_B.y)).toBe(view3d);
    expect(view3d.events._currentPick3D).toBe(b);
  });

  test('assigning the read-back value does not recurse', () => {
    const { view3d, a, boundary } = makeScene();
    view3d.hitArea = new Rectangle(0, 0, 50, 100);

    // oxlint-disable-next-line no-self-assign -- the round-trip through the accessor pair is the point
    view3d.hitArea = view3d.hitArea;

    expect(boundary.hitTest(AT_A.x, AT_A.y)).toBe(view3d);
    expect(view3d.events._currentPick3D).toBe(a);
  });

  test('destroy clears the shape', () => {
    const { view3d } = makeScene();
    view3d.hitArea = new Rectangle(0, 0, 50, 100);

    view3d.events.destroy();

    expect(view3d.events._hitAreaShape).toBeNull();
    expect(view3d.hitArea).toBeNull();
  });
});
