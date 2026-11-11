import { describe, expect, test } from 'vitest';

import { Quaternion } from '~/math/rotation/Quaternion';
import { Vector3 } from '~/math/vector/Vector3';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Container3D } from '~/scene/Container3D';

const EPS = 1e-5;

function expectVec3Close(actual: Vector3, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
}

function worldForward(node: Container3D, axis: Vector3): Vector3 {
  const parentQuat = new Quaternion();
  if (node.parent) {
    parentQuat.setFromRotationMatrix(node.parent.worldTransform);
  }
  const q = node.quaternion;
  const worldQuat = new Quaternion(q.x, q.y, q.z, q.w).premultiply(parentQuat);

  return new Vector3().copyFrom(axis).applyQuaternion(worldQuat);
}

function updateRootWorldTransform(node: Container3D): void {
  node.updateLocalTransform();
  node.worldTransform.copyFrom(node.localTransform);
}

describe('Container3D.lookAt — convention', () => {
  test('mesh defaults to +Z forward', () => {
    const mesh = new Container3D();
    mesh.lookAt({ x: 1, y: 0, z: 0 });

    const forward = worldForward(mesh, new Vector3(0, 0, 1));
    expectVec3Close(forward, 1, 0, 0);
  });
});

describe('Container3D.lookAt — math', () => {
  test('custom up vector influences rotation', () => {
    const cam1 = new Camera3D();
    const cam2 = new Camera3D();
    cam1.position.set(0, 0, 5);
    cam2.position.set(0, 0, 5);

    cam1.lookAt({ x: 0, y: 0, z: 0 });
    cam2.lookAt({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

    const sameQuat =
      Math.abs(cam1.quaternion.x - cam2.quaternion.x) < EPS &&
      Math.abs(cam1.quaternion.y - cam2.quaternion.y) < EPS &&
      Math.abs(cam1.quaternion.z - cam2.quaternion.z) < EPS &&
      Math.abs(cam1.quaternion.w - cam2.quaternion.w) < EPS;
    expect(sameQuat).toBe(false);
  });
});

describe('Container3D.lookAt — origin', () => {
  test('aims from position + origin, so a target straight down +Z from that point needs no rotation', () => {
    const mesh = new Container3D({ origin: { x: 1, y: 0, z: 0 } });

    mesh.lookAt({ x: 1, y: 0, z: 5 });

    expect(mesh.quaternion.x).toBeCloseTo(0, 5);
    expect(mesh.quaternion.y).toBeCloseTo(0, 5);
    expect(mesh.quaternion.z).toBeCloseTo(0, 5);
    expect(Math.abs(mesh.quaternion.w)).toBeCloseTo(1, 5);
  });
});

describe('Container3D.lookAt — world→local conversion', () => {
  test('camera under a parent turned 180° about Y faces the world target, not its mirror image', () => {
    const parent = new Container3D();
    parent.rotation.y = Math.PI;
    updateRootWorldTransform(parent);

    const camera = new Camera3D();
    parent.addChild(camera);

    camera.lookAt({ x: 0, y: 0, z: -1 });

    const forward = worldForward(camera, new Vector3(0, 0, -1));
    expectVec3Close(forward, 0, 0, -1);
  });
});

describe('Container3D.lookAt — stale parent', () => {
  test('uses freshly-set parent position even before cascade has run', () => {
    const parent = new Container3D();
    const camera = new Camera3D();
    parent.addChild(camera);

    parent.position.set(5, 0, 0);
    expect(parent._worldTransformDirty).toBe(true);

    camera.lookAt({ x: 0, y: 0, z: 0 });

    updateRootWorldTransform(parent);

    const forward = worldForward(camera, new Vector3(0, 0, -1));
    expectVec3Close(forward, -1, 0, 0);
  });
});
