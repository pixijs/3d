// oxlint-disable typescript/no-this-alias -- capturing the receiver is what these tests assert
import { Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

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

// Two sibling cubes under an interactive group — enough scene for on-handlers
// at the target, on an ancestor, and along the enter/leave walks.
function makeScene() {
  const view3d = new View3D({ ...SIZE });
  view3d.camera.position.set(0, 0, 10);

  const group = new Container3D();
  group.eventMode = 'static';
  const a = makeCube();
  a.position.set(-2, 0, 0);
  a.interactive = true;
  const b = makeCube();
  b.position.set(2, 0, 0);
  b.interactive = true;
  group.addChild(a);
  group.addChild(b);
  view3d.root.addChild(group);
  tickPick(view3d);

  return { view3d, group, a, b };
}

// Hit test the way pixi does before every dispatch, asserting the pick landed
// where the test intends so probe-point drift fails loudly.
function hitAt(view3d: View3D, point: { x: number; y: number }, expected: Container3D | null): void {
  expect(view3d.containsPoint(point)).toBe(true);
  expect(view3d.events._currentPick3D).toBe(expected);
}

interface EventInit3D {
  pointerId?: number;
  button?: number;
  pointerType?: string;
  nativeEvent?: unknown;
  detail?: number;
  timeStamp?: number;
}

// Minimal stand-in for a pooled FederatedPointerEvent — the dispatcher reads
// pointerId / button / pointerType / nativeEvent / detail / timeStamp plus the
// propagation flags and eventPhase, and writes the 3D fields onto it.
function makeEvent(type: string, init: EventInit3D = {}): FederatedPointerEvent {
  return {
    type,
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
    pointerType: init.pointerType ?? 'mouse',
    nativeEvent: init.nativeEvent ?? null,
    detail: init.detail ?? 0,
    timeStamp: init.timeStamp ?? 0,
    target: null,
    currentTarget: null,
    eventPhase: 0,
    propagationStopped: false,
    propagationImmediatelyStopped: false,
  } as unknown as FederatedPointerEvent;
}

describe('View3D dispatcher — on-handler `this` binding', () => {
  test('a target on-handler is invoked as a member call: `this` is the node', () => {
    const { view3d, a } = makeScene();
    let captured: unknown = 'unset';
    a.onpointerdown = function (this: Container3D) {
      captured = this;
    };

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(captured).toBe(a);
  });

  test('an ancestor on-handler gets `this` in both the capture and bubble passes', () => {
    const { view3d, group, a } = makeScene();
    const invocations: [number, unknown][] = [];
    group.onpointerdown = function (this: Container3D, e: FederatedPointerEvent) {
      invocations.push([e.eventPhase, this]);
    };

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    // CAPTURING_PHASE = 1, BUBBLING_PHASE = 3 — the same plain on-handler key
    // fires in both passes, each time bound to the ancestor being visited.
    expect(invocations).toEqual([
      [1, group],
      [3, group],
    ]);
  });

  test('the click / pointertap chains preserve the receiver', () => {
    const { view3d, a } = makeScene();
    let clickThis: unknown = 'unset';
    let tapThis: unknown = 'unset';
    a.onclick = function (this: Container3D) {
      clickThis = this;
    };
    a.onpointertap = function (this: Container3D) {
      tapThis = this;
    };

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    const nUp = {};
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    view3d.emit('click', makeEvent('click', { nativeEvent: nUp }));
    view3d.emit('pointertap', makeEvent('pointertap', { nativeEvent: nUp }));

    expect(clickThis).toBe(a);
    expect(tapThis).toBe(a);
  });

  test('the globalpointermove fan-out binds each notified node', () => {
    const { view3d, a } = makeScene();
    let captured: unknown = 'unset';
    a.onglobalpointermove = function (this: Container3D) {
      captured = this;
    };

    view3d.emit('globalpointermove', makeEvent('pointermove'));

    expect(captured).toBe(a);
  });

  test('the enter/leave walk binds the node being visited', () => {
    const { view3d, a, b } = makeScene();
    let enterThis: unknown = 'unset';
    let leaveThis: unknown = 'unset';
    a.onpointerenter = function (this: Container3D) {
      enterThis = this;
    };
    a.onpointerleave = function (this: Container3D) {
      leaveThis = this;
    };

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(enterThis).toBe(a);

    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(leaveThis).toBe(a);
  });

  test('the pointerupoutside reconciliation walk binds the press-path node', () => {
    const { view3d, a, b } = makeScene();
    let upOutsideThis: unknown = 'unset';
    let mouseAliasThis: unknown = 'unset';
    a.onpointerupoutside = function (this: Container3D) {
      upOutsideThis = this;
    };
    a.onmouseupoutside = function (this: Container3D) {
      mouseAliasThis = this;
    };

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup'));

    expect(upOutsideThis).toBe(a);
    expect(mouseAliasThis).toBe(a);
  });
});
