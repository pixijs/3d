import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';

/** A container holding one 2×4×6 cube */
function makeBoxHolder(): Container3D {
  const holder = new Container3D();

  holder.addChild(
    new Mesh3D({ geometry: new CubeGeometry({ width: 2, height: 4, depth: 6 }), material: new Material3D({}) }),
  );

  return holder;
}

describe('Container3D size', () => {
  it('width, height, depth and getSize report the scaled local bounds', () => {
    const c = makeBoxHolder();
    c.scale.set(2, -1, 0.5);

    expect([c.width, c.height, c.depth]).toEqual([4, 4, 3]);

    const out = { width: 0, height: 0, depth: 0 };
    expect(c.getSize(out)).toBe(out);
    expect(out).toEqual({ width: 4, height: 4, depth: 3 });
  });

  it('each axis setter writes only its own scale axis', () => {
    const c = makeBoxHolder();

    c.width = 1;
    expect(c.scale).toMatchObject({ x: 0.5, y: 1, z: 1 });

    c.height = 8;
    expect(c.scale).toMatchObject({ x: 0.5, y: 2, z: 1 });

    c.depth = 3;
    expect(c.scale).toMatchObject({ x: 0.5, y: 2, z: 0.5 });
  });

  it('setSize fills a missing height or depth from the width, in both forms', () => {
    const c = makeBoxHolder();

    c.setSize(4, 2);
    expect(c.scale).toMatchObject({ x: 2, y: 0.5, z: 4 / 6 });

    c.setSize({ width: 2, depth: 12 });
    expect(c.scale).toMatchObject({ x: 1, y: 0.5, z: 2 });

    c.setSize(2, 4, 6);
    expect(c.scale).toMatchObject({ x: 1, y: 1, z: 1 });
  });

  it('keeps a unit scale on an axis with zero extent, such as a plane’s z, instead of dividing by zero', () => {
    const plane = new Mesh3D({ geometry: new PlaneGeometry({ width: 2, height: 2 }), material: new Material3D({}) });
    const holder = new Container3D();
    holder.addChild(plane);

    holder.setSize(4, 4, 4);

    expect(holder.scale).toMatchObject({ x: 2, y: 2, z: 1 });
  });

  it('keeps the sign of a mirrored axis', () => {
    const c = makeBoxHolder();
    c.scale.x = -1;

    c.width = 4;

    expect(c.scale.x).toBe(-2);
  });

  it('getLocalBounds resets and fills the box it is given, or a new one', () => {
    const c = makeBoxHolder();
    const out = new Box(new Vector3(-100, -100, -100), new Vector3(100, 100, 100));

    expect(c.getLocalBounds(out)).toBe(out);
    expect(out.min).toMatchObject({ x: -1, y: -2, z: -3 });
    expect(out.max).toMatchObject({ x: 1, y: 2, z: 3 });

    const a = c.getLocalBounds();
    expect(c.getLocalBounds()).not.toBe(a);
  });

  it('composes nested transforms, and sibling subtrees do not disturb each other', () => {
    const cube = () => new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({}) });
    const left = new Container3D({ x: -10, children: [cube()] });
    const top = cube();
    top.y = 5;
    const right = new Container3D({ x: 10, scale: 2, children: [cube(), new Container3D({ children: [top] })] });
    const root = new Container3D({ children: [left, right] });

    const bounds = root.getLocalBounds();

    expect(bounds.min).toMatchObject({ x: -10.5, y: -1, z: -1 });
    expect(bounds.max).toMatchObject({ x: 11, y: 11, z: 1 });
  });

  it('boundsVolume stands in for a subtree, on the root or on a descendant', () => {
    const area = new Box(new Vector3(-5, 0, -5), new Vector3(5, 1, 5));
    const c = makeBoxHolder();

    c.boundsVolume = area;
    expect(c.getLocalBounds().max).toMatchObject({ x: 5, y: 1, z: 5 });
    expect(c.width).toBe(10);

    const holder = new Container3D({ children: [new Container3D({ x: 10, boundsVolume: area, children: [c] })] });
    const bounds = holder.getLocalBounds();

    expect(bounds.min).toMatchObject({ x: 5, y: 0, z: -5 });
    expect(bounds.max).toMatchObject({ x: 15, y: 1, z: 5 });
  });

  it('leaves out hidden descendants and their subtrees, but always measures the root', () => {
    const farCube = () => {
      const mesh = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({}) });

      mesh.x = 100;

      return mesh;
    };

    const c = makeBoxHolder();
    const hiddenMesh = farCube();

    hiddenMesh.visible = false;
    c.addChild(hiddenMesh);
    c.addChild(new Container3D({ visible: false, children: [farCube()] }));

    expect(c.getLocalBounds().max).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(c.width).toBe(2);

    c.visible = false;
    expect(c.getLocalBounds().max).toMatchObject({ x: 1, y: 2, z: 3 });
  });

  it('measures an empty container as a zero box', () => {
    const c = new Container3D();
    const bounds = c.getLocalBounds();

    expect(bounds.isEmpty()).toBe(false);
    expect([bounds.width, bounds.height, bounds.depth]).toEqual([0, 0, 0]);
    expect(c.width).toBe(0);

    c.setSize(5);
    expect(c.scale).toMatchObject({ x: 1, y: 1, z: 1 });
  });
});
