import { FederatedPointerEvent, FederatedWheelEvent, Rectangle } from 'pixi.js';
import type { EventBoundary } from 'pixi.js';
import { describe, expect, test } from 'vitest';

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

const AT_A = { x: 31, y: 50 };
const AT_B = { x: 69, y: 50 };
const AT_EMPTY = { x: 50, y: 50 };

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

  return { view3d, group, a, b };
}

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

function makeNestedScene() {
  const view3d = new View3D({ ...SIZE });
  view3d.camera.position.set(0, 0, 10);

  const parent = makeCube();
  parent.position.set(-2, 0, 0);
  parent.interactive = true;
  const child = makeCube();
  child.position.set(4, 0, 0);
  child.interactive = true;
  parent.addChild(child);
  view3d.root.addChild(parent);
  tickPick(view3d);

  return { view3d, parent, child };
}

describe('View3D dispatcher — per-pointer independence', () => {
  test("two touches press and release independently — neither swallows the other's release", () => {
    const { view3d, a, b } = makeScene();
    const events: string[] = [];
    a.on('pointerdown', () => events.push('a-down'));
    b.on('pointerdown', () => events.push('b-down'));
    a.on('pointerupoutside', () => events.push('a-upoutside'));
    b.on('pointerup', () => events.push('b-up'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { pointerId: 1, pointerType: 'touch' }));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerdown', makeEvent('pointerdown', { pointerId: 2, pointerType: 'touch' }));

    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup', { pointerId: 2, pointerType: 'touch' }));

    view3d.emit('pointerout', makeEvent('pointerout', { pointerId: 1, pointerType: 'touch' }));
    view3d.emit('pointerupoutside', makeEvent('pointerupoutside', { pointerId: 1, pointerType: 'touch' }));

    expect(events).toEqual(['a-down', 'b-down', 'b-up', 'a-upoutside']);
  });

  test('interleaved moves from two pointers fire one pointerover each, and flushing one pointer leaves the other hovering', () => {
    const { view3d, a, b } = makeScene();
    let overA = 0;
    let outA = 0;
    let overB = 0;
    let outB = 0;
    a.on('pointerover', () => overA++);
    a.on('pointerout', () => outA++);
    b.on('pointerover', () => overB++);
    b.on('pointerout', () => outB++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerId: 1 }));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerId: 2 }));
    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerId: 1 }));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerId: 2 }));

    expect([overA, outA, overB, outB]).toEqual([1, 0, 1, 0]);

    view3d.emit('pointerout', makeEvent('pointerout', { pointerId: 1 }));
    expect(outA).toBe(1);
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerId: 2 }));
    expect(overB).toBe(1);
  });

  test('a right press during a held left drag reconciles on its own release, each button with its own upoutside alias', () => {
    const { view3d, a, b } = makeScene();
    let aUpOutside = 0;
    let aRightUpOutside = 0;
    let aMouseUpOutside = 0;
    let bUp = 0;
    a.on('pointerupoutside', () => aUpOutside++);
    a.on('rightupoutside', () => aRightUpOutside++);
    a.on('mouseupoutside', () => aMouseUpOutside++);
    b.on('pointerup', () => bUp++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { button: 0 }));
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { button: 2 }));

    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove'));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup', { button: 2 }));
    expect([aUpOutside, aRightUpOutside, aMouseUpOutside, bUp]).toEqual([1, 1, 0, 1]);

    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup', { button: 0 }));
    expect([aUpOutside, aRightUpOutside, aMouseUpOutside, bUp]).toEqual([2, 1, 1, 2]);
  });
});

