// oxlint-disable typescript/no-this-alias -- capturing the handler's receiver is what the dispatch test asserts
import { Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Sphere } from '~/math/shapes/Sphere';
import { ObservableVector3 } from '~/math/vector/ObservableVector3';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);
const CENTER = { x: 50, y: 50 };

// A 2×2×2 cube centred at origin, so each face sits one unit from the centre.
function makeCubeGeometry(): Geometry3D {
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
  return new Geometry3D({
    positions,
    indices,
    bounds3D: new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
  });
}

// Run the transform pass + camera projection so worldTransform / viewProjection
// reflect the current scene state. These tests sit outside the render loop.
function tickPick(view3d: View3D): void {
  view3d.camera.localTransform.compose(view3d.camera.position, view3d.camera.quaternion, view3d.camera.scale);
  view3d.camera.worldTransform.copyFrom(view3d.camera.localTransform);
  updateCameraProjectionForView(view3d, view3d.camera, SCREEN, { x: 0, y: 0 });
  updateView3DTransforms(view3d);
}

// Minimal stand-in for a pooled FederatedPointerEvent — the dispatcher reads
// pointerId / button / pointerType / nativeEvent / detail / timeStamp plus the
// propagation flags and eventPhase, and writes the 3D fields onto it.
function makeEvent(type: string, nativeEvent: unknown = null): FederatedPointerEvent {
  return {
    type,
    pointerId: 1,
    button: 0,
    pointerType: 'mouse',
    nativeEvent,
    detail: 0,
    timeStamp: 0,
    target: null,
    currentTarget: null,
    eventPhase: 0,
    propagationStopped: false,
    propagationImmediatelyStopped: false,
  } as unknown as FederatedPointerEvent;
}

describe('Container3D constructor options', () => {
  test('interactive: true resolves to eventMode static; no options leaves the node inert', () => {
    const c = new Container3D({ interactive: true });
    expect(c.eventMode).toBe('static');

    const bare = new Container3D();
    expect(bare.eventMode).toBe('passive');
    expect(bare._eventMode).toBeUndefined();
    expect(bare._pickIndex).toBe(-1);
  });

  test('eventMode, cursor and interactiveChildren all read back', () => {
    const c = new Container3D({ eventMode: 'static', cursor: 'pointer', interactiveChildren: false });

    expect(c.eventMode).toBe('static');
    expect(c.cursor).toBe('pointer');
    expect(c.interactiveChildren).toBe(false);
  });

  test('hitVolume from options resolves eagerly', () => {
    const sphere = new Sphere(new Vector3(), 2);
    const c = new Container3D({ hitVolume: sphere });

    expect(c.hitVolume).toBe(sphere);
    expect(c._hitVolumeResolved).toBe(sphere);
  });

  test("a 'box' hitVolume resolves after the children, so it measures the finished subtree", () => {
    const child = new Mesh3D({ geometry: makeCubeGeometry(), material: new Material3D({}), x: 1 });
    const group = new Container3D({ eventMode: 'static', hitVolume: 'box', children: [child] });
    const box = group._hitVolumeResolved as Box;

    expect([box.min.x, box.min.y, box.min.z]).toEqual([0, -1, -1]);
    expect([box.max.x, box.max.y, box.max.z]).toEqual([2, 1, 1]);
  });

  test("a 'box' hitVolume from options covers the children at pick time", () => {
    // 'none' on the child leaves the group's own box as the only shape the ray can hit.
    const child = new Mesh3D({
      geometry: makeCubeGeometry(),
      material: new Material3D({}),
      x: 1,
      eventMode: 'none',
    });
    const group = new Container3D({ eventMode: 'static', hitVolume: 'box', children: [child] });
    const view3d = new View3D({ ...SIZE });

    view3d.camera.position.set(0, 0, 10);
    view3d.root.addChild(group);
    tickPick(view3d);

    // A ray through the child's centre — well clear of the origin a zero box would sit at.
    const probe = view3d.worldToScreen({ x: 1, y: 0, z: 0 })!;

    expect(view3d.raycast(probe)?.target).toBe(group);
  });

  test('undefined-valued keys do not clobber the mixin defaults', () => {
    const c = new Container3D({ eventMode: undefined, interactiveChildren: undefined });

    expect(c.eventMode).toBe('passive');
    expect(c.interactiveChildren).toBe(true);
  });
});

