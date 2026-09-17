import { Point } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { Plane } from '~/math/shapes/Plane';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';
import { View3D } from '~/scene/View3D';

/** 800×600 view, camera 10 units up the +Z axis facing -Z (default orientation). */
function makeView() {
  const view3d = new View3D({ width: 800, height: 600 });
  view3d.camera.position.set(0, 0, 10);

  return view3d;
}

function expectPointClose(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 4);
  expect(actual.y).toBeCloseTo(y, 4);
}

function expectVec3Close(actual: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 4);
  expect(actual.y).toBeCloseTo(y, 4);
  expect(actual.z).toBeCloseTo(z, 4);
}

describe('View3D.worldToScreen', () => {
  test('a point on the camera axis lands at the view centre', () => {
    const view3d = makeView();

    expectPointClose(view3d.worldToScreen({ x: 0, y: 0, z: 0 })!, 400, 300);
  });

  test('follows the View’s 2D position in the stage', () => {
    const view3d = makeView();
    view3d.position.set(100, 50);

    expectPointClose(view3d.worldToScreen({ x: 0, y: 0, z: 0 })!, 500, 350);
  });

  test('accounts for anchor', () => {
    const view3d = makeView();
    view3d.anchor = 0.5;
    view3d.position.set(400, 300);

    expectPointClose(view3d.worldToScreen({ x: 0, y: 0, z: 0 })!, 400, 300);
  });

  test('+y in world space is up on screen', () => {
    const view3d = makeView();

    const p = view3d.worldToScreen({ x: 0, y: 1, z: 0 })!;

    expect(p.x).toBeCloseTo(400, 4);
    expect(p.y).toBeLessThan(300);
  });

  test('returns null behind a perspective camera', () => {
    const view3d = makeView();

    expect(view3d.worldToScreen({ x: 0, y: 0, z: 20 })).toBeNull();
  });

  test('orthographic mapping is linear in view pixels', () => {
    const view3d = makeView();
    view3d.camera.mode = 'orthographic';
    view3d.camera.orthographicSize = 5; // half-width 5 world units over 800px → 80 px per unit

    expectPointClose(view3d.worldToScreen({ x: 1, y: 0, z: 0 })!, 480, 300);
    expectPointClose(view3d.worldToScreen({ x: 0, y: 1, z: 0 })!, 400, 220);
  });

  test('respects the camera viewport sub-rectangle', () => {
    const view3d = makeView();
    view3d.camera.viewport.x = 0.5;
    view3d.camera.viewport.width = 0.5;

    // Centre of the right-half viewport.
    expectPointClose(view3d.worldToScreen({ x: 0, y: 0, z: 0 })!, 600, 300);
  });

  test('writes into the supplied point and returns it', () => {
    const view3d = makeView();
    const out = new Point();

    expect(view3d.worldToScreen({ x: 0, y: 0, z: 0 }, out)).toBe(out);
  });

  test('returns null instead of NaN for a zero-area view', () => {
    const view3d = makeView();
    view3d.setSize(800, 0);

    expect(view3d.worldToScreen({ x: 0, y: 0, z: 0 })).toBeNull();
  });

  test('skipUpdate = true reads the stale cached camera transform', () => {
    const view3d = makeView();

    // No transform pass has run: the cached camera world transform is still identity, which
    // puts the world origin exactly on the camera plane → null.
    expect(view3d.worldToScreen({ x: 0, y: 0, z: 0 }, undefined, true)).toBeNull();
    expect(view3d.worldToScreen({ x: 0, y: 0, z: 0 })).not.toBeNull();
  });
});

