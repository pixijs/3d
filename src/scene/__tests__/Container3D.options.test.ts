// oxlint-disable typescript/no-this-alias -- capturing the handler's receiver is what the dispatch test asserts
import { Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { ObservableVector3 } from '~/math/vector/ObservableVector3';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);
const CENTER = { x: 50, y: 50 };

function makeCubeGeometry(): Geometry3D {
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 2, 6, 7, 2, 7, 3, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4,
  ]);
  return new Geometry3D({
    positions,
    indices,
    bounds3D: new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
  });
}

function tickPick(view3d: View3D): void {
  view3d.camera.localTransform.compose(view3d.camera.position, view3d.camera.quaternion, view3d.camera.scale);
  view3d.camera.worldTransform.copyFrom(view3d.camera.localTransform);
  updateCameraProjectionForView(view3d, view3d.camera, SCREEN, { x: 0, y: 0 });
  updateView3DTransforms(view3d);
}

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

  test("a 'box' hitVolume from options covers the children at pick time", () => {
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
  test('constructor-set event state registers on attach, and a tap calls onpointertap with the mesh as this', () => {
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

    expect(mesh.eventMode).toBe('static');
    expect(mesh.cursor).toBe('pointer');
    expect(mesh._pickIndex).toBe(-1);

    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    view3d.root.addChild(mesh);
    tickPick(view3d);

    expect(mesh._pickIndex).not.toBe(-1);
    expect(view3d.raycast(CENTER)?.target).toBe(mesh);

    expect(view3d.containsPoint(CENTER)).toBe(true);
    view3d.emit('pointerdown', makeEvent('pointerdown', {}));
    const nUp = {};
    expect(view3d.containsPoint(CENTER)).toBe(true);
    view3d.emit('pointerup', makeEvent('pointerup', nUp));
    view3d.emit('pointertap', makeEvent('pointertap', nUp));

    expect(tapped).toBe(mesh);
  });
});