describe('Container3D constructor options — node surface', () => {
  test('label defaults to null, as in pixi, and an explicit undefined keeps it', () => {
    expect(new Container3D().label).toBeNull();
    expect(new Container3D({ label: undefined }).label).toBeNull();
    expect(new Container3D({ label: 'arm' }).label).toBe('arm');
  });

  test('transform and visibility keys go through the setters', () => {
    const c = new Container3D({
      position: { x: 1, y: 2, z: 3 },
      z: 9,
      scale: 2,
      rotation: { x: 0, y: 0.5, z: 0 },
      visible: false,
    });

    expect(c.position).toBeInstanceOf(ObservableVector3);
    expect(c.position).toMatchObject({ x: 1, y: 2, z: 9 });
    expect(c.scale).toMatchObject({ x: 2, y: 2, z: 2 });
    expect(c.rotation).toMatchObject({ x: 0, y: 0.5, z: 0 });
    expect(c.rotationDirty).toBe(true);
    expect(c.visible).toBe(false);

    c.updateLocalTransform();
    expect(c.localTransform.elements[14]).toBe(9);
  });

  test('origin goes through the setter, and a number sets all three axes', () => {
    const c = new Container3D({ origin: { x: 1, y: 2, z: 3 } });
    const scaled = new Container3D({ origin: 4, scale: 2 });

    expect(c.origin).toBeInstanceOf(ObservableVector3);
    expect(c.origin).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(scaled.origin).toMatchObject({ x: 4, y: 4, z: 4 });

    // Scaling ×2 around the origin keeps it on position + origin, so the node sits 4 units back.
    scaled.updateLocalTransform();
    const e = scaled.localTransform.elements;

    expect([e[12], e[13], e[14]]).toEqual([-4, -4, -4]);
  });

  test('of rotation and quaternion, the key written last wins', () => {
    const rotation = { x: 0, y: 0.5, z: 0 };
    const quaternion = { x: 0, y: 0, z: 0.1, w: 1 };

    expect(new Container3D({ rotation, quaternion }).rotationDirty).toBe(false);
    expect(new Container3D({ quaternion, rotation }).rotationDirty).toBe(true);
  });

  test('children are added in order and parent adds the node last', () => {
    const a = new Container3D();
    const b = new Container3D();
    const parent = new Container3D({ children: [new Container3D()] });
    const added: Container3D[] = [];

    parent.on('childAdded', (child) => added.push(child));

    const c = new Container3D({ children: [a, b], parent });

    expect(c.children).toEqual([a, b]);
    expect(a.parent).toBe(c);
    expect(c.parent).toBe(parent);
    expect(parent.children[1]).toBe(c);
    expect(added).toEqual([c]);
  });

  test('width, height and depth measure the subtree built from children', () => {
    const mesh = new Mesh3D({ geometry: makeCubeGeometry(), material: new Material3D({}) });
    const c = new Container3D({ children: [mesh], width: 4, depth: 1 });

    expect(c.scale).toMatchObject({ x: 2, y: 1, z: 0.5 });
  });
});

describe('Mesh3D constructor options — event surface', () => {
  test('constructor-set event state registers through the attach walk and dispatches', () => {
    let tapped: unknown = 'unset';
    const mesh = new Mesh3D({
      geometry: makeCubeGeometry(),
      material: new Material3D({}),
      eventMode: 'static',
      cursor: 'pointer',
      onpointertap: function (this: Container3D) {
        tapped = this;
      },
    });

    // Unattached construction is safe — nothing registered yet.
    expect(mesh.eventMode).toBe('static');
    expect(mesh.cursor).toBe('pointer');
    expect(mesh._pickIndex).toBe(-1);

    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    view3d.root.addChild(mesh);
    tickPick(view3d);

    expect(mesh._pickIndex).not.toBe(-1);
    expect(view3d.raycast(CENTER)?.target).toBe(mesh);

    // The pointerdown → pointerup → pointertap chain pixi's boundary emits for a tap.
    expect(view3d.containsPoint(CENTER)).toBe(true);
    view3d.emit('pointerdown', makeEvent('pointerdown', {}));
    const nUp = {};
    expect(view3d.containsPoint(CENTER)).toBe(true);
    view3d.emit('pointerup', makeEvent('pointerup', nUp));
    view3d.emit('pointertap', makeEvent('pointertap', nUp));

    expect(tapped).toBe(mesh);
  });

  test('own keys keep their exact defaults and semantics', () => {
    const geometry = makeCubeGeometry();
    const material = new Material3D({});
    const mesh = new Mesh3D({ geometry, material });

    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.eventMode).toBe('passive');
  });

  test("hitVolume string shorthands resolve against the mesh's geometry", () => {
    const geometry = makeCubeGeometry();
    const mesh = new Mesh3D({ geometry, material: new Material3D({}), hitVolume: 'geometry' });

    expect(mesh.hitVolume).toBe('geometry');
    expect(mesh._hitVolumeResolved).toBe(geometry);
  });
});
