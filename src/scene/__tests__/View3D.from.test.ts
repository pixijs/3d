import { describe, expect, it } from 'vitest';

import { Scene3DSource } from '~/assets/Scene3DSource';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { PointLight } from '~/scene/lights/PointLight';
import type { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

const TRIANGLE_BOUNDS_CORNERS = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 1, z: 0 },
];

interface SourceOptions {
  camera?: boolean;
  light?: boolean;
}

function createSource({ camera, light }: SourceOptions = {}): Scene3DSource {
  const children = [0];

  if (camera) children.push(1);
  if (light) children.push(2);

  const source = new Scene3DSource({
    scenes: [
      { name: 'A', children },
      { name: 'B', children: [] },
    ],
    nodes: [
      { label: 'Tri', children: [], geometry: 0, materials: [0] },
      { label: 'Cam', children: [], camera: 0, position: new Float32Array([0, 0, 5]) },
      { label: 'Lamp', children: [], light: 0 },
    ],
    cameras: [{ fov: 90, near: 0.5, far: 50, mode: 0 }],
    lights: [{ type: 1, intensity: 2 }],
  });

  source.geometries[0] = [new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) })];
  source.materials[0] = new Material3D({});

  return source;
}

describe('View3D.from', () => {
  it('makes a model of the source the root and forwards view and model options', () => {
    const source = createSource();
    const paint = new Material3D();
    const view = View3D.from(source, {
      width: 300,
      height: 200,
      toneMapping: 'reinhard',
      receiveShadow: false,
      materials: [paint],
      label: 'hero',
    });

    expect(view.root).toBeInstanceOf(Model3D);
    expect(view.root.source).toBe(source);
    expect(view.width).toBe(300);
    expect(view.height).toBe(200);
    expect(view.toneMapping).toBe('reinhard');
    expect(view.label).toBe('hero');
    expect((view.root.children[0] as Mesh3D).receiveShadow).toBe(false);
    expect((view.root.children[0] as Mesh3D).material).toBe(paint);
  });

  it('picks the named scene', () => {
    const view = View3D.from(createSource(), { scene: 'B' });

    expect(view.meshes.items).toHaveLength(0);
  });

  it('frames the default camera on the model, with its bounds centre mid-screen and every corner in view', () => {
    const view = View3D.from(createSource(), { width: 100, height: 100 });
    const camera = view.camera;

    expect(camera.position.x).toBeCloseTo(0.5);
    expect(camera.position.y).toBeCloseTo(0.5);
    expect(camera.position.z).toBeGreaterThan(0);
    expect(camera.near).toBeLessThan(camera.position.z);

    const centre = view.worldToScreen({ x: 0.5, y: 0.5, z: 0 })!;

    expect(centre.x).toBeCloseTo(50);
    expect(centre.y).toBeCloseTo(50);

    for (const corner of TRIANGLE_BOUNDS_CORNERS) {
      const p = view.worldToScreen(corner)!;

      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it('uses the file camera when the scene has one', () => {
    const view = View3D.from(createSource({ camera: true }));

    expect(view.camera).toBe(view.root.cameras[0]);
    expect(view.camera.fov).toBeCloseTo(90);
    expect(view.camera.position.z).toBe(5);
  });

  it('uses a supplied camera as given, over the file camera', () => {
    const camera = new Camera3D();
    camera.position.set(1, 2, 3);

    const view = View3D.from(createSource({ camera: true }), { camera });

    expect(view.camera).toBe(camera);
    expect(camera.parent).toBe(view.root);
    expect([camera.position.x, camera.position.y, camera.position.z]).toEqual([1, 2, 3]);
  });

  it('adds a directional light under the camera when the file has no lights', () => {
    const view = View3D.from(createSource());

    expect(view.lights).toHaveLength(1);
    expect(view.lights[0]).toBeInstanceOf(DirectionalLight);
    expect(view.lights[0].parent).toBe(view.camera);
  });

  it('hangs the default light under the file camera', () => {
    const view = View3D.from(createSource({ camera: true }));

    expect(view.lights[0].parent).toBe(view.root.cameras[0]);
  });

  it('keeps the file lights and adds none of its own', () => {
    const view = View3D.from(createSource({ light: true }));

    expect(view.lights).toHaveLength(1);
    expect(view.lights[0]).toBeInstanceOf(PointLight);
    expect(view.camera.children).toHaveLength(0);
  });

  it('adds no light with light: false', () => {
    const view = View3D.from(createSource(), { light: false });

    expect(view.lights).toHaveLength(0);
  });
});

describe('View3D root typing', () => {
  it('keeps the root type a constructed View was given, so Model3D members compile on view.root', () => {
    const source = createSource();
    const view = new View3D({ root: new Model3D({ source }) });

    expect(view.root.source).toBe(source);
    expect(view.root.player).toBeUndefined();
  });
});
