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
  it('falls back to defaultOptions for a missing or undefined size', () => {
    expect(new View3D().getSize()).toEqual({ width: 256, height: 256 });
    expect(new View3D({ width: undefined, height: 100 }).getSize()).toEqual({ width: 256, height: 100 });

    View3D.defaultOptions.width = 640;
    View3D.defaultOptions.height = 480;

    expect(new View3D().getSize()).toEqual({ width: 640, height: 480 });
  });

  it('setting width and height dirties the cached 2D bounds, which the filter system sizes its texture from', () => {
    const view = new View3D({ width: 800, height: 600 });

    expect(boundsOf(view)).toEqual({ width: 800, height: 600 });

    view.width = 512;
    expect(boundsOf(view)).toEqual({ width: 512, height: 600 });

    view.height = 1396;
    expect(boundsOf(view)).toEqual({ width: 512, height: 1396 });
  });

  it('setting anchor dirties the 2D bounds', () => {
    const view = new View3D({ width: 100, height: 50 });
    expect(view.getBounds()).toMatchObject({ minX: 0, minY: 0, maxX: 100, maxY: 50 });

    view.anchor = 0.5;
    expect(view.getBounds()).toMatchObject({ minX: -50, minY: -25, maxX: 50, maxY: 25 });
  });

  it('assigning the current size never calls onViewUpdate, so it costs no rebuild', () => {
    const view = new View3D({ width: 800, height: 600 });
    const tick = view._didViewChangeTick;

    view.width = 800;
    view.height = 600;
    view.setSize(800, 600);
    view.setSize({ width: 800, height: 600 });
    expect(view._didViewChangeTick, 'onViewUpdate bumps _didViewChangeTick on every call').toBe(tick);

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
});