describe('View3D dispatcher — in-view slide-off release', () => {
  test('B gets pointerup, A gets pointerupoutside, and the common ancestor, not B, gets the click and no upoutside; hit3D is B throughout', () => {
    const { view3d, group, a, b } = makeScene();
    let aUpOutside = 0;
    let aUpOutsideHit: unknown = 'unset';
    let groupUpOutside = 0;
    let bUp = 0;
    let aClick = 0;
    let bClick = 0;
    let groupClick = 0;
    let groupClickTarget: unknown = 'unset';
    let groupClickHit: unknown = 'unset';
    let groupClickDetail = -1;
    a.on('pointerupoutside', (e: Pointer3DEvent) => {
      aUpOutside++;
      aUpOutsideHit = e.hit3D?.target;
    });
    group.on('pointerupoutside', () => groupUpOutside++);
    b.on('pointerup', () => bUp++);
    a.on('click', () => aClick++);
    b.on('click', () => bClick++);
    group.on('click', (e: Pointer3DEvent) => {
      groupClick++;
      groupClickTarget = e.target3D;
      groupClickHit = e.hit3D?.target;
      groupClickDetail = e.detail;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove'));

    const nUp = {};
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    view3d.emit('click', makeEvent('click', { nativeEvent: nUp }));

    expect(bUp).toBe(1);
    expect(aUpOutside).toBe(1);
    expect(aUpOutsideHit).toBe(b);
    expect(groupUpOutside).toBe(0);
    expect(groupClick).toBe(1);
    expect(groupClickTarget).toBe(group);
    expect(groupClickHit).toBe(b);
    expect(groupClickDetail).toBe(1);
    expect(aClick).toBe(0);
    expect(bClick).toBe(0);
  });

  test('press == release stays a pass-through click on the target with surface data', () => {
    const { view3d, a } = makeScene();
    let aClick = 0;
    let clickDistance = Number.NaN;
    let clickTarget: unknown = 'unset';
    a.on('click', (e: Pointer3DEvent) => {
      aClick++;
      clickDistance = e.hit3D?.distance ?? -1;
      clickTarget = e.target3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    const nUp = {};
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    view3d.emit('click', makeEvent('click', { nativeEvent: nUp }));

    expect(aClick).toBe(1);
    expect(clickTarget).toBe(a);
    expect(clickDistance).toBeGreaterThan(0);
  });

  test('a press on empty viewport leaves the release node its pointerup but gives the click to the View, which reads target3D null', () => {
    const { view3d, b } = makeScene();
    let bUp = 0;
    let bClick = 0;
    b.on('pointerup', () => bUp++);
    b.on('click', () => bClick++);

    hitAt(view3d, AT_EMPTY, null);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));

    const nUp = {};
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    const clickEvt = makeEvent('click', { nativeEvent: nUp });
    view3d.emit('click', clickEvt);

    expect(bUp).toBe(1);
    expect(bClick).toBe(0);
    expect(clickEvt.target3D).toBeNull();
  });

  test('an off-View release carries the press target and no hit — not the last surface picked', () => {
    const { view3d, a, b } = makeScene();
    let target: unknown = 'unset';
    let hit: unknown = 'unset';
    a.on('pointerupoutside', (e: Pointer3DEvent) => {
      target = e.target3D;
      hit = e.hit3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove'));

    view3d.emit('pointerout', makeEvent('pointerout'));
    view3d.emit('pointerupoutside', makeEvent('pointerupoutside'));

    expect(target).toBe(a);
    expect(hit).toBeNull();
  });
});

describe('View3D dispatcher — detached press target (findMountedTarget parity)', () => {
  test('releasing after the pressed node was removed delivers pointerupoutside to its mounted parent', () => {
    const { view3d, group, a } = makeScene();
    let aUpOutside = 0;
    let groupUpOutside = 0;
    a.on('pointerupoutside', () => aUpOutside++);
    group.on('pointerupoutside', () => groupUpOutside++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    group.removeChild(a);

    view3d.emit('pointerout', makeEvent('pointerout'));
    view3d.emit('pointerupoutside', makeEvent('pointerupoutside'));

    expect(aUpOutside).toBe(0);
    expect(groupUpOutside).toBe(1);
  });

  test('an in-view release after the press target detached clicks its mounted ancestor, on the release chain, with no upoutside', () => {
    const { view3d, group, a, b } = makeScene();
    let groupClick = 0;
    let bClick = 0;
    let groupUpOutside = 0;
    group.on('click', () => groupClick++);
    b.on('click', () => bClick++);
    group.on('pointerupoutside', () => groupUpOutside++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    group.removeChild(a);

    const nUp = {};
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    view3d.emit('click', makeEvent('click', { nativeEvent: nUp }));

    expect(groupUpOutside).toBe(0);
    expect(groupClick).toBe(1);
    expect(bClick).toBe(0);
  });
});

describe('View3D dispatcher — multi-click detail per 3D target', () => {
  const PIXI_VIEW_CLICK_DETAIL = 7;

  function clickOn(view3d: View3D, point: { x: number; y: number }, node: Container3D): FederatedPointerEvent {
    hitAt(view3d, point, node);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    const nUp = {};
    hitAt(view3d, point, node);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    const clickEvt = makeEvent('click', { nativeEvent: nUp, detail: PIXI_VIEW_CLICK_DETAIL });
    view3d.emit('click', clickEvt);
    return clickEvt;
  }

  test("rapid same-target clicks increment detail; switching targets resets it; pixi's own count comes back after the 3D chain", () => {
    const { view3d, a, b } = makeScene();
    const aDetails: number[] = [];
    const bDetails: number[] = [];
    a.on('click', (e: Pointer3DEvent) => aDetails.push(e.detail));
    b.on('click', (e: Pointer3DEvent) => bDetails.push(e.detail));

    clickOn(view3d, AT_A, a);
    const secondClick = clickOn(view3d, AT_A, a);
    clickOn(view3d, AT_B, b);

    expect(aDetails).toEqual([1, 2]);
    expect(bDetails).toEqual([1]);
    expect(secondClick.detail).toBe(PIXI_VIEW_CLICK_DETAIL);
  });

  test('detail survives the pointerout that frees the record between taps, as on non-hover devices (2D parity)', () => {
    const { view3d, a } = makeScene();
    const details: number[] = [];
    a.on('click', (e: Pointer3DEvent) => details.push(e.detail));

    clickOn(view3d, AT_A, a);
    view3d.emit('pointerout', makeEvent('pointerout'));
    clickOn(view3d, AT_A, a);

    expect(details).toEqual([1, 2]);
  });

  test('pointertap shares the stashed per-target detail', () => {
    const { view3d, a } = makeScene();
    const tapDetails: number[] = [];
    a.on('pointertap', (e: Pointer3DEvent) => tapDetails.push(e.detail));

    clickOn(view3d, AT_A, a);
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    const nUp = {};
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    view3d.emit('pointertap', makeEvent('pointertap', { nativeEvent: nUp }));

    expect(tapDetails).toEqual([2]);
  });
});

describe('View3D dispatcher — hit3D.triangleIndex', () => {
  test("a 'geometry' hit delivers the struck triangle, matching raycast for the same ray", () => {
    const { view3d, a } = makeScene();
    a.hitVolume = 'geometry';
    let triangleIndex = Number.NaN;
    a.on('pointerdown', (e: Pointer3DEvent) => {
      triangleIndex = e.hit3D?.triangleIndex ?? Number.NaN;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));

    expect(triangleIndex).toBeGreaterThanOrEqual(0);
    expect(triangleIndex).toBe(view3d.raycast(AT_A)?.triangleIndex);
  });

  test('a viewport miss clears the hit off a reused pooled event, even under the same token', () => {
    const { view3d, a } = makeScene();
    a.hitVolume = 'geometry';
    const evt = makeEvent('pointermove', { nativeEvent: {} });
    const e = evt;

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', evt);
    expect(e.hit3D?.triangleIndex).toBeGreaterThanOrEqual(0);

    hitAt(view3d, AT_EMPTY, null);
    view3d.emit('pointermove', evt);
    expect(e.hit3D).toBeNull();
  });
});

describe('View3D dispatcher — hit3D is the pick under the pointer, whatever the dispatch is about', () => {
  test('pointerout on the node being left reports the node the pointer moved onto', () => {
    const { view3d, a, b } = makeScene();
    let outTarget: unknown = 'unset';
    let outHit: unknown = 'unset';
    a.on('pointerout', (e: Pointer3DEvent) => {
      outTarget = e.target3D;
      outHit = e.hit3D?.target;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove'));

    expect(outTarget).toBe(a);
    expect(outHit).toBe(b);
  });

  test('the View-exit pointerout carries no hit: pixi cast no ray for it', () => {
    const { view3d, a } = makeScene();
    let outHit: unknown = 'unset';
    a.on('pointerout', (e: Pointer3DEvent) => {
      outHit = e.hit3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));
    view3d.emit('pointerout', makeEvent('pointerout'));

    expect(outHit).toBeNull();
  });
});

describe('View3D dispatcher — stale 3D fields on pooled events (validity token)', () => {
  test('a recycled event with a new nativeEvent that skips the View reads as a miss', () => {
    const { view3d, a } = makeScene();
    a.hitVolume = 'geometry';

    const evt = makeEvent('pointerdown', { nativeEvent: {} });
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', evt);

    const e = evt;
    expect(e.target3D).toBe(a);
    expect(e.hit3D?.distance).toBeGreaterThan(0);
    expect(e.hit3D?.triangleIndex).toBeGreaterThanOrEqual(0);
    expect(e.hit3D?.point.z).toBeCloseTo(1, 2);

    (evt as unknown as { nativeEvent: unknown }).nativeEvent = {};
    expect(e.target3D).toBeNull();
    expect(e.hit3D).toBeNull();
  });
});

describe('View3D dispatcher — touch alias family', () => {
  test('touchstart / touchmove / touchend, re-emitted with the same pooled event, route through the pick under the alias type', () => {
    const { view3d, a } = makeScene();
    const types: string[] = [];
    a.on('touchstart', (e: Pointer3DEvent) => types.push(e.type));
    a.on('touchmove', (e: Pointer3DEvent) => types.push(e.type));
    a.on('touchend', (e: Pointer3DEvent) => types.push(e.type));

    hitAt(view3d, AT_A, a);
    const down = makeEvent('pointerdown', { pointerType: 'touch' });
    view3d.emit('pointerdown', down);
    view3d.emit('touchstart', down);

    hitAt(view3d, AT_A, a);
    const move = makeEvent('pointermove', { pointerType: 'touch' });
    view3d.emit('pointermove', move);
    view3d.emit('touchmove', move);

    hitAt(view3d, AT_A, a);
    const up = makeEvent('pointerup', { pointerType: 'touch' });
    view3d.emit('pointerup', up);
    view3d.emit('touchend', up);

    expect(types).toEqual(['touchstart', 'touchmove', 'touchend']);
  });

  test('a slide-off touch release interleaves touchendoutside and taps the common ancestor', () => {
    const { view3d, group, a, b } = makeScene();
    const releaseOrder: string[] = [];
    let groupTap = 0;
    let bTap = 0;
    a.on('pointerupoutside', () => releaseOrder.push('pointerupoutside'));
    a.on('touchendoutside', () => releaseOrder.push('touchendoutside'));
    group.on('tap', () => groupTap++);
    b.on('tap', () => bTap++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { pointerType: 'touch', nativeEvent: {} }));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerType: 'touch' }));

    const nUp = {};
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', makeEvent('pointerup', { pointerType: 'touch', nativeEvent: nUp }));
    view3d.emit('tap', makeEvent('tap', { pointerType: 'touch', nativeEvent: nUp }));

    expect(releaseOrder).toEqual(['pointerupoutside', 'touchendoutside']);
    expect(groupTap).toBe(1);
    expect(bTap).toBe(0);
  });
});

describe('View3D dispatcher — wheel', () => {
  test('wheel reaches the picked node; a miss still defines the fields', () => {
    const { view3d, a } = makeScene();
    let wheelCount = 0;
    let wheelType = '';
    let wheelTarget: unknown = 'unset';
    a.on('wheel', (e) => {
      wheelCount++;
      wheelType = e.type;
      wheelTarget = e.target3D;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('wheel', makeEvent('wheel') as unknown as FederatedWheelEvent);
    expect(wheelCount).toBe(1);
    expect(wheelType).toBe('wheel');
    expect(wheelTarget).toBe(a);

    hitAt(view3d, AT_EMPTY, null);
    const missEvt = makeEvent('wheel') as unknown as FederatedWheelEvent;
    view3d.emit('wheel', missEvt);
    expect(wheelCount).toBe(1);
    expect((missEvt as unknown as Pointer3DEvent).target3D).toBeNull();
  });
});

describe('View3D dispatcher — stopPropagation View silencing', () => {
  test('a stopped main 3D chain sets both propagation flags so pixi skips the rest of the View batch', () => {
    const { view3d, a } = makeScene();
    a.on('pointerdown', (e: FederatedPointerEvent) => {
      e.propagationStopped = true;
    });

    hitAt(view3d, AT_A, a);
    const evt = makeEvent('pointerdown');
    view3d.emit('pointerdown', evt);

    expect(evt.propagationStopped).toBe(true);
    expect(evt.propagationImmediatelyStopped).toBe(true);
  });

  test('a stop inside a synthesized pointerout chain neither skips the over chain nor leaks into the move dispatch', () => {
    const { view3d, a, b } = makeScene();
    let overB = 0;
    a.on('pointerout', (e: FederatedPointerEvent) => {
      e.propagationStopped = true;
    });
    b.on('pointerover', () => overB++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));

    hitAt(view3d, AT_B, b);
    const move = makeEvent('pointermove');
    view3d.emit('pointermove', move);

    expect(overB).toBe(1);
    expect(move.propagationStopped).toBe(false);
    expect(move.propagationImmediatelyStopped).toBe(false);
  });
});

describe('View3D dispatcher — capture phase', () => {
  test('capture runs root→target before bubble, with eventPhase maintained and restored', () => {
    const { view3d, group, a } = makeScene();
    const log: [string, number][] = [];
    group.on('pointerdowncapture', (e: FederatedPointerEvent) => log.push(['group-capture', e.eventPhase]));
    a.on('pointerdowncapture', (e: FederatedPointerEvent) => log.push(['a-capture', e.eventPhase]));
    a.on('pointerdown', (e: FederatedPointerEvent) => log.push(['a-plain', e.eventPhase]));
    group.on('pointerdown', (e: FederatedPointerEvent) => log.push(['group-plain', e.eventPhase]));

    hitAt(view3d, AT_A, a);
    const evt = makeEvent('pointerdown');
    view3d.emit('pointerdown', evt);

    expect(log).toEqual([
      ['group-capture', Event.CAPTURING_PHASE],
      ['a-capture', Event.AT_TARGET],
      ['a-plain', Event.AT_TARGET],
      ['group-plain', Event.BUBBLING_PHASE],
    ]);
    expect(evt.eventPhase).toBe(0);
  });

  test('stopPropagation in an ancestor capture listener silences the target entirely and, like a bubble-phase stop, the View batch', () => {
    const { view3d, group, a } = makeScene();
    const log: string[] = [];
    group.on('pointerdowncapture', (e: FederatedPointerEvent) => {
      log.push('group-capture');
      e.propagationStopped = true;
    });
    a.on('pointerdowncapture', () => log.push('a-capture'));
    a.on('pointerdown', () => log.push('a-plain'));
    group.on('pointerdown', () => log.push('group-plain'));

    hitAt(view3d, AT_A, a);
    const evt = makeEvent('pointerdown');
    view3d.emit('pointerdown', evt);

    expect(log).toEqual(['group-capture']);
    expect(evt.propagationStopped).toBe(true);
    expect(evt.propagationImmediatelyStopped).toBe(true);
  });

  test('the click chain runs a capture pass rooted at the reconciled target', () => {
    const { view3d, group, a } = makeScene();
    const log: string[] = [];
    group.on('clickcapture', () => log.push('group-capture'));
    a.on('click', () => log.push('a-plain'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    const nUp = {};
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    view3d.emit('click', makeEvent('click', { nativeEvent: nUp }));

    expect(log).toEqual(['group-capture', 'a-plain']);
  });
});

describe('View3D dispatcher — pointerenter / pointerleave', () => {
  test('moving parent → child fires pointerout on the parent but no leave, and enter on the child only', () => {
    const { view3d, parent, child } = makeNestedScene();
    let parentEnter = 0;
    let parentLeave = 0;
    let childEnter = 0;
    let parentOut = 0;
    parent.on('pointerenter', () => parentEnter++);
    parent.on('pointerleave', () => parentLeave++);
    child.on('pointerenter', () => childEnter++);
    parent.on('pointerout', () => parentOut++);

    hitAt(view3d, AT_A, parent);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect([parentEnter, childEnter]).toEqual([1, 0]);

    hitAt(view3d, AT_B, child);
    view3d.emit('pointermove', makeEvent('pointermove'));

    expect(parentOut).toBe(1);
    expect(parentLeave).toBe(0);
    expect(childEnter).toBe(1);
    expect(parentEnter).toBe(1);
  });

  test('moving child → parent fires leave on the child only, and no enter on the parent, an ancestor of the old target', () => {
    const { view3d, parent, child } = makeNestedScene();
    let parentEnter = 0;
    let childEnter = 0;
    let childLeave = 0;
    let parentLeave = 0;
    parent.on('pointerenter', () => parentEnter++);
    child.on('pointerenter', () => childEnter++);
    child.on('pointerleave', () => childLeave++);
    parent.on('pointerleave', () => parentLeave++);

    hitAt(view3d, AT_B, child);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect([childEnter, parentEnter]).toEqual([1, 1]);

    hitAt(view3d, AT_A, parent);
    view3d.emit('pointermove', makeEvent('pointermove'));

    expect(childLeave).toBe(1);
    expect(parentLeave).toBe(0);
    expect(parentEnter).toBe(1);
  });

  test('leave is notified at AT_TARGET so its capture listeners fire (2D quirk)', () => {
    const { view3d, a, b } = makeScene();
    const log: [string, number][] = [];
    a.on('pointerleavecapture', (e: FederatedPointerEvent) => log.push(['capture', e.eventPhase]));
    a.on('pointerleave', (e: FederatedPointerEvent) => log.push(['plain', e.eventPhase]));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove'));

    expect(log).toEqual([
      ['capture', 2],
      ['plain', 2],
    ]);
  });

  test("the View's incoming pointerover seeds hover, over then enter from target to root, so the next move fires nothing new", () => {
    const { view3d, group, a } = makeScene();
    const log: string[] = [];
    a.on('pointerover', () => log.push('a-over'));
    a.on('pointerenter', () => log.push('a-enter'));
    group.on('pointerenter', () => log.push('group-enter'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerover', makeEvent('pointerover'));

    expect(log).toEqual(['a-over', 'a-enter', 'group-enter']);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));
    expect(log).toEqual(['a-over', 'a-enter', 'group-enter']);
  });

  test('the View-exit flush emits leave up to the root', () => {
    const { view3d, group, a } = makeScene();
    const log: string[] = [];
    a.on('pointerout', () => log.push('a-out'));
    a.on('pointerleave', () => log.push('a-leave'));
    group.on('pointerleave', () => log.push('group-leave'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));
    view3d.emit('pointerout', makeEvent('pointerout'));

    expect(log).toEqual(['a-out', 'a-leave', 'group-leave']);
  });

  test("enter/leave target3D names the node being notified, then returns to the move's own pick", () => {
    const { view3d, group, a } = makeScene();
    const enterTargets: unknown[] = [];
    a.on('pointerenter', (e: Pointer3DEvent) => enterTargets.push(e.target3D));
    group.on('pointerenter', (e: Pointer3DEvent) => enterTargets.push(e.target3D));

    hitAt(view3d, AT_A, a);
    const move = makeEvent('pointermove');
    view3d.emit('pointermove', move);

    expect(enterTargets).toEqual([a, group]);
    expect(move.target3D).toBe(a);
  });
});

describe('View3D dispatcher — mouse hover aliases', () => {
  test('mouse pointers get mouseout/mouseover/mouseenter/mouseleave after each pointer chain', () => {
    const { view3d, a, b } = makeScene();
    const aLog: string[] = [];
    const bLog: string[] = [];
    a.on('pointerout', (e: Pointer3DEvent) => aLog.push(e.type));
    a.on('mouseout', (e: Pointer3DEvent) => aLog.push(e.type));
    a.on('pointerleave', (e: Pointer3DEvent) => aLog.push(e.type));
    a.on('mouseleave', (e: Pointer3DEvent) => aLog.push(e.type));
    b.on('pointerover', (e: Pointer3DEvent) => bLog.push(e.type));
    b.on('mouseover', (e: Pointer3DEvent) => bLog.push(e.type));
    b.on('pointerenter', (e: Pointer3DEvent) => bLog.push(e.type));
    b.on('mouseenter', (e: Pointer3DEvent) => bLog.push(e.type));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerType: 'mouse' }));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerType: 'mouse' }));

    expect(aLog).toEqual(['pointerout', 'mouseout', 'pointerleave', 'mouseleave']);
    expect(bLog).toEqual(['pointerover', 'mouseover', 'pointerenter', 'mouseenter']);
  });

  test('touch pointers get no mouse hover aliases', () => {
    const { view3d, a, b } = makeScene();
    let mouseEvents = 0;
    for (const type of ['mouseout', 'mouseover', 'mouseenter', 'mouseleave'] as const) {
      a.on(type, () => mouseEvents++);
      b.on(type, () => mouseEvents++);
    }
    let pointerOverB = 0;
    b.on('pointerover', () => pointerOverB++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerType: 'touch' }));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerType: 'touch' }));
    view3d.emit('pointerout', makeEvent('pointerout', { pointerType: 'touch' }));

    expect(pointerOverB).toBe(1);
    expect(mouseEvents).toBe(0);
  });

  test('the entry seed and exit flush carry the mouse aliases too', () => {
    const { view3d, a } = makeScene();
    const log: string[] = [];
    a.on('mouseover', () => log.push('mouseover'));
    a.on('mouseenter', () => log.push('mouseenter'));
    a.on('mouseout', () => log.push('mouseout'));
    a.on('mouseleave', () => log.push('mouseleave'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerover', makeEvent('pointerover', { pointerType: 'mouse' }));
    view3d.emit('pointerout', makeEvent('pointerout', { pointerType: 'mouse' }));

    expect(log).toEqual(['mouseover', 'mouseenter', 'mouseout', 'mouseleave']);
  });
});

