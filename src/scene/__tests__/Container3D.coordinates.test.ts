import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';

function expectVec3Close(actual: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
}

/**
 * A parent at (1, 2, 3) holding a child at (4, 5, 6), before any transform pass, so both cached
 * world matrices are identity
 */
function makeNested() {
  const parent = new Container3D();
  parent.position.set(1, 2, 3);

  const child = new Container3D();
  child.position.set(4, 5, 6);
  parent.addChild(child);

  return { parent, child };
}

describe('Container3D.getGlobalTransform', () => {
  test('resolves the world transform on demand, before any transform pass', () => {
    const { child } = makeNested();

    const world = child.getGlobalTransform();
    const pos = world.extractPosition(new Vector3());

    expectVec3Close(pos, 5, 7, 9);
  });

  test('skipUpdate = true copies the cached worldTransform, which no transform pass has filled yet', () => {
    const { child } = makeNested();

    const cached = child.getGlobalTransform(new Matrix4(), true);

    expect(cached.isIdentity()).toBe(true);
  });
});

describe('Container3D.toGlobal', () => {
  test('converts a local point to world space', () => {
    const { child } = makeNested();

    expectVec3Close(child.toGlobal({ x: 1, y: 1, z: 1 }), 6, 8, 10);
  });

  test('supports aliasing position as out', () => {
    const { child } = makeNested();
    const point = new Vector3(1, 1, 1);

    child.toGlobal(point, point);

    expectVec3Close(point, 6, 8, 10);
  });
});

describe('Container3D.toLocal', () => {
  test('round-trips with toGlobal under rotation and scale', () => {
    const parent = new Container3D();
    parent.rotation.set(0.4, -0.7, 0.2);
    parent.scale.set(2, 3, 0.5);
    parent.position.set(-4, 1, 8);

    const child = new Container3D();
    child.position.set(1, -2, 3);
    child.rotation.set(0, 1.1, 0);
    parent.addChild(child);

    const local = { x: 0.5, y: -1.5, z: 2 };
    const roundTripped = child.toLocal(child.toGlobal(local));

    expectVec3Close(roundTripped, local.x, local.y, local.z);
  });

  test("from converts out of another container’s space, here b's origin seen from a", () => {
    const parent = new Container3D();
    const a = new Container3D();
    a.position.set(10, 0, 0);
    const b = new Container3D();
    b.position.set(0, 5, 0);
    parent.addChild(a, b);

    expectVec3Close(a.toLocal({ x: 0, y: 0, z: 0 }, b), -10, 5, 0);
  });
});

describe('Container3D.getGlobalPosition', () => {
  test('matches parent.toGlobal(position)', () => {
    const { child } = makeNested();

    expectVec3Close(child.getGlobalPosition(), 5, 7, 9);
  });

  test('unparented container returns a copy of its local position', () => {
    const solo = new Container3D();
    solo.position.set(2, 4, 6);

    const pos = solo.getGlobalPosition();

    expectVec3Close(pos, 2, 4, 6);
    expect(pos).not.toBe(solo.position);
  });
});