describe('View3D.screenToRay', () => {
  test('perspective ray originates at the camera with unit direction', () => {
    const view3d = makeView();

    const ray = view3d.screenToRay({ x: 400, y: 300 });

    expectVec3Close(ray.origin, 0, 0, 10);
    expectVec3Close(ray.direction, 0, 0, -1);
    expect(ray.direction.magnitude()).toBeCloseTo(1, 6);
  });

  test('every point along the ray projects back to the input', () => {
    const view3d = makeView();
    view3d.position.set(37, -12);
    view3d.scale.set(1.5, 0.8);
    view3d.rotation = 0.3;

    const input = { x: 250, y: 410 };
    const ray = view3d.screenToRay(input);

    for (const t of [2, 8, 25]) {
      expectPointClose(view3d.worldToScreen(ray.at(t))!, input.x, input.y);
    }
  });

  test('orthographic rays are parallel with offset origins', () => {
    const view3d = makeView();
    view3d.camera.mode = 'orthographic';
    view3d.camera.orthographicSize = 5;

    const a = view3d.screenToRay({ x: 400, y: 300 }, new Ray());
    const b = view3d.screenToRay({ x: 480, y: 300 }, new Ray());

    expectVec3Close(a.direction, 0, 0, -1);
    expectVec3Close(b.direction, 0, 0, -1);
    expectVec3Close(a.origin, 0, 0, 10);
    expectVec3Close(b.origin, 1, 0, 10); // 80 px per world unit
  });

  test('writes into the supplied ray and returns it', () => {
    const view3d = makeView();
    const out = new Ray();

    expect(view3d.screenToRay({ x: 0, y: 0 }, out)).toBe(out);
  });

  test('round-trips through a camera viewport sub-rectangle', () => {
    const view3d = makeView();
    view3d.camera.viewport.x = 0.5;
    view3d.camera.viewport.width = 0.5;
    view3d.camera.viewport.y = 0.25;
    view3d.camera.viewport.height = 0.5;
    view3d.position.set(20, -30);

    // Centre of the sub-viewport looks straight down the camera axis.
    const centre = { x: 20 + 600, y: -30 + 300 };
    const centreRay = view3d.screenToRay(centre);
    expectVec3Close(centreRay.direction, 0, 0, -1);

    const input = { x: 20 + 520, y: -30 + 240 };
    const ray = view3d.screenToRay(input);

    for (const t of [3, 15]) {
      expectPointClose(view3d.worldToScreen(ray.at(t))!, input.x, input.y);
    }
  });
});

describe('View3D.screenToWorld', () => {
  test('distance overload returns the point that far in front of the camera', () => {
    const view3d = makeView();

    expectVec3Close(view3d.screenToWorld({ x: 400, y: 300 }, 10), 0, 0, 0);
  });

  test('plane overload picks the pointer’s ground hit', () => {
    const view3d = makeView();
    view3d.camera.position.set(0, 5, 10);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const hit = view3d.screenToWorld({ x: 400, y: 300 }, ground)!;

    expectVec3Close(hit, 0, 0, 0);
  });

  test('plane overload returns null when the ray points away', () => {
    const view3d = makeView();
    view3d.camera.position.set(0, 5, 10);
    view3d.camera.lookAt({ x: 0, y: 20, z: 0 }); // aims upward, away from the ground

    const ground = new Plane(new Vector3(0, 1, 0), 0);

    expect(view3d.screenToWorld({ x: 400, y: 300 }, ground)).toBeNull();
  });

  test('a zero-area view yields a degenerate zeroed ray, never NaN', () => {
    const view3d = makeView();
    view3d.setSize(0, 600);

    const ray = view3d.screenToRay({ x: 100, y: 100 });
    expectVec3Close(ray.origin, 0, 0, 0);
    expectVec3Close(ray.direction, 0, 0, 0);

    // The zeroed ray is parallel to (and off) this plane, so the pick reports a clean miss.
    const floor = new Plane(new Vector3(0, 1, 0), -1);
    expect(view3d.screenToWorld({ x: 100, y: 100 }, floor)).toBeNull();
  });

  test('round-trips with worldToScreen', () => {
    const view3d = makeView();
    view3d.anchor = 0.5;
    view3d.position.set(500, 280);
    view3d.rotation = -0.2;

    const world = view3d.screenToWorld({ x: 330, y: 190 }, 12.5);

    expectPointClose(view3d.worldToScreen(world)!, 330, 190);
  });
});
