import { describe, expect, it, vi } from 'vitest';

import type { PointData3D } from '~/math/vector/PointData3D';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import type { View3D } from '~/scene/View3D';

const fakeView3D = () => {
  const _onChildUpdate = vi.fn<(child: Container3D) => void>();
  return { view3d: { _onChildUpdate } as unknown as View3D, _onChildUpdate: _onChildUpdate };
};

const resetDirty = (c: Container3D) => {
  c._worldTransformDirty = false;
  c._worldVisibleDirty = false;
  c._localTransformDirty = false;
  c.didChange = false;
};

describe('Container3D visibility', () => {
  it('emits visibleChanged only when the value flips, even after a position write has enqueued the node', () => {
    const c = new Container3D();
    const seen: boolean[] = [];
    c.on('visibleChanged', (visible) => seen.push(visible));

    c.visible = true;
    c.position.x = 1;
    c.visible = false;
    c.visible = false;
    c.visible = true;

    expect(seen).toEqual([false, true]);
  });

  it('addChild sets both _worldTransformDirty and _worldVisibleDirty on the child', () => {
    const parent = new Container3D();
    const child = new Container3D();
    resetDirty(child);

    parent.addChild(child);

    expect(child._worldTransformDirty).toBe(true);
    expect(child._worldVisibleDirty).toBe(true);
    expect(child.didChange).toBe(true);
  });
});

describe('Container3D transform accessors', () => {
  it('assigning position, rotation or quaternion copies into the same observable and enqueues once', () => {
    const { view3d, _onChildUpdate } = fakeView3D();
    const c = new Container3D();
    c._view3d = view3d;
    resetDirty(c);

    const { position, rotation, quaternion } = c;

    c.position = { x: 1, y: 2, z: 3 };
    c.rotation = { x: 0.1, y: 0.2, z: 0.3 };

    expect(c.position).toBe(position);
    expect(c.rotation).toBe(rotation);
    expect(c.position).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(c.rotationDirty).toBe(true);
    expect(c._localTransformDirty).toBe(true);
    expect(_onChildUpdate).toHaveBeenCalledTimes(1);

    c.quaternion = { x: 0, y: 0, z: 0.1, w: 1 };

    expect(c.quaternion).toBe(quaternion);
    expect(c.quaternion.z).toBe(0.1);
    expect(c.rotationDirty).toBe(false);
  });

  it('assigning origin copies into one observable and enqueues once', () => {
    const { view3d, _onChildUpdate } = fakeView3D();
    const c = new Container3D();
    c._view3d = view3d;
    resetDirty(c);

    c.origin = { x: 1, y: 2, z: 3 };
    const origin = c.origin;
    c.origin = 5;

    expect(c.origin).toBe(origin);
    expect(c.origin).toMatchObject({ x: 5, y: 5, z: 5 });
    expect(c._localTransformDirty).toBe(true);
    expect(_onChildUpdate).toHaveBeenCalledTimes(1);
  });

  it('x, y and z alias the position components and mark the node dirty', () => {
    const { view3d, _onChildUpdate } = fakeView3D();
    const c = new Container3D();
    c._view3d = view3d;
    resetDirty(c);

    c.x = 1;
    c.y = 2;
    c.z = 3;

    expect(c.position).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(c._localTransformDirty).toBe(true);
    expect(_onChildUpdate).toHaveBeenCalledTimes(1);

    c.position.set(4, 5, 6);
    expect([c.x, c.y, c.z]).toEqual([4, 5, 6]);
  });

  it('angle is a live degree view of rotation, reused across reads', () => {
    const { view3d, _onChildUpdate } = fakeView3D();
    const c = new Container3D();
    c._view3d = view3d;
    resetDirty(c);

    const angle = c.angle;
    expect(c.angle).toBe(angle);

    angle.y = 90;
    expect(c.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(c.rotationDirty).toBe(true);
    expect(c._localTransformDirty).toBe(true);
    expect(_onChildUpdate).toHaveBeenCalledTimes(1);

    c.rotation.x = Math.PI;
    expect(angle.x).toBeCloseTo(180);

    angle.set(0, 45, 0);
    expect(c.rotation.x).toBe(0);
    expect(c.rotation.y).toBeCloseTo(Math.PI / 4);
  });

  it('angle and rotation in options are last-wins', () => {
    const rotation = { x: 0, y: 1, z: 0 };
    const angle = { x: 0, y: 90, z: 0 };

    expect(new Container3D({ rotation, angle }).rotation.y).toBeCloseTo(Math.PI / 2);
    expect(new Container3D({ angle, rotation }).rotation.y).toBe(1);
  });
});

const rounded = (p: PointData3D): number[] => [p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6 + 0);

const landing = (c: Container3D, x: number, y: number, z: number): number[] => {
  c.updateLocalTransform();

  return rounded(new Vector3(x, y, z).applyAffineMatrix4(c.localTransform));
};

describe('Container3D origin', () => {
  const turned = () => new Container3D({ position: { x: 10, y: 0, z: 0 }, scale: { x: 2, y: 3, z: 1 } });

  it('turns the node around the origin, which stays at position + origin, without moving it', () => {
    const still = new Container3D();
    still.origin.set(1, 2, 3);

    expect(landing(still, 0, 0, 0)).toEqual([0, 0, 0]);

    const c = turned();
    c.rotation.z = Math.PI / 2;
    c.origin.set(1, 1, 0);

    expect(landing(c, 1, 1, 0)).toEqual([11, 1, 0]);
    expect(landing(c, 0, 0, 0)).toEqual([14, -1, 0]);
    expect(landing(c, 2, 1, 0)).toEqual([11, 3, 0]);
  });
});

describe('Container3D reparentChild', () => {
  it('keeps the world pose of a child with an origin', () => {
    const oldParent = new Container3D({ position: { x: 5, y: 0, z: 0 }, rotation: { x: 0, y: 0.4, z: 0 } });
    const newParent = new Container3D({
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: Math.PI / 2, y: 0, z: 0 },
      scale: 2,
    });
    const child = new Container3D({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      scale: { x: 2, y: 3, z: 1 },
      parent: oldParent,
    });
    child.origin.set(0, 1, 0);

    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    const world = () => points.map((p) => child.toGlobal(p));
    const before = world();

    newParent.reparentChild(child);
    const after = world();

    expect(child.parent).toBe(newParent);
    for (let i = 0; i < points.length; i++) {
      expect(after[i].x, `point ${i} x`).toBeCloseTo(before[i].x, 4);
      expect(after[i].y, `point ${i} y`).toBeCloseTo(before[i].y, 4);
      expect(after[i].z, `point ${i} z`).toBeCloseTo(before[i].z, 4);
    }
  });
});

