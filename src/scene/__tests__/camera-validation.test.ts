import { describe, expect, test } from 'vitest';

import { validateCamera } from '~/core/validateCamera';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Container3D } from '~/scene/Container3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };

describe('View3D.camera setter', () => {
  test('default constructor auto-creates and attaches a camera', () => {
    const view3d = new View3D({ ...SIZE });

    expect(view3d.camera).toBeInstanceOf(Camera3D);
    expect(view3d.camera.parent).toBe(view3d.root);
    expect(view3d.camera.view3d).toBe(view3d);
  });

  test('orphaned camera supplied to constructor is auto-attached', () => {
    const camera = new Camera3D();
    const view3d = new View3D({ ...SIZE, camera });

    expect(view3d.camera).toBe(camera);
    expect(camera.parent).toBe(view3d.root);
    expect(camera.view3d).toBe(view3d);
  });

  test('camera pre-attached to the supplied root is not re-added', () => {
    const root = new Container3D();
    const camera = new Camera3D();
    root.addChild(camera);

    const view3d = new View3D({ ...SIZE, root, camera });

    expect(camera.parent).toBe(root);
    expect(camera.view3d).toBe(view3d);
    expect(root.children.filter((c) => c === camera)).toHaveLength(1);
  });

  test('camera parented in a tree outside this View3D throws', () => {
    const stray = new Container3D();
    const camera = new Camera3D();
    stray.addChild(camera);

    expect(() => new View3D({ ...SIZE, camera })).toThrow(/isn't in this View3D's scene graph/);
  });

  test('reassigning the same camera reference is a no-op', () => {
    const view3d = new View3D({ ...SIZE });
    const camera = view3d.camera;
    const originalChildCount = view3d.root.children.length;

    view3d.camera = camera;

    expect(view3d.camera).toBe(camera);
    expect(view3d.root.children.length).toBe(originalChildCount);
  });

  test('reassigning to a new orphaned camera attaches it without detaching the old', () => {
    const view3d = new View3D({ ...SIZE });
    const oldCamera = view3d.camera;
    const newCamera = new Camera3D();

    view3d.camera = newCamera;

    expect(view3d.camera).toBe(newCamera);
    expect(newCamera.parent).toBe(view3d.root);
    expect(newCamera.view3d).toBe(view3d);
    expect(oldCamera.parent).toBe(view3d.root);
  });

  test('assigning a camera that lives deeper in the View3D tree is allowed', () => {
    const view3d = new View3D({ ...SIZE });
    const rig = new Container3D();
    view3d.root.addChild(rig);

    const newCamera = new Camera3D();
    rig.addChild(newCamera);

    view3d.camera = newCamera;

    expect(view3d.camera).toBe(newCamera);
    expect(newCamera.parent).toBe(rig);
  });
});

describe('validateCamera render-time check', () => {
  test('throws when camera.visible is false', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.visible = false;

    expect(() => validateCamera(view3d)).toThrow(/hidden/);
  });

  test('throws when an ancestor of the camera is hidden (issue #95 repro)', () => {
    const view3d = new View3D({ ...SIZE });
    // Pull the default camera out and parent it under a hidden rig.
    view3d.root.removeChild(view3d.camera);

    const rig = new Container3D();
    view3d.root.addChild(rig);
    rig.addChild(view3d.camera);
    rig.visible = false;

    updateView3DTransforms(view3d);
    expect(view3d.camera.worldVisible).toBe(0);

    expect(() => validateCamera(view3d)).toThrow(/hidden/);
  });

  test('throws when an assigned camera is later removed from the graph', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.root.removeChild(view3d.camera);

    expect(() => validateCamera(view3d)).toThrow(/no longer in the View3D scene graph/);
  });
});
