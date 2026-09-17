import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';

function expectVec3Close(actual: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
}

/** parent(1,2,3) → child(4,5,6), no transform pass run — everything resolves on demand. */
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

  test('writes into the supplied matrix and returns it', () => {
    const { child } = makeNested();
    const out = new Matrix4();

    expect(child.getGlobalTransform(out)).toBe(out);
  });

  test('skipUpdate = true copies the cached worldTransform', () => {
    const { child } = makeNested();

    // No transform pass has run, so the cached matrix is still identity.
    const cached = child.getGlobalTransform(new Matrix4(), true);

    expect(cached.isIdentity()).toBe(true);
  });

  test('includes ancestor rotation and scale', () => {
    const parent = new Container3D();
    parent.rotation.set(0, Math.PI / 2, 0);
    parent.scale.set(2);

    const child = new Container3D();
    child.position.set(1, 0, 0);
    parent.addChild(child);

    const pos = child.getGlobalTransform().extractPosition(new Vector3());

    // (1,0,0) scaled to (2,0,0), then rotated +90° about Y → (0,0,-2).
    expectVec3Close(pos, 0, 0, -2);
  });
});

describe('Container3D.toGlobal', () => {
  test('converts a local point to world space', () => {
    const { child } = makeNested();

    expectVec3Close(child.toGlobal({ x: 1, y: 1, z: 1 }), 6, 8, 10);
  });

  test('applies ancestor rotation to the point', () => {
    const parent = new Container3D();
    parent.rotation.set(0, Math.PI / 2, 0);

    const child = new Container3D();
    parent.addChild(child);

    // +90° about Y sends +X to -Z.
    expectVec3Close(child.toGlobal({ x: 1, y: 0, z: 0 }), 0, 0, -1);
  });

  test('allocates a Vector3 when out is omitted, writes into out when supplied', () => {
    const { child } = makeNested();

    const fresh = child.toGlobal({ x: 0, y: 0, z: 0 });
    expect(fresh).toBeInstanceOf(Vector3);

    const out = new Vector3();
    expect(child.toGlobal({ x: 0, y: 0, z: 0 }, out)).toBe(out);
    expectVec3Close(out, 5, 7, 9);
  });

  test('supports aliasing position as out', () => {
    const { child } = makeNested();
    const point = new Vector3(1, 1, 1);

    child.toGlobal(point, point);

    expectVec3Close(point, 6, 8, 10);
  });
});

describe('Container3D.toLocal', () => {
  test('converts a world point into local space (inverse of toGlobal)', () => {
    const { child } = makeNested();

    expectVec3Close(child.toLocal({ x: 5, y: 7, z: 9 }), 0, 0, 0);
  });

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

  test('from converts out of another container’s space', () => {
    const parent = new Container3D();
    const a = new Container3D();
    a.position.set(10, 0, 0);
    const b = new Container3D();
    b.position.set(0, 5, 0);
    parent.addChild(a, b);

    // b's origin, seen from a's local space.
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