describe('Container3D replaceChild', () => {
  const oldChildUnder = (parent: Container3D): Container3D =>
    new Container3D({
      position: { x: 10, y: -2, z: 5 },
      rotation: { x: Math.PI / 2, y: 0, z: Math.PI / 2 },
      scale: { x: 2, y: 3, z: 4 },
      origin: { x: 1, y: 1, z: 0 },
      parent,
    });

  it('lands a new child with a different origin exactly where the old child sat', () => {
    const parent = new Container3D();
    const oldChild = oldChildUnder(parent);
    const newChild = new Container3D({
      position: { x: 100, y: 100, z: 100 },
      rotation: { x: 0, y: 1, z: 0 },
      scale: 7,
      origin: { x: 0, y: 2, z: -1 },
    });

    const corners = [
      landing(oldChild, 0, 0, 0),
      landing(oldChild, 1, 1, 0),
      landing(oldChild, 1, 0, 0),
      landing(oldChild, 0, 0, 1),
    ];

    expect(corners).toEqual([
      [14, -1, 3],
      [11, -1, 5],
      [14, -1, 5],
      [14, -5, 3],
    ]);

    parent.replaceChild(oldChild, newChild);

    expect(rounded(newChild.position)).toEqual([8, 1, 4]);
    expect([
      landing(newChild, 0, 0, 0),
      landing(newChild, 1, 1, 0),
      landing(newChild, 1, 0, 0),
      landing(newChild, 0, 0, 1),
    ]).toEqual(corners);
    expect(landing(newChild, 0, 2, -1)).toEqual([8, 3, 3]);
  });

  it('takes the old child index, rotation and scale, leaving the Euler angles authoritative', () => {
    const parent = new Container3D();
    const first = new Container3D({ parent });
    const oldChild = new Container3D({ rotation: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 2, y: 3, z: 4 }, parent });
    const last = new Container3D({ parent });
    const newChild = new Container3D();

    parent.replaceChild(oldChild, newChild);

    expect(parent.children).toEqual([first, newChild, last]);
    expect(newChild.parent).toBe(parent);
    expect(oldChild.parent).toBeNull();
    expect(newChild.rotation).toMatchObject({ x: 0, y: Math.PI / 2, z: 0 });
    expect(newChild.scale).toMatchObject({ x: 2, y: 3, z: 4 });
    expect(newChild.rotationDirty).toBe(true);
    expect(landing(newChild, 1, 0, 0)).toEqual([0, 0, -2]);
  });

  it("leaves the quaternion authoritative when it was, over the old child's stale Euler angles", () => {
    const parent = new Container3D();
    const oldChild = new Container3D({ rotation: { x: 0, y: Math.PI / 2, z: 0 }, parent });
    oldChild.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    const newChild = new Container3D();

    parent.replaceChild(oldChild, newChild);

    expect(newChild.rotationDirty).toBe(false);
    expect(newChild.rotation).toMatchObject({ x: 0, y: Math.PI / 2, z: 0 });
    expect(landing(newChild, 1, 0, 0)).toEqual([1, 0, 0]);
  });

  it('throws when the old child belongs to another container', () => {
    const parent = new Container3D();
    const stranger = new Container3D({ parent: new Container3D() });
    const newChild = new Container3D();

    expect(() => parent.replaceChild(stranger, newChild)).toThrow(/must be a child of the caller/);
    expect(newChild.parent).toBeNull();
  });
});

