// Load pixi's 2D events mixin (isInteractive etc.) — normally installed lazily at Application.init,
// which these tests never run; without it `EventBoundary.hitTest` throws.
import 'pixi.js/browser';
import { Container, EventBoundary, FederatedPointerEvent, Rectangle } from 'pixi.js';
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

// Two sibling cubes under an interactive group, and pixi's REAL EventBoundary
// over a 2D root holding the View — real pooled events need a real boundary
// behind `composedPath()`.
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

  const root = new Container();
  root.addChild(view3d);
  const boundary = new EventBoundary(root);

  return { view3d, group, a, b, boundary };
}

// Hit test through the boundary the way pixi does before every dispatch,
// asserting the pick landed where the test intends so probe drift fails loudly.
function hitAt(boundary: EventBoundary, view3d: View3D, point: { x: number; y: number }, expected: Container3D): void {
  expect(boundary.hitTest(point.x, point.y)).toBe(view3d);
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

// A REAL pooled-event stand-in: `composedPath()` needs `manager`, so the synthetic
// object literals other dispatcher tests use would throw here. The dispatcher
// itself only reads the fields set below.
function makeEvent(boundary: EventBoundary, type: string, init: EventInit3D = {}): FederatedPointerEvent {
  const event = new FederatedPointerEvent(boundary);
  event.type = type;
  event.pointerId = init.pointerId ?? 1;
  event.button = init.button ?? 0;
  event.pointerType = init.pointerType ?? 'mouse';
  event.nativeEvent = (init.nativeEvent ?? {}) as PointerEvent;
  event.detail = init.detail ?? 0;
  event.timeStamp = init.timeStamp ?? 0;
  return event;
}

// `composedPath()` is typed against 2D Containers; during a 3D chain it carries
// Container3D entries.
function composed3D(event: FederatedPointerEvent): Container3D[] {
  return event.composedPath() as unknown as Container3D[];
}

describe('View-level listener order around the 3D dispatch (pixi notify order)', () => {
  test("the View's on-handler and capture listener run before the 3D dispatch and read a miss; a plain listener reads the hit", () => {
    const { view3d, a, boundary } = makeScene();
    const seen: Record<string, Container3D | null> = {};
    view3d.onpointerdown = (event) => {
      seen.onHandler = event.target3D;
    };
    view3d.on('pointerdowncapture', (event) => {
      seen.capture = event.target3D;
    });
    view3d.on('pointerdown', (event) => {
      seen.plain = event.target3D;
    });

    hitAt(boundary, view3d, AT_A, a);
    const event = makeEvent(boundary, 'pointerdown');
    event.target = view3d;
    boundary.dispatchEvent(event, 'pointerdown');

    expect(seen.onHandler).toBeNull();
    expect(seen.capture).toBeNull();
    expect(seen.plain).toBe(a);
  });
});

describe('event.path during 3D dispatch', () => {
  test('composedPath() in all three phases returns the same frozen [root3D, group, mesh] array', () => {
    const { view3d, group, a, boundary } = makeScene();
    const refs: Container3D[][] = [];
    const copies: Container3D[][] = [];
    const record = (event: FederatedPointerEvent): void => {
      const path = composed3D(event);
      refs.push(path);
      copies.push(path.slice());
    };
    group.on('pointerdowncapture', record);
    a.on('pointerdown', record);
    group.on('pointerdown', record);

    hitAt(boundary, view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent(boundary, 'pointerdown'));

    expect(refs.length).toBe(3);
    expect(refs[1]).toBe(refs[0]);
    expect(refs[2]).toBe(refs[0]);
    // Contents asserted from copies: the pooled array is cleared once the dispatch ends.
    for (const copy of copies) {
      expect(copy.length).toBe(3);
      expect(copy[0]).toBe(view3d.root);
      expect(copy[1]).toBe(group);
      expect(copy[2]).toBe(a);
    }
  });

  test('a mid-dispatch reparent does not change composedPath()', () => {
    const { view3d, group, a, boundary } = makeScene();
    let atTarget: Container3D[] = [];
    group.on('pointerdowncapture', () => view3d.root.addChild(a));
    a.on('pointerdown', (event) => {
      atTarget = composed3D(event).slice();
    });

    hitAt(boundary, view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent(boundary, 'pointerdown'));

    expect(a.parent).toBe(view3d.root);
    expect(atTarget.length).toBe(3);
    expect(atTarget[0]).toBe(view3d.root);
    expect(atTarget[1]).toBe(group);
    expect(atTarget[2]).toBe(a);
  });

  test('event.path is restored after the dispatch — no pooled 3D array left installed', () => {
    const { view3d, a, boundary } = makeScene();
    a.on('pointerdown', (event) => {
      // Force the install to be observed (and would-be caching to happen).
      event.composedPath();
    });

    hitAt(boundary, view3d, AT_A, a);
    const event = makeEvent(boundary, 'pointerdown');
    const before = event.path;
    view3d.emit('pointerdown', event);

    expect(event.path).toBe(before);
  });

  test('release after a reparent: frozen pointerup chain, click re-rooted at the mounted press target', () => {
    const { view3d, group, a, b, boundary } = makeScene();
    let upPath: Container3D[] = [];
    let upOutsideFired = false;
    let clickPath: Container3D[] = [];
    b.on('pointerup', (event) => {
      upPath = composed3D(event).slice();
    });
    a.on('pointerupoutside', () => {
      upOutsideFired = true;
    });
    group.on('click', (event) => {
      clickPath = composed3D(event).slice();
    });

    hitAt(boundary, view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent(boundary, 'pointerdown', { nativeEvent: {} }));
    view3d.root.addChild(a);
    const nUp = {};
    hitAt(boundary, view3d, AT_B, b);
    const up = makeEvent(boundary, 'pointerup', { nativeEvent: nUp });
    const beforeUp = up.path;
    view3d.emit('pointerup', up);

    // The pointerup chain froze the release path before any listener ran.
    expect(upPath).toEqual([view3d.root, group, b]);
    // The reparent broke the stored press path at `a`, so the mounted press target
    // is `group` — which is on the release chain: no upoutside walk runs.
    expect(upOutsideFired).toBe(false);
    expect(up.path).toBe(beforeUp);

    // The click re-roots at that mounted press target, and its chain dispatch
    // freezes the target's own path.
    const click = makeEvent(boundary, 'click', { nativeEvent: nUp });
    view3d.emit('click', click);
    expect(clickPath).toEqual([view3d.root, group]);
    expect(click.path).toBe(beforeUp);
  });

  test('upoutside walk: composedPath() resolves from the walk target, nothing leaks after', () => {
    const { view3d, group, a, b, boundary } = makeScene();
    let upOutsidePath: Container3D[] = [];
    a.on('pointerupoutside', (event) => {
      upOutsidePath = composed3D(event).slice();
    });

    hitAt(boundary, view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent(boundary, 'pointerdown', { nativeEvent: {} }));
    hitAt(boundary, view3d, AT_B, b);
    const up = makeEvent(boundary, 'pointerup', { nativeEvent: {} });
    const beforeUp = up.path;
    view3d.emit('pointerup', up);

    // Each walked node is its own target, so composedPath() recomputes the press
    // target's ancestry live (2D parity) rather than reading a frozen chain.
    expect(upOutsidePath).toEqual([view3d.root, group, a]);
    expect(up.path).toBe(beforeUp);
  });

  test('enter walk: live recompute inside the listener, event.path restored after', () => {
    const { view3d, group, a, boundary } = makeScene();
    let enterPath: Container3D[] = [];
    a.on('pointerenter', (event) => {
      enterPath = composed3D(event).slice();
    });

    hitAt(boundary, view3d, AT_A, a);
    const move = makeEvent(boundary, 'pointermove');
    const before = move.path;
    view3d.emit('pointermove', move);

    expect(enterPath).toEqual([view3d.root, group, a]);
    expect(move.path).toBe(before);
  });
});
