import { Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { describe, expect, expectTypeOf, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import type { Pointer3DEvent } from '~/events/Pointer3DEvent';
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

// Two sibling cubes under an interactive group — enough scene for hops at the
// target, on an ancestor, and along the enter/leave and fan-out paths.
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

describe('currentTarget3D — the typed per-hop node of a 3D chain dispatch', () => {
  test('an ancestor bubble listener reads itself while target3D keeps the picked node', () => {
    const { view3d, group, a } = makeScene();
    let hop: unknown = 'unset';
    let target: unknown = 'unset';
    group.on('pointerdown', (e) => {
      hop = e.currentTarget3D;
      target = e.target3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(hop).toBe(group);
    expect(target).toBe(a);
  });

  test('an ancestor capture listener reads itself during phase 1', () => {
    const { view3d, group, a } = makeScene();
    let hop: unknown = 'unset';
    let target: unknown = 'unset';
    let phase = 0;
    group.on('pointerdowncapture', (e: FederatedPointerEvent) => {
      hop = e.currentTarget3D;
      target = e.target3D;
      phase = e.eventPhase;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(phase).toBe(1);
    expect(hop).toBe(group);
    expect(target).toBe(a);
  });

  test('at the target, currentTarget3D and target3D name the same node', () => {
    const { view3d, a } = makeScene();
    let hop: unknown = 'unset';
    let target: unknown = 'unset';
    a.on('pointerdown', (e) => {
      hop = e.currentTarget3D;
      target = e.target3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(hop).toBe(a);
    expect(target).toBe(a);
  });

  test('the enter/leave walks name the node being notified', () => {
    const { view3d, a, b } = makeScene();
    let enterHop: unknown = 'unset';
    let leaveHop: unknown = 'unset';
    a.on('pointerenter', (e) => {
      enterHop = e.currentTarget3D;
    });
    a.on('pointerleave', (e) => {
      leaveHop = e.currentTarget3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(enterHop).toBe(a);

    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(leaveHop).toBe(a);
  });

  test('the pointerupoutside reconciliation walk names the press-path node', () => {
    const { view3d, a, b } = makeScene();
    let hop: unknown = 'unset';
    a.on('pointerupoutside', (e) => {
      hop = e.currentTarget3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup'));

    expect(hop).toBe(a);
  });

  test('null outside the chain, both after the dispatch unwinds and once the pooled event is recycled', () => {
    const { view3d, a } = makeScene();
    let hop: unknown = 'unset';
    a.on('pointerdown', (e) => {
      hop = e.currentTarget3D;
    });

    const evt = makeEvent('pointerdown', { nativeEvent: {} });
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', evt);

    const e = evt as unknown as Pointer3DEvent;
    expect(hop).toBe(a);
    // The chain has unwound: target3D still answers the pick, but no listeners
    // are being notified any more.
    expect(e.target3D).toBe(a);
    expect(e.currentTarget3D).toBeNull();

    // Pixi recycles the pooled event object for an unrelated dispatch (a new
    // nativeEvent) that never crosses the View — the token guard answers null.
    (evt as unknown as { nativeEvent: unknown }).nativeEvent = {};
    expect(e.currentTarget3D).toBeNull();
  });

  test('the globalpointermove fan-out names each notified node', () => {
    const { view3d, a } = makeScene();
    let hop: unknown = 'unset';
    let target: unknown = 'unset';
    a.on('globalpointermove', (e) => {
      hop = e.currentTarget3D;
      target = e.target3D;
    });

    // A move through this View anchors the fan-out's fields; the shared native
    // event ties the two dispatches together (as pixi's broadcast does).
    const native = {};
    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove', { nativeEvent: native }));
    view3d.emit('globalpointermove', makeEvent('pointermove', { nativeEvent: native }));

    expect(hop).toBe(a);
    expect(target).toBe(a);
  });

  test('View-level listener typing carries the field without narrowing', () => {
    const { view3d } = makeScene();
    view3d.on('pointerdown', (e) => {
      expectTypeOf(e.currentTarget3D).toEqualTypeOf<Container3D | null>();
    });
    expect(view3d.listenerCount('pointerdown')).toBeGreaterThan(0);
  });
});