describe('Container3D label', () => {
  it('defaults to null, so logHierarchy names only the nodes that were labelled', () => {
    const c = new Container3D();
    new Container3D({ label: 'arm', parent: c });
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    c.logHierarchy();
    spy.mockRestore();

    expect(c.label).toBeNull();
    expect(lines).toEqual(['Container3D', '  Container3D "arm"']);
  });
});

describe('Container3D rotationDirty', () => {
  it('is cleared when the quaternion is written, making it authoritative', () => {
    const c = new Container3D();
    c.rotation.set(0.1, 0.2, 0.3);
    expect(c.rotationDirty).toBe(true);

    c.quaternion.set(0, 0.1, 0, 1);
    expect(c.rotationDirty).toBe(false);

    c.rotation.x = 0.5;
    expect(c.rotationDirty).toBe(true);

    c.quaternion.copyFrom({ x: 0, y: 0, z: 0.1, w: 1 });
    expect(c.rotationDirty).toBe(false);
  });

  it('is set by assigning rotation after lookAt, even when the angles match the stale stored ones', () => {
    const { view3d, _onChildUpdate } = fakeView3D();
    const c = new Container3D();
    c._view3d = view3d;
    c.lookAt({ x: 1, y: 0, z: 0 });
    resetDirty(c);
    _onChildUpdate.mockClear();

    c.rotation = { x: 0, y: 0, z: 0 };

    expect(c.rotationDirty).toBe(true);
    expect(c._localTransformDirty).toBe(true);
    expect(_onChildUpdate).toHaveBeenCalledTimes(1);
    c.updateLocalTransform();
    expect(c.quaternion.y).toBeCloseTo(0);
    expect(c.quaternion.w).toBeCloseTo(1);
  });

  it('is set by assigning angle after a quaternion write, even when the degrees match the stale stored ones', () => {
    const { view3d, _onChildUpdate } = fakeView3D();
    const c = new Container3D();
    c._view3d = view3d;
    c.angle = { x: 0, y: 90, z: 0 };
    c.updateLocalTransform();
    c.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    resetDirty(c);
    _onChildUpdate.mockClear();

    c.angle = { x: 0, y: 90, z: 0 };

    expect(c.rotationDirty).toBe(true);
    expect(c._localTransformDirty).toBe(true);
    expect(_onChildUpdate).toHaveBeenCalledTimes(1);
    c.updateLocalTransform();
    expect(c.quaternion.y).toBeCloseTo(Math.SQRT1_2);
    expect(c.quaternion.w).toBeCloseTo(Math.SQRT1_2);
  });

  it('is cleared by assigning quaternion after a rotation write, even to the stale stored components', () => {
    const { view3d, _onChildUpdate } = fakeView3D();
    const c = new Container3D();
    c._view3d = view3d;
    c.rotation.y = 1;
    resetDirty(c);
    _onChildUpdate.mockClear();

    c.quaternion = { x: 0, y: 0, z: 0, w: 1 };

    expect(c.rotationDirty).toBe(false);
    expect(c._localTransformDirty).toBe(true);
    expect(_onChildUpdate).toHaveBeenCalledTimes(1);
    c.updateLocalTransform();
    expect(c.localTransform.elements[0]).toBeCloseTo(1);
    expect(c.localTransform.elements[2]).toBeCloseTo(0);
  });
});

