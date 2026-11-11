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

const AT_A = { x: 31, y: 50 };
const AT_B = { x: 69, y: 50 };

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

  test('release after reparenting the pressed node: no upoutside, and the click re-roots at its still-mounted old parent', () => {
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

    expect(upPath).toEqual([view3d.root, group, b]);
    expect(upOutsideFired).toBe(false);
    expect(up.path).toBe(beforeUp);

    const click = makeEvent(boundary, 'click', { nativeEvent: nUp });
    view3d.emit('click', click);
    expect(clickPath).toEqual([view3d.root, group]);
    expect(click.path).toBe(beforeUp);
  });

  test('upoutside walk: composedPath() resolves from the press target, nothing leaks after', () => {
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

describe('contextmenu through the real boundary', () => {
  function contextMenuAt(boundary: EventBoundary, point: { x: number; y: number }): MouseEvent {
    const nativeEvent = new MouseEvent('contextmenu', { cancelable: true });
    const from = makeEvent(boundary, 'contextmenu', { button: 2, nativeEvent });

    from.global.set(point.x, point.y);
    boundary.mapEvent(from);

    return nativeEvent;
  }

  test('reaches the picked node with its hit, and preventDefault there keeps the menu closed', () => {
    const { view3d, a, boundary } = makeScene();
    let target: Container3D | null = null;
    let hit = false;
    a.on('contextmenu', (event) => {
      target = event.target3D;
      hit = event.hit3D !== null;
      event.preventDefault();
    });

    hitAt(boundary, view3d, AT_A, a);
    const nativeEvent = contextMenuAt(boundary, AT_A);

    expect(target).toBe(a);
    expect(hit).toBe(true);
    expect(nativeEvent.defaultPrevented).toBe(true);
  });

  test("stopPropagation on the node keeps the View's own listener silent", () => {
    const { view3d, a, boundary } = makeScene();
    let viewHeard = false;
    a.on('contextmenu', (event) => event.stopPropagation());
    view3d.on('contextmenu', () => {
      viewHeard = true;
    });

    hitAt(boundary, view3d, AT_A, a);
    contextMenuAt(boundary, AT_A);

    expect(viewHeard).toBe(false);
  });
});
