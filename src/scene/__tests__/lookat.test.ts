import { describe, expect, test } from 'vitest';

import { Quaternion } from '~/math/rotation/Quaternion';
import { Vector3 } from '~/math/vector/Vector3';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Container3D } from '~/scene/Container3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';

const EPS = 1e-5;

function expectVec3Close(actual: Vector3, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
}

/** Forward direction implied by a node's *world* rotation, given its forward axis. */
function worldForward(node: Container3D, axis: Vector3): Vector3 {
  // Combine parent's world rotation with this node's local rotation.
  const parentQuat = new Quaternion();
  if (node.parent) {
    parentQuat.setFromRotationMatrix(node.parent.worldTransform);
  }
  const q = node.quaternion;
  const worldQuat = new Quaternion(q.x, q.y, q.z, q.w).premultiply(parentQuat);

  return new Vector3().copyFrom(axis).applyQuaternion(worldQuat);
}

describe('Container3D.lookAt — convention', () => {
  test('mesh defaults to +Z forward', () => {
    const mesh = new Container3D();
    mesh.lookAt({ x: 1, y: 0, z: 0 });

    // Mesh's local +Z should now point at +X in world space.
    const forward = worldForward(mesh, new Vector3(0, 0, 1));
    expectVec3Close(forward, 1, 0, 0);
  });

  test('camera uses -Z forward', () => {
    const camera = new Camera3D();
    camera.lookAt({ x: 1, y: 0, z: 0 });

    // Camera's local -Z should now point at +X in world space.
    const forward = worldForward(camera, new Vector3(0, 0, -1));
    expectVec3Close(forward, 1, 0, 0);
  });

  test('directional light inherits camera-style -Z forward', () => {
    const light = new DirectionalLight();
    light.lookAt({ x: 0, y: 0, z: 1 });

    const forward = worldForward(light, new Vector3(0, 0, -1));
    expectVec3Close(forward, 0, 0, 1);
  });
});

describe('Container3D.lookAt — math', () => {
  test('camera at origin facing -Z target produces ~identity rotation', () => {
    const camera = new Camera3D();
    camera.lookAt({ x: 0, y: 0, z: -1 });

    expect(camera.quaternion.x).toBeCloseTo(0, 5);
    expect(camera.quaternion.y).toBeCloseTo(0, 5);
    expect(camera.quaternion.z).toBeCloseTo(0, 5);
    expect(Math.abs(camera.quaternion.w)).toBeCloseTo(1, 5);
  });

  test('PointData3D plain object accepted (not just Vector3 instance)', () => {
    const camera = new Camera3D();
    expect(() => camera.lookAt({ x: 1, y: 2, z: 3 })).not.toThrow();
  });

  test('custom up vector influences rotation', () => {
    const cam1 = new Camera3D();
    const cam2 = new Camera3D();
    cam1.position.set(0, 0, 5);
    cam2.position.set(0, 0, 5);

    cam1.lookAt({ x: 0, y: 0, z: 0 });
    cam2.lookAt({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

    // Different up vectors should produce different rotations even with the same target.
    const sameQuat =
      Math.abs(cam1.quaternion.x - cam2.quaternion.x) < EPS &&
      Math.abs(cam1.quaternion.y - cam2.quaternion.y) < EPS &&
      Math.abs(cam1.quaternion.z - cam2.quaternion.z) < EPS &&
      Math.abs(cam1.quaternion.w - cam2.quaternion.w) < EPS;
    expect(sameQuat).toBe(false);
  });
});

describe('Container3D.lookAt — origin', () => {
  test('aims from the fixed point, position + origin, not from position', () => {
    const mesh = new Container3D({ origin: { x: 1, y: 0, z: 0 } });

    // The fixed point sits at (1, 0, 0), so this target is straight down +Z from it.
    mesh.lookAt({ x: 1, y: 0, z: 5 });

    expect(mesh.quaternion.x).toBeCloseTo(0, 5);
    expect(mesh.quaternion.y).toBeCloseTo(0, 5);
    expect(mesh.quaternion.z).toBeCloseTo(0, 5);
    expect(Math.abs(mesh.quaternion.w)).toBeCloseTo(1, 5);
  });
});

describe('Container3D.lookAt — world→local conversion', () => {
  test('camera under a 180°-rotated parent looks at world target', () => {
    const parent = new Container3D();
    parent.rotation.y = Math.PI; // 180° around Y
    parent.updateLocalTransform();
    parent.worldTransform.copyFrom(parent.localTransform);

    const camera = new Camera3D();
    parent.addChild(camera);

    // Aim at world (0, 0, -1).
    camera.lookAt({ x: 0, y: 0, z: -1 });

    // Camera's *world* forward (-Z) should still point at (0, 0, -1) despite the
    // parent's flipped rotation. If lookAt skipped the world→local conversion,
    // the world forward would be (0, 0, +1) instead.
    const forward = worldForward(camera, new Vector3(0, 0, -1));
    expectVec3Close(forward, 0, 0, -1);
  });

  test('mesh under a 180°-rotated parent looks at world target', () => {
    const parent = new Container3D();
    parent.rotation.y = Math.PI;
    parent.updateLocalTransform();
    parent.worldTransform.copyFrom(parent.localTransform);

    const mesh = new Container3D();
    parent.addChild(mesh);

    mesh.lookAt({ x: 0, y: 0, z: -1 });

    const forward = worldForward(mesh, new Vector3(0, 0, 1));
    expectVec3Close(forward, 0, 0, -1);
  });
});

describe('Container3D.lookAt — stale parent', () => {
  test('uses freshly-set parent position even before cascade has run', () => {
    const parent = new Container3D();
    const camera = new Camera3D();
    parent.addChild(camera);

    // Move parent — marks dirty but cascade hasn't run.
    parent.position.set(5, 0, 0);
    expect(parent._worldTransformDirty).toBe(true);

    // Aim camera at world origin. Camera's world position is (5, 0, 0), so it should
    // look toward -X in world space.
    camera.lookAt({ x: 0, y: 0, z: 0 });

    // Manually compose parent's fresh world matrix to verify the camera's lookAt used it.
    parent.updateLocalTransform();
    parent.worldTransform.copyFrom(parent.localTransform);

    const forward = worldForward(camera, new Vector3(0, 0, -1));
    expectVec3Close(forward, -1, 0, 0);
  });
});