describe('View3D dispatcher — on-handler properties', () => {
  test('on-handlers run before emitter listeners, and ancestors run in both capture and bubble (2D quirk)', () => {
    const { view3d, group, a } = makeScene();
    const log: string[] = [];
    group.onpointerdown = () => log.push('group-on');
    a.onpointerdown = () => log.push('a-on');
    group.on('pointerdowncapture', () => log.push('group-capture-listener'));
    a.on('pointerdown', () => log.push('a-listener'));
    group.on('pointerdown', () => log.push('group-listener'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(log).toEqual(['group-on', 'group-capture-listener', 'a-on', 'a-listener', 'group-on', 'group-listener']);
  });

  test('alias dispatches invoke their own on-handlers', () => {
    const { view3d, a } = makeScene();
    const log: string[] = [];
    a.onpointerdown = () => log.push('onpointerdown');
    a.onmousedown = () => log.push('onmousedown');

    hitAt(view3d, AT_A, a);
    const down = makeEvent('pointerdown');
    view3d.emit('pointerdown', down);
    view3d.emit('mousedown', down);

    expect(log).toEqual(['onpointerdown', 'onmousedown']);
  });
});

describe('View3D dispatcher — globalpointermove', () => {
  test('fans out once per interactive node in registration order, children before parents, alias interleaved per node, and restores the event type', () => {
    const { view3d, group, a, b } = makeScene();
    const log: string[] = [];
    a.on('globalpointermove', (e: Pointer3DEvent) => log.push(`a:${e.type}`));
    a.on('globaltouchmove', (e: Pointer3DEvent) => log.push(`a:${e.type}`));
    b.on('globalpointermove', () => log.push('b'));
    group.on('globalpointermove', () => log.push('group'));

    const move = makeEvent('pointermove', { pointerType: 'touch' });
    view3d.emit('globalpointermove', move);

    expect(log).toEqual(['a:globalpointermove', 'a:globaltouchmove', 'b', 'group']);
    expect(move.type).toBe('pointermove');
  });

  test('reuses the hit fields of the pointermove that shares its event; a move that never crossed the View reads a miss', () => {
    const { view3d, a } = makeScene();
    const targets: unknown[] = [];
    a.on('globalpointermove', (e: Pointer3DEvent) => targets.push(e.target3D));

    hitAt(view3d, AT_A, a);
    const move = makeEvent('pointermove', { nativeEvent: {} });
    view3d.emit('pointermove', move);
    view3d.emit('globalpointermove', move);

    view3d.emit('globalpointermove', makeEvent('pointermove', { nativeEvent: {} }));

    expect(targets).toEqual([a, null]);
  });

  test('enableGlobalMoveEvents = false gates the fan-out off', () => {
    const { view3d, a } = makeScene();
    let heard = 0;
    a.on('globalpointermove', () => heard++);

    view3d.events.enableGlobalMoveEvents = false;
    view3d.emit('globalpointermove', makeEvent('pointermove'));
    expect(heard).toBe(0);

    view3d.events.enableGlobalMoveEvents = true;
    view3d.emit('globalpointermove', makeEvent('pointermove'));
    expect(heard).toBe(1);
  });
});

describe("View3D dispatcher — eventMode 'auto'", () => {
  test("a hit on an auto child targets the interactive group, with surface data in the child's local space", () => {
    const { view3d, group, a } = makeScene();
    a.eventMode = 'auto';

    let target: unknown = 'unset';
    let hitTarget: unknown = 'unset';
    let localZ = Number.NaN;
    let distance = Number.NaN;
    let aHeard = 0;
    group.on('pointerdown', (e: Pointer3DEvent) => {
      target = e.target3D;
      hitTarget = e.hit3D?.target;
      localZ = e.hit3D?.localPoint.z ?? Number.NaN;
      distance = e.hit3D?.distance ?? Number.NaN;
    });
    a.on('pointerdown', () => aHeard++);

    hitAt(view3d, AT_A, group);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(target).toBe(group);
    expect(hitTarget).toBe(group);
    expect(aHeard).toBe(0);
    expect(distance).toBeGreaterThan(0);
    expect(localZ).toBeCloseTo(1, 2);
  });

  test('an auto node with no interactive ancestor is unhittable', () => {
    const { view3d, group, a } = makeScene();
    group.eventMode = 'passive';
    a.eventMode = 'auto';

    expect(view3d.containsPoint(AT_A)).toBe(true);
    expect(view3d.events._currentPick3D).toBeNull();
  });

  test('raycast reports the interactive ancestor for auto hits', () => {
    const { view3d, group, a } = makeScene();
    a.eventMode = 'auto';

    const hit = view3d.raycast({ x: AT_A.x, y: AT_A.y });
    expect(hit?.target).toBe(group);
    expect(hit?.distance).toBeGreaterThan(0);
  });

  test('the global-move fan-out skips auto nodes', () => {
    const { view3d, group, a } = makeScene();
    a.eventMode = 'auto';
    let aHeard = 0;
    let groupHeard = 0;
    a.on('globalpointermove', () => aHeard++);
    group.on('globalpointermove', () => groupHeard++);

    view3d.emit('globalpointermove', makeEvent('pointermove'));

    expect(aHeard).toBe(0);
    expect(groupHeard).toBe(1);
  });

  test('an alias-only listener is still reached by the fan-out (deaf-node probe)', () => {
    const { view3d, a } = makeScene();
    let heard = 0;
    a.on('globalmousemove', () => heard++);

    view3d.emit('globalpointermove', makeEvent('pointermove', { pointerType: 'mouse' }));

    expect(heard).toBe(1);
  });

  test("another View's pick never leaks into this View's fan-out fields, and the picking View, notified second, still reads its own", () => {
    const s1 = makeScene();
    const s2 = makeScene();
    const s1Targets: unknown[] = [];
    const s2Targets: unknown[] = [];
    s1.a.on('globalpointermove', (e: Pointer3DEvent) => s1Targets.push(e.target3D));
    s2.a.on('globalpointermove', (e: Pointer3DEvent) => s2Targets.push(e.target3D));

    hitAt(s1.view3d, AT_A, s1.a);
    const move = makeEvent('pointermove', { nativeEvent: {} });
    s1.view3d.emit('pointermove', move);
    s2.view3d.emit('globalpointermove', move);
    s1.view3d.emit('globalpointermove', move);

    expect(s2Targets).toEqual([null]);
    expect(s1Targets).toEqual([s1.a]);
  });
});

describe('View3D dispatcher — stopImmediatePropagation between same-node listeners', () => {
  test('the second same-node listener is skipped after an immediate stop, and the bubble is halted', () => {
    const { view3d, group, a } = makeScene();
    const log: string[] = [];
    a.on('pointerdown', (e: FederatedPointerEvent) => {
      log.push('first');
      e.propagationImmediatelyStopped = true;
    });
    a.on('pointerdown', () => log.push('second'));
    group.on('pointerdown', () => log.push('group'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(log).toEqual(['first']);
  });

  test('an at-target capture-set stop mutes a multi-listener plain set but not a lone plain listener (2D fast path)', () => {
    const { view3d, a, b } = makeScene();
    const log: string[] = [];
    a.on('pointerdowncapture', (e: FederatedPointerEvent) => {
      e.propagationImmediatelyStopped = true;
    });
    a.on('pointerdown', () => log.push('a-lone'));
    b.on('pointerdowncapture', (e: FederatedPointerEvent) => {
      e.propagationImmediatelyStopped = true;
    });
    b.on('pointerdown', () => log.push('b-1'));
    b.on('pointerdown', () => log.push('b-2'));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(log).toEqual(['a-lone']);
  });

  test('once listeners are removed before invocation and fire exactly once', () => {
    const { view3d, a } = makeScene();
    let heard = 0;
    a.once('pointerdown', () => heard++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown'));

    expect(heard).toBe(1);
  });
});

describe('View3D dispatcher — release chain frozen at pointerup', () => {
  test('a pointerup listener detaching the target cannot spawn a phantom upoutside: the frozen chain bubbles the up and clicks the group', () => {
    const { view3d, group, a } = makeScene();
    let upOutside = 0;
    let groupUp = 0;
    let groupClick = 0;
    a.on('pointerup', () => group.removeChild(a));
    group.on('pointerup', () => groupUp++);
    a.on('pointerupoutside', () => upOutside++);
    group.on('pointerupoutside', () => upOutside++);
    group.on('click', () => groupClick++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { nativeEvent: {} }));
    const nUp = {};
    hitAt(view3d, AT_A, a);
    view3d.emit('pointerup', makeEvent('pointerup', { nativeEvent: nUp }));
    view3d.emit('click', makeEvent('click', { nativeEvent: nUp }));

    expect(groupUp).toBe(1);
    expect(upOutside).toBe(0);
    expect(groupClick).toBe(1);
  });
});

describe('View3D dispatcher — View-entry/exit hover chains honor 3D stops', () => {
  test('a stop in the entry pointerover chain silences the View batch', () => {
    const { view3d, a } = makeScene();
    a.on('pointerover', (e: FederatedPointerEvent) => {
      e.propagationStopped = true;
    });

    hitAt(view3d, AT_A, a);
    const evt = makeEvent('pointerover');
    view3d.emit('pointerover', evt);

    expect(evt.propagationStopped).toBe(true);
    expect(evt.propagationImmediatelyStopped).toBe(true);
  });

  test('a stop in the exit pointerout chain silences the View batch', () => {
    const { view3d, a } = makeScene();
    a.on('pointerout', (e: FederatedPointerEvent) => {
      e.propagationStopped = true;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove'));

    const evt = makeEvent('pointerout');
    view3d.emit('pointerout', evt);

    expect(evt.propagationStopped).toBe(true);
    expect(evt.propagationImmediatelyStopped).toBe(true);
  });

  test('stops in the mouse alias or the leave walk do not silence the View', () => {
    const { view3d, a } = makeScene();
    a.on('mouseout', (e: FederatedPointerEvent) => {
      e.propagationStopped = true;
    });
    a.on('pointerleave', (e: FederatedPointerEvent) => {
      e.propagationStopped = true;
    });

    hitAt(view3d, AT_A, a);
    view3d.emit('pointermove', makeEvent('pointermove', { pointerType: 'mouse' }));
    const evt = makeEvent('pointerout', { pointerType: 'mouse' });
    view3d.emit('pointerout', evt);

    expect(evt.propagationStopped).toBe(false);
    expect(evt.propagationImmediatelyStopped).toBe(false);
  });
});

describe('View3D dispatcher — slide-off release ordering (documented divergence)', () => {
  test('the legacy up alias lands after the upoutside walk, where 2D sends it before', () => {
    const { view3d, a, b } = makeScene();
    const order: string[] = [];
    b.on('pointerup', () => order.push('b-pointerup'));
    b.on('mouseup', () => order.push('b-mouseup'));
    a.on('pointerupoutside', () => order.push('a-pointerupoutside'));
    a.on('mouseupoutside', () => order.push('a-mouseupoutside'));

    hitAt(view3d, AT_A, a);
    const down = makeEvent('pointerdown');
    view3d.emit('pointerdown', down);
    view3d.emit('mousedown', down);

    const up = makeEvent('pointerup');
    hitAt(view3d, AT_B, b);
    view3d.emit('pointerup', up);
    view3d.emit('mouseup', up);

    expect(order).toEqual(['b-pointerup', 'a-pointerupoutside', 'a-mouseupoutside', 'b-mouseup']);
  });
});

describe('View3D dispatcher — orphaned pointer record sweep after 60 s idle', () => {
  test('a held press abandoned after pointerout is reclaimed when a new pointer appears after the stale window', () => {
    const { view3d, a } = makeScene();
    let upOutside = 0;
    a.on('pointerupoutside', () => upOutside++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { pointerId: 1, pointerType: 'touch', timeStamp: 1_000 }));
    view3d.emit('pointerout', makeEvent('pointerout', { pointerId: 1, pointerType: 'touch', timeStamp: 1_000 }));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { pointerId: 2, pointerType: 'touch', timeStamp: 61_000 }));

    view3d.emit('pointerupoutside', makeEvent('pointerupoutside', { pointerId: 1, pointerType: 'touch' }));
    expect(upOutside).toBe(0);
  });

  test('a live held press within the window survives new-pointer sweeps', () => {
    const { view3d, a } = makeScene();
    let upOutside = 0;
    a.on('pointerupoutside', () => upOutside++);

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { pointerId: 1, pointerType: 'touch', timeStamp: 1_000 }));
    view3d.emit('pointerout', makeEvent('pointerout', { pointerId: 1, pointerType: 'touch', timeStamp: 1_000 }));

    hitAt(view3d, AT_A, a);
    view3d.emit('pointerdown', makeEvent('pointerdown', { pointerId: 2, pointerType: 'touch', timeStamp: 30_000 }));

    view3d.emit(
      'pointerupoutside',
      makeEvent('pointerupoutside', { pointerId: 1, pointerType: 'touch', timeStamp: 30_000 }),
    );
    expect(upOutside).toBe(1);
  });
});

describe('3D fields on events that never crossed a View3D', () => {
  test('pointer and wheel events answer the documented miss instead of undefined', () => {
    const pointer = new FederatedPointerEvent(null as unknown as EventBoundary);
    expect(pointer.target3D).toBeNull();
    expect(pointer.currentTarget3D).toBeNull();
    expect(pointer.hit3D).toBeNull();

    const wheel = new FederatedWheelEvent(null as unknown as EventBoundary) as unknown as Pointer3DEvent;
    expect(wheel.target3D).toBeNull();
    expect(wheel.hit3D).toBeNull();
  });
});
