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
/** View-local point whose ray passes through the world origin (camera at z = 10, fov 60) */
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

/**
 * An origin-centred sphere built on the structural `IHitVolume3D` interface, counting its `raycast`
 * calls; it has no `containsPoint`, so it never clips
 */
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

/** `LocalSphereVolume` with `containsPoint`, so it can also clip descendants */
class ClippingSphereVolume extends LocalSphereVolume {
  public containsPoint(localPoint: Vector3): boolean {
    return this._sphere.containsPoint(localPoint);
  }
}

/** A plain-object stand-in for a pooled `FederatedPointerEvent`, with the fields the 3D dispatcher reads */
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

    expect(view3d.raycast(CENTER)).toBeNull();
    expect(tiny.raycastCalls).toBe(0);

    const unbounded = new LocalSphereVolume(0.05, Infinity);
    far.hitVolume = unbounded;
    expect(view3d.raycast(CENTER)).toBeNull();
    expect(unbounded.raycastCalls).toBe(1);
  });
});

describe('ancestor clipping — explicit hitVolumes clip descendants', () => {
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

  test('default volumes never clip, even with clipping on elsewhere: a child poking outside its Mesh3D parent AABB still picks', () => {
    const view3d = makeView();
    const parent = makeCube();
    parent.interactive = true;
    const child = makeCube();
    child.interactive = true;
    child.position.set(0, 0, 3);
    parent.addChild(child);
    view3d.root.addChild(parent);
    const clipElsewhere = new Container3D();
    clipElsewhere.hitVolume = new Sphere(new Vector3(50, 0, 0), 1);
    view3d.root.addChild(clipElsewhere);
    tickPick(view3d);

    const hit = view3d.raycast(CENTER);
    expect(hit!.target).toBe(child);
    expect(hit!.point.z).toBeCloseTo(4);
  });

  test('a Geometry3D clip clips by its bounds3D AABB, not per triangle, so a hit far from its one triangle still picks', () => {
    const view3d = makeView();
    const clip = new Container3D();
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

    clip.hitVolume = new ClippingSphereVolume(0.5);
    expect(view3d.raycast(CENTER)).toBeNull();

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

    clip.hitVolume = null;
    expect(view3d.events._clipVolumeCount).toBe(0);
    expect(view3d.raycast(CENTER)!.target).toBe(mesh);

    clip.hitVolume = new Sphere(new Vector3(5, 0, 0), 1);
    view3d.root.removeChild(clip);
    expect(view3d.events._clipVolumeCount).toBe(0);
    view3d.root.addChild(clip);
    tickPick(view3d);
    expect(view3d.events._clipVolumeCount).toBe(1);
    expect(view3d.raycast(CENTER)).toBeNull();

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