const build = () => {
  const deep = new Container3D({ label: 'wheel_3' });
  const deeper = new Container3D({ label: 'wheel_2' });
  const a = new Container3D({ label: 'wheel_1', children: [deep] });
  const b = new Container3D({ label: 'body', children: [deeper] });
  const c = new Container3D({ label: 'wheel_4' });
  const root = new Container3D({ children: [a, b, c] });

  return { root, a, b, c, deep, deeper };
};

describe('Container3D label lookup', () => {
  it('getChildByLabel checks direct children only unless deep', () => {
    const { root, b, deeper } = build();

    expect(root.getChildByLabel('body')).toBe(b);
    expect(root.getChildByLabel('wheel_2')).toBeNull();
    expect(root.getChildByLabel('wheel_2', true)).toBe(deeper);
    expect(root.getChildByLabel('missing', true)).toBeNull();
  });

  it('getChildByLabel deep returns a matching direct child first, then searches the subtrees in child order', () => {
    const { root, a, deep } = build();

    expect(root.getChildByLabel(/^wheel_/, true)).toBe(a);
    expect(root.getChildByLabel(/^wheel_[23]$/, true)).toBe(deep);
  });

  it('getChildrenByLabel collects matches into out', () => {
    const { root, a, c, deep, deeper } = build();

    expect(root.getChildrenByLabel(/^wheel_/)).toEqual([a, c]);

    const out: Container3D[] = [];
    expect(root.getChildrenByLabel(/^wheel_/, true, out)).toBe(out);
    expect(out).toEqual([a, c, deep, deeper]);
  });
});

describe('Container3D traverse', () => {
  it('visits this container, then each child before its subtree, in children order, hidden ones included', () => {
    const { root, a, b, c, deep, deeper } = build();
    const visited: Container3D[] = [];

    a.visible = false;
    root.traverse((container) => visited.push(container));

    expect(visited).toEqual([root, a, deep, b, deeper, c]);
  });

  it('moves on to the next sibling when the callback removes or destroys the container it was given', () => {
    const { root, a, b, c, deep } = build();
    const visited: Container3D[] = [];

    root.traverse((container) => {
      visited.push(container);

      if (container === a) a.removeFromParent();
      if (container === b) b.destroy();
    });

    expect(visited).toEqual([root, a, deep, b, c]);
    expect(root.children).toEqual([c]);
  });

  it('replaces every child the callback swaps out with replaceChild, without visiting the replacements', () => {
    const originals = [new Container3D(), new Container3D(), new Container3D(), new Container3D()];
    const root = new Container3D({ children: originals });
    const visited: Container3D[] = [];

    root.traverse((container) => {
      visited.push(container);

      if (container !== root) root.replaceChild(container, new Container3D());
    });

    expect(visited).toEqual([root, ...originals]);
    expect(root.children).toHaveLength(4);
    expect(root.children.filter((child) => originals.includes(child))).toEqual([]);
  });

  it('skips containers the callback adds under or beside the one it was given, so the walk ends', () => {
    const { root, a, b, c, deep, deeper } = build();
    const visited: Container3D[] = [];

    root.traverse((container) => {
      visited.push(container);

      container.addChild(new Container3D());
      container.parent?.addChild(new Container3D());
    });

    expect(visited).toEqual([root, a, deep, b, deeper, c]);
  });
});
