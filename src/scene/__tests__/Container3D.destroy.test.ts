import { afterEach, describe, expect, it, vi } from 'vitest';

import { Container3D } from '~/scene/Container3D';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Container3D destroy', () => {
  it('marks the container as destroyed', () => {
    const c = new Container3D();

    expect(c.destroyed).toBe(false);

    c.destroy();

    expect(c.destroyed).toBe(true);
  });

  it('is idempotent — a second destroy is a no-op and does not throw', () => {
    const c = new Container3D();

    c.destroy();

    expect(() => c.destroy()).not.toThrow();
    expect(c.destroyed).toBe(true);
  });

  it('detaches itself from its parent', () => {
    const parent = new Container3D();
    const child = new Container3D();

    parent.addChild(child);

    expect(parent.children).toContain(child);

    child.destroy();

    expect(parent.children).not.toContain(child);
    expect(child.parent).toBeNull();
  });

  it('destroy({ children: true }) recurses into children with the same options', () => {
    const parent = new Container3D();
    const child = new Container3D();

    parent.addChild(child);

    const childDestroy = vi.spyOn(child, 'destroy');
    const options = { children: true };

    parent.destroy(options);

    expect(childDestroy).toHaveBeenCalledTimes(1);
    expect(childDestroy).toHaveBeenCalledWith(options);
    expect(child.destroyed).toBe(true);
  });

  it('destroy() without children does not destroy children — only detaches them', () => {
    const parent = new Container3D();
    const child = new Container3D();

    parent.addChild(child);

    const childDestroy = vi.spyOn(child, 'destroy');

    parent.destroy();

    expect(childDestroy).not.toHaveBeenCalled();
    expect(child.destroyed).toBe(false);
    expect(child.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
  });

  it("emits 'destroyed' exactly once", () => {
    const c = new Container3D();
    const onDestroyed = vi.fn<(container: Container3D) => void>();

    c.on('destroyed', onDestroyed);

    c.destroy();
    c.destroy();

    expect(onDestroyed).toHaveBeenCalledTimes(1);
    expect(onDestroyed).toHaveBeenCalledWith(c);
  });

  it('removes all listeners on destroy', () => {
    const c = new Container3D();
    const listener = vi.fn<() => void>();

    c.on('childAdded', listener);

    expect(c.listenerCount('childAdded')).toBe(1);

    c.destroy();

    expect(c.listenerCount('childAdded')).toBe(0);
  });
});
