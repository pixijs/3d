// Load pixi's 2D events mixin (isInteractive etc.) — normally installed lazily at Application.init,
// which these tests never run; without it `EventBoundary.hitTest` throws.
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
import type { View3DOptions } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);

// View-local probe points for the two-cube scene built by `makeScene` (camera
// at z=10, fov 60): A sits at world x=-2, B at x=+2.
const AT_A = { x: 31, y: 50 };
const AT_B = { x: 69, y: 50 };

// A 2×2×2 cube centred at origin, so each face sits one unit from the centre.
function makeCube(): Mesh3D {
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
  const geometry = new Geometry3D({
    positions,
    indices,
    bounds3D: new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
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

// Two cubes and pixi's REAL EventBoundary over a bare root, so hit tests take
// the exact hitTestFn / hitPruneFn path pointer events do. The View is built
// from the given options so tests can pass inherited options at construction.
function makeScene(options: Omit<View3DOptions, 'size'> = {}) {
  const view3d = new View3D({ ...SIZE, ...options });
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

describe('View3D constructor — inherited container options', () => {
  test('eventMode from options overrides the boundary-forced static', () => {
    expect(new View3D({ ...SIZE }).eventMode).toBe('static');
    expect(new View3D({ ...SIZE, eventMode: 'none' }).eventMode).toBe('none');
  });

  test('cursor from options reads back through the events delegate', () => {
    const view3d = new View3D({ ...SIZE, cursor: 'grab' });
    expect(view3d.cursor).toBe('grab');
  });

  test('hitArea from options restricts hit-testing', () => {
    const { view3d, a, boundary } = makeScene({ hitArea: new Rectangle(0, 0, 50, 100) });

    expect(boundary.hitTest(AT_A.x, AT_A.y)).toBe(view3d);
    expect(view3d.events._currentPick3D).toBe(a);

    expect(boundary.hitTest(AT_B.x, AT_B.y)).toBeNull();
    expect(view3d.events._currentPick3D).toBeNull();
  });

  test('on-handlers, label and position apply', () => {
    const onclick = () => {};
    const view3d = new View3D({ ...SIZE, onclick, label: 'hud', x: 12, y: 34 });

    expect(view3d.onclick).toBe(onclick);
    expect(view3d.label).toBe('hud');
    expect(view3d.x).toBe(12);
    expect(view3d.y).toBe(34);
  });

  test('position option applies as a point', () => {
    const view3d = new View3D({ ...SIZE, position: { x: 5, y: 7 }, alpha: 0.5 });

    expect(view3d.position.x).toBe(5);
    expect(view3d.position.y).toBe(7);
    expect(view3d.alpha).toBe(0.5);
  });

  test('parent from options contains the view after construction', () => {
    const parent = new Container();
    const view3d = new View3D({ ...SIZE, parent });

    expect(view3d.parent).toBe(parent);
    expect(parent.children).toContain(view3d);
  });

  test('undefined-valued keys do not clobber defaults', () => {
    const view3d = new View3D({ ...SIZE, eventMode: undefined });
    expect(view3d.eventMode).toBe('static');
  });
});
