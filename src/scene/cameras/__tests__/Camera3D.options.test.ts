import { afterEach, describe, expect, test } from 'vitest';

import { Camera3D } from '~/scene/cameras/Camera3D';

const DEFAULTS = { ...Camera3D.defaultOptions };

afterEach(() => {
  Camera3D.defaultOptions = { ...DEFAULTS };
});

describe('Camera3D options', () => {
  test('defaults to label Camera3D and the documented projection settings', () => {
    const camera = new Camera3D();

    expect(camera.label).toBe('Camera3D');
    expect(camera.mode).toBe('perspective');
    expect(camera.fov).toBe(60);
    expect(camera.zoom).toBe(1);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);
    expect(camera.orthographicSize).toBe(5);
  });

  test('forwards inherited Container3D options to the base', () => {
    const camera = new Camera3D({ label: 'main', position: { x: 1, y: 2, z: 3 }, eventMode: 'static', fov: 45 });

    expect(camera.label).toBe('main');
    expect(camera.position.z).toBe(3);
    expect(camera.eventMode).toBe('static');
    expect(camera.fov).toBe(45);
  });

  test('an explicit undefined keeps the default', () => {
    const camera = new Camera3D({ fov: undefined, far: undefined, label: undefined });

    expect(camera.fov).toBe(60);
    expect(camera.far).toBe(1000);
    expect(camera.label).toBe('Camera3D');
  });

  test('defaultOptions overrides reach the constructor', () => {
    Camera3D.defaultOptions.fov = 50;
    Camera3D.defaultOptions.far = 2000;

    const camera = new Camera3D();

    expect(camera.fov).toBe(50);
    expect(camera.far).toBe(2000);
  });

  test('usePerspective and useOrthographic fall back to defaultOptions', () => {
    Camera3D.defaultOptions.fov = 50;
    Camera3D.defaultOptions.near = 0.5;
    Camera3D.defaultOptions.far = 2000;
    Camera3D.defaultOptions.orthographicSize = 8;

    const camera = new Camera3D({ fov: 30, near: 1, far: 10, orthographicSize: 2 });

    camera.useOrthographic();
    expect(camera.mode).toBe('orthographic');
    expect(camera.orthographicSize).toBe(8);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(2000);

    camera.usePerspective();
    expect(camera.mode).toBe('perspective');
    expect(camera.fov).toBe(50);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(2000);
  });
});
