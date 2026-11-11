import { Rectangle } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import type { HitResult3D, IHitVolume3D } from '~/events/HitResult3D';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import type { Ray } from '~/math/shapes/Ray';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);
const CENTER = { x: 50, y: 50 };

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

class CountingSphereVolume implements IHitVolume3D {
  public raycastCalls = 0;
  private readonly _sphere: Sphere;
  public readonly boundingRadiusSq: number;

  constructor(radius: number) {
    this._sphere = new Sphere(new Vector3(), radius);
    this.boundingRadiusSq = radius * radius;
  }

  public raycast(localRay: Ray, out: HitResult3D): number {
    this.raycastCalls++;
    const t = localRay.intersectSphereT(this._sphere);
    if (t === -1) return -1;
    localRay.at(t, out.point);
    out.distance = t;
    out.normal.set(0, 0, 0);
    out.uv.set(0, 0);
    out.triangleIndex = -1;
    return t;
  }
}

describe('interactiveChildren as a registration barrier', () => {
  test('barrier strips a passive mesh under an interactive parent, and restores it', () => {
    const view3d = makeView();
    const group = new Container3D();
    group.eventMode = 'static';
    const mesh = makeCube();
    group.addChild(mesh);
    view3d.root.addChild(group);
    tickPick(view3d);
    expect(view3d.raycast(CENTER)!.target).toBe(group);

    group.interactiveChildren = false;
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();

    group.interactiveChildren = true;
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(group);
  });

  test('own-mode candidates strip too; the barrier node itself still picks', () => {
    const view3d = makeView();
    const group = new Container3D();
    group.eventMode = 'static';
    group.hitVolume = new Sphere(new Vector3(), 2);
    const mesh = makeCube();
    mesh.eventMode = 'static';
    group.addChild(mesh);
    view3d.root.addChild(group);
    tickPick(view3d);
    expect(view3d.events._interactiveList).toContain(mesh);

    group.interactiveChildren = false;
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.events._interactiveList).toContain(group);
    expect(view3d.raycast(CENTER)!.target).toBe(group);
  });

  test("'none' on an ancestor unregisters a 'static' descendant, and leaving 'none' restores it", () => {
    const view3d = makeView();
    const blocker = new Container3D();
    const mesh = makeCube();
    mesh.eventMode = 'static';
    blocker.addChild(mesh);
    view3d.root.addChild(blocker);
    tickPick(view3d);
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);

    blocker.eventMode = 'none';
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();

    blocker.eventMode = 'passive';
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);
  });

  test("stripping a 'dynamic' descendant unwinds the View's dynamic count", () => {
    const view3d = makeView();
    const group = new Container3D();
    const mesh = makeCube();
    mesh.eventMode = 'dynamic';
    group.addChild(mesh);
    view3d.root.addChild(group);
    expect(view3d.eventMode).toBe('dynamic');

    group.interactiveChildren = false;
    expect(view3d.eventMode).toBe('static');
    expect(view3d.events._interactiveList).not.toContain(mesh);

    group.interactiveChildren = true;
    expect(view3d.eventMode).toBe('dynamic');
    expect(view3d.events._interactiveList).toContain(mesh);
  });

  test("group collider: the group's volume answers and the child's volume is never ray-tested", () => {
    const view3d = makeView();
    const group = new Container3D();
    group.eventMode = 'static';
    group.hitVolume = new Sphere(new Vector3(), 2);
    group.interactiveChildren = false;
    const mesh = makeCube();
    const counting = new CountingSphereVolume(1);
    mesh.hitVolume = counting;
    group.addChild(mesh);
    view3d.root.addChild(group);
    tickPick(view3d);

    const hit = view3d.raycast(CENTER);
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(group);
    expect(counting.raycastCalls).toBe(0);
    expect(view3d.events._interactiveList).not.toContain(mesh);
  });

  test('nested barriers: clearing only the outer one does not restore below the inner', () => {
    const view3d = makeView();
    const group = new Container3D();
    group.eventMode = 'static';
    const outer = new Container3D();
    const inner = new Container3D();
    const mesh = makeCube();
    inner.addChild(mesh);
    outer.addChild(inner);
    group.addChild(outer);
    view3d.root.addChild(group);
    tickPick(view3d);
    expect(view3d.events._interactiveList).toContain(mesh);

    outer.interactiveChildren = false;
    inner.interactiveChildren = false;
    expect(view3d.events._interactiveList).not.toContain(mesh);

    outer.interactiveChildren = true;
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();

    inner.interactiveChildren = true;
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(group);
  });

  test("'none' and interactiveChildren = false on one node: only clearing both restores, in either order", () => {
    const view3d = makeView();
    const mid = new Container3D();
    const mesh = makeCube();
    mesh.eventMode = 'static';
    mid.addChild(mesh);
    view3d.root.addChild(mid);
    tickPick(view3d);
    expect(view3d.events._interactiveList).toContain(mesh);

    mid.eventMode = 'none';
    mid.interactiveChildren = false;
    expect(view3d.events._interactiveList).not.toContain(mesh);
    mid.interactiveChildren = true;
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();
    mid.eventMode = 'passive';
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);

    mid.eventMode = 'none';
    mid.interactiveChildren = false;
    mid.eventMode = 'passive';
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();
    mid.interactiveChildren = true;
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);
  });

  test('reparenting across a barrier unregisters, and back out re-registers', () => {
    const view3d = makeView();
    const open = new Container3D();
    const closed = new Container3D();
    closed.interactiveChildren = false;
    const mesh = makeCube();
    mesh.eventMode = 'static';
    open.addChild(mesh);
    view3d.root.addChild(open);
    view3d.root.addChild(closed);
    tickPick(view3d);
    expect(view3d.events._interactiveList).toContain(mesh);

    closed.addChild(mesh);
    tickPick(view3d);
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();

    open.addChild(mesh);
    tickPick(view3d);
    expect(view3d.events._interactiveList).toContain(mesh);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);
  });

  test('interactive-cover flips prune at a barrier child and never leak below it', () => {
    const view3d = makeView();
    const grandparent = new Container3D();
    grandparent.eventMode = 'static';
    const mid = new Container3D();
    mid.interactiveChildren = false;
    const mesh = makeCube();
    mid.addChild(mesh);
    grandparent.addChild(mid);
    view3d.root.addChild(grandparent);
    tickPick(view3d);
    expect(view3d.events._interactiveList).not.toContain(mesh);

    grandparent.eventMode = 'passive';
    expect(view3d.events._interactiveList).not.toContain(mesh);
    grandparent.eventMode = 'static';
    expect(view3d.events._interactiveList).not.toContain(mesh);
    expect(view3d.raycast(CENTER)).toBeNull();
  });
});
