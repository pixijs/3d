import { afterEach, describe, expect, it } from 'vitest';

import { View3D } from '~/scene/View3D';

const boundsOf = (view: View3D) => {
  const b = view.getBounds();
  return { width: b.width, height: b.height };
};

const DEFAULTS = { ...View3D.defaultOptions };

afterEach(() => {
  View3D.defaultOptions = { ...DEFAULTS };
});

describe('View3D size', () => {
  it('derives bounds from the constructor width and height', () => {
    const view = new View3D({ width: 800, height: 600 });

    expect(view.width).toBe(800);
    expect(view.height).toBe(600);
    expect(boundsOf(view)).toEqual({ width: 800, height: 600 });
  });

  it('falls back to defaultOptions for a missing or undefined size', () => {
    expect(new View3D().getSize()).toEqual({ width: 256, height: 256 });
    expect(new View3D({ width: undefined, height: 100 }).getSize()).toEqual({ width: 256, height: 100 });

    View3D.defaultOptions.width = 640;
    View3D.defaultOptions.height = 480;

    expect(new View3D().getSize()).toEqual({ width: 640, height: 480 });
  });

  /**
   * The invariant: resizing must raise pixi's `ViewContainer._boundsDirty`. The camera
   * projection reads the size live, but 2D bounds are cached — without the invalidation the
   * View draws at one size and reports another, and the filter system (which sizes its
   * texture from the bounds) crops the 3D to the stale rect.
   */
  it('setting width and height dirties the 2D bounds', () => {
    const view = new View3D({ width: 800, height: 600 });

    // Force a bounds evaluation so `_boundsDirty` is cleared before the resize.
    expect(boundsOf(view)).toEqual({ width: 800, height: 600 });

    view.width = 512;
    expect(boundsOf(view)).toEqual({ width: 512, height: 600 });

    view.height = 1396;
    expect(boundsOf(view)).toEqual({ width: 512, height: 1396 });
  });

  /**
   * `onViewUpdate` dirties the bounds and queues the View for a render-group rebuild, so a
   * write that changes nothing must not reach it. `_didViewChangeTick` is the counter it
   * increments on every call.
   */
  it('assigning the current size does not invalidate the View', () => {
    const view = new View3D({ width: 800, height: 600 });
    const tick = view._didViewChangeTick;

    view.width = 800;
    view.height = 600;
    view.setSize(800, 600);
    view.setSize({ width: 800, height: 600 });
    expect(view._didViewChangeTick).toBe(tick);

    view.width = 801;
    expect(view._didViewChangeTick).toBe(tick + 1);

    view.height = 601;
    expect(view._didViewChangeTick).toBe(tick + 2);

    view.setSize(801, 601);
    expect(view._didViewChangeTick).toBe(tick + 2);

    view.setSize(801, 602);
    expect(view._didViewChangeTick).toBe(tick + 3);

    view.setSize(801);
    expect(view._didViewChangeTick).toBe(tick + 4);
    expect(view.getSize()).toEqual({ width: 801, height: 801 });
  });

  it('width and height resize the viewport instead of scaling the View', () => {
    const view = new View3D({ width: 800, height: 600 });

    view.width = 400;
    view.height = 300;

    expect(view.scale.x).toBe(1);
    expect(view.scale.y).toBe(1);
    expect(view.getSize()).toEqual({ width: 400, height: 300 });
  });

  it('setSize accepts two numbers, one number, or a size object', () => {
    const view = new View3D({ width: 800, height: 600 });

    view.setSize(1024, 768);
    expect(boundsOf(view)).toEqual({ width: 1024, height: 768 });

    view.setSize(512);
    expect(boundsOf(view)).toEqual({ width: 512, height: 512 });

    view.setSize({ width: 300, height: 200 });
    expect(boundsOf(view)).toEqual({ width: 300, height: 200 });

    view.setSize({ width: 128 });
    expect(boundsOf(view)).toEqual({ width: 128, height: 128 });
    expect(view.scale.x).toBe(1);
    expect(view.scale.y).toBe(1);
  });

  it('getSize writes into the out object when given one', () => {
    const view = new View3D({ width: 320, height: 240 });
    const out = { width: 0, height: 0 };

    expect(view.getSize(out)).toBe(out);
    expect(out).toEqual({ width: 320, height: 240 });
  });

  it('keeps bounds tracking size across repeated resizes', () => {
    const view = new View3D({ width: 1228, height: 768 });

    for (const size of [
      { width: 1536, height: 768 },
      { width: 983, height: 768 },
      { width: 512, height: 975 },
      { width: 512, height: 1396 },
    ]) {
      view.setSize(size);
      expect(boundsOf(view)).toEqual(size);
    }
  });
});
