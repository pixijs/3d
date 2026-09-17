import type { FederatedPointerEvent } from 'pixi.js';
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
// View-local probe point (camera at z=10, fov 60): casts through the world origin.
const CENTER = { x: 50, y: 50 };

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

function makeView(): View3D {
  const view3d = new View3D({ ...SIZE });
  view3d.camera.position.set(0, 0, 10);
  return view3d;
}

// A hand-rolled IHitVolume3D — an origin-centred local-space sphere implemented
// against the structural interface, with a call counter for broadphase /
// prefilter observation. No containsPoint: this volume never clips.
class LocalSphereVolume implements IHitVolume3D {
  public raycastCalls = 0;
  protected readonly _sphere: Sphere;
  public readonly boundingRadiusSq: number;

  constructor(radius: number, boundingRadiusSq: number = radius * radius) {
    this._sphere = new Sphere(new Vector3(), radius);
    this.boundingRadiusSq = boundingRadiusSq;
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

// The same volume with containment — the shape that can also act as a clip.
class ClippingSphereVolume extends LocalSphereVolume {
  public containsPoint(localPoint: Vector3): boolean {
    return this._sphere.containsPoint(localPoint);
  }
}

// Minimal stand-in for a pooled FederatedPointerEvent, as in picking-dispatch.
function makeEvent(type: string): FederatedPointerEvent {
  return {
    type,
    pointerId: 1,
    button: 0,
    pointerType: 'mouse',
    nativeEvent: null,
    detail: 0,
    timeStamp: 0,
    target: null,
    currentTarget: null,
    eventPhase: 0,
    propagationStopped: false,
    propagationImmediatelyStopped: false,
  } as unknown as FederatedPointerEvent;
}

describe('custom IHitVolume3D volumes', () => {
  test('a structural volume on an interactive node picks, with surface fields zeroed', () => {
    const view3d = makeView();
    const node = new Container3D();
    node.eventMode = 'static';
    node.hitVolume = new LocalSphereVolume(1);
    view3d.root.addChild(node);
    tickPick(view3d);

    const hit = view3d.raycast(CENTER);
    expect(hit).not.toBeNull();
    expect(hit!.target).toBe(node);
    // Front of the unit sphere from the camera at z=10.
    expect(hit!.point.z).toBeCloseTo(1);
    expect(hit!.distance).toBeCloseTo(9);
    expect(hit!.normal.x).toBe(0);
    expect(hit!.normal.y).toBe(0);
    expect(hit!.normal.z).toBe(0);
    expect(hit!.uv.x).toBe(0);
    expect(hit!.uv.y).toBe(0);
    expect(hit!.triangleIndex).toBe(-1);
  });

  test('boundingRadiusSq drives the broadphase; Infinity opts out of it', () => {
    const view3d = makeView();
    const far = new Container3D();
    far.eventMode = 'static';
    far.position.set(5, 0, 0);
    const tiny = new LocalSphereVolume(0.05);
    far.hitVolume = tiny;
    view3d.root.addChild(far);
    tickPick(view3d);

    // CENTER's ray passes nowhere near a 0.05-radius bound at x=5.
    expect(view3d.raycast(CENTER)).toBeNull();
    expect(tiny.raycastCalls).toBe(0);

    const unbounded = new LocalSphereVolume(0.05, Infinity);
    far.hitVolume = unbounded;
    expect(view3d.raycast(CENTER)).toBeNull();
    expect(unbounded.raycastCalls).toBe(1);
  });

  test('a passive node with a custom volume registers through the cascade and targets its ancestor', () => {
    const view3d = makeView();
    const robot = new Container3D();
    robot.eventMode = 'static';
    const part = new Container3D();
    robot.addChild(part);
    view3d.root.addChild(robot);
    tickPick(view3d);

    expect(view3d.raycast(CENTER)).toBeNull();

    part.hitVolume = new LocalSphereVolume(1);
    expect(view3d.events._interactiveList).toContain(part);
    expect(view3d.raycast(CENTER)!.target).toBe(robot);
  });
});

describe('ancestor clipping — explicit hitVolumes clip descendants', () => {
  test('a child inside the ancestor clip is picked; outside it is not', () => {
    const view3d = makeView();
    const clip = new Container3D();
    const mesh = makeCube();
    mesh.interactive = true;
    clip.addChild(mesh);
    view3d.root.addChild(clip);
    clip.hitVolume = new Sphere(new Vector3(), 3);
    tickPick(view3d);

    // Hit point (0, 0, 1) sits inside the r=3 sphere.
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);

    // Move the clip away: the same hit point now falls outside it.
    clip.hitVolume = new Sphere(new Vector3(5, 0, 0), 1);
    expect(view3d.raycast(CENTER)).toBeNull();
  });

  test('a clip rejection does not occlude nodes behind the clipped one', () => {
    const view3d = makeView();
    const clip = new Container3D();
    clip.hitVolume = Box.fromCenterSize({ x: 5, y: 0, z: 0 }, 1);
    const front = makeCube();
    front.interactive = true;
    clip.addChild(front);
    const behind = makeCube();
    behind.interactive = true;
    behind.position.set(0, 0, -5);
    view3d.root.addChild(clip);
    view3d.root.addChild(behind);
    tickPick(view3d);

    const hit = view3d.raycast(CENTER);
    expect(hit!.target).toBe(behind);
    expect(hit!.point.z).toBeCloseTo(-4);
  });

  test('default volumes never clip: a child poking outside its Mesh3D parent AABB still picks', () => {
    const view3d = makeView();
    const parent = makeCube();
    parent.interactive = true;
    const child = makeCube();
    child.interactive = true;
    child.position.set(0, 0, 3);
    parent.addChild(child);
    view3d.root.addChild(parent);
    // An unrelated explicit volume elsewhere keeps the clip machinery active,
    // so the walk really runs and must still skip the parent's default AABB.
    const unrelated = new Container3D();
    unrelated.hitVolume = new Sphere(new Vector3(50, 0, 0), 1);
    view3d.root.addChild(unrelated);
    tickPick(view3d);

    // The child's front face (z=4) is well outside the parent's implicit ±1
    // AABB; the closer child must win, not be clipped by the default volume.
    const hit = view3d.raycast(CENTER);
    expect(hit!.target).toBe(child);
    expect(hit!.point.z).toBeCloseTo(4);
  });

  test('a Geometry3D clip clips by its bounds3D AABB, not per triangle', () => {
    const view3d = makeView();
    const clip = new Container3D();
    // One tiny triangle in a corner, with deliberately generous bounds.
    clip.hitVolume = new Geometry3D({
      positions: new Float32Array([1.9, 1.9, 0, 1.9, 1.8, 0, 1.8, 1.9, 0]),
      indices: new Uint16Array([0, 1, 2]),
      bounds3D: new Box(new Vector3(-2, -2, -2), new Vector3(2, 2, 2)),
    });
    const mesh = makeCube();
    mesh.interactive = true;
    clip.addChild(mesh);
    view3d.root.addChild(clip);
    tickPick(view3d);

    // (0, 0, 1) is nowhere near the triangle but inside bounds3D → allowed.
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);
  });

  test('nested clips all apply: the hit point must satisfy every ancestor volume', () => {
    const view3d = makeView();
    const grandparent = new Container3D();
    const parent = new Container3D();
    const mesh = makeCube();
    mesh.interactive = true;
    parent.addChild(mesh);
    grandparent.addChild(parent);
    view3d.root.addChild(grandparent);
    grandparent.hitVolume = new Sphere(new Vector3(), 3);
    parent.hitVolume = Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 4);
    tickPick(view3d);

    expect(view3d.raycast(CENTER)!.target).toBe(mesh);

    parent.hitVolume = Box.fromCenterSize({ x: 0, y: 5, z: 0 }, 1);
    expect(view3d.raycast(CENTER)).toBeNull();

    parent.hitVolume = Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 4);
    grandparent.hitVolume = new Sphere(new Vector3(0, 5, 0), 0.5);
    expect(view3d.raycast(CENTER)).toBeNull();
  });

  test("a 'passive' ancestor's explicit volume clips — mode does not matter", () => {
    const view3d = makeView();
    const cover = new Container3D();
    cover.eventMode = 'static';
    const passiveClip = new Container3D();
    const mesh = makeCube();
    passiveClip.addChild(mesh);
    cover.addChild(passiveClip);
    view3d.root.addChild(cover);
    tickPick(view3d);

    expect(view3d.raycast(CENTER)!.target).toBe(cover);

    passiveClip.hitVolume = new Sphere(new Vector3(5, 0, 0), 1);
    expect(view3d.raycast(CENTER)).toBeNull();
  });

  test('the prefilter skips clipped candidates before their narrowphase runs', () => {
    const view3d = makeView();
    const clip = new Container3D();
    clip.hitVolume = Box.fromCenterSize({ x: 5, y: 0, z: 0 }, 1);
    const a = new Container3D();
    a.eventMode = 'static';
    const aVolume = new LocalSphereVolume(1, Infinity);
    a.hitVolume = aVolume;
    const b = new Container3D();
    b.eventMode = 'static';
    const bVolume = new LocalSphereVolume(1, Infinity);
    b.hitVolume = bVolume;
    clip.addChild(a);
    clip.addChild(b);
    view3d.root.addChild(clip);
    tickPick(view3d);

    // The ray misses the clip box outright: both children are rejected by the
    // ancestor ray test, so neither custom narrowphase ever runs. (That the
    // clip volume itself is ray-tested once, not once per child, is the memo's
    // job — not directly observable from here, so behavioral equivalence is
    // what this asserts.)
    expect(view3d.raycast(CENTER)).toBeNull();
    expect(aVolume.raycastCalls).toBe(0);
    expect(bVolume.raycastCalls).toBe(0);
  });

  test('winner containment is exact: a surface beyond the clip is rejected even when the ray crosses the clip', () => {
    const view3d = makeView();
    const clip = new Container3D();
    clip.hitVolume = new Sphere(new Vector3(), 2);
    const mesh = makeCube();
    mesh.interactive = true;
    mesh.position.set(0, 0, -4);
    clip.addChild(mesh);
    view3d.root.addChild(clip);
    tickPick(view3d);

    // The CENTER ray passes straight through the r=2 clip sphere (prefilter
    // passes), but the cube's front face at z=-3 lies beyond its far side.
    expect(view3d.raycast(CENTER)).toBeNull();
  });

  test('a custom clip volume clips only when it provides containsPoint', () => {
    const view3d = makeView();
    const clip = new Container3D();
    const mesh = makeCube();
    mesh.interactive = true;
    clip.addChild(mesh);
    view3d.root.addChild(clip);
    tickPick(view3d);

    // With containment: the hit at (0, 0, 1) is outside a r=0.5 sphere → clipped.
    clip.hitVolume = new ClippingSphereVolume(0.5);
    expect(view3d.raycast(CENTER)).toBeNull();

    // Same shape without containsPoint: it can never clip.
    clip.hitVolume = new LocalSphereVolume(0.5);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);
  });

  test('clip count bookkeeping: setter transitions, subtree detach / re-attach, and other Views', () => {
    const view3d = makeView();
    const clip = new Container3D();
    const mesh = makeCube();
    mesh.interactive = true;
    clip.addChild(mesh);
    view3d.root.addChild(clip);
    tickPick(view3d);
    expect(view3d.events._clipVolumeCount).toBe(0);

    clip.hitVolume = new Sphere(new Vector3(5, 0, 0), 1);
    expect(view3d.events._clipVolumeCount).toBe(1);
    expect(view3d.raycast(CENTER)).toBeNull();

    // Clearing the volume restores un-clipped picking and zeroes the count.
    clip.hitVolume = null;
    expect(view3d.events._clipVolumeCount).toBe(0);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);

    // Detaching a subtree carries its explicit volume out; re-attaching carries it back in.
    clip.hitVolume = new Sphere(new Vector3(5, 0, 0), 1);
    view3d.root.removeChild(clip);
    expect(view3d.events._clipVolumeCount).toBe(0);
    view3d.root.addChild(clip);
    tickPick(view3d);
    expect(view3d.events._clipVolumeCount).toBe(1);
    expect(view3d.raycast(CENTER)).toBeNull();

    // A second View is untouched by the first View's clips.
    const other = makeView();
    const otherMesh = makeCube();
    otherMesh.interactive = true;
    other.root.addChild(otherMesh);
    tickPick(other);
    expect(other.events._clipVolumeCount).toBe(0);
    expect(other.raycast(CENTER)!.target).toBe(otherMesh);
  });

  test('view3d.raycast and event dispatch agree on a clipped scene', () => {
    const view3d = makeView();
    const clip = new Container3D();
    clip.hitVolume = new Sphere(new Vector3(5, 0, 0), 1);
    const mesh = makeCube();
    mesh.interactive = true;
    clip.addChild(mesh);
    view3d.root.addChild(clip);
    tickPick(view3d);

    let meshDowns = 0;
    mesh.on('pointerdown', () => meshDowns++);

    expect(view3d.raycast(CENTER)).toBeNull();
    expect(view3d.containsPoint(CENTER)).toBe(true);
    expect(view3d.events._currentPick3D).toBeNull();
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    expect(meshDowns).toBe(0);

    clip.hitVolume = null;
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);
    expect(view3d.containsPoint(CENTER)).toBe(true);
    expect(view3d.events._currentPick3D).toBe(mesh);
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    expect(meshDowns).toBe(1);
  });
});
