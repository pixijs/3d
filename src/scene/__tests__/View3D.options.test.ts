import { Container } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };

describe('View3D constructor — inherited container options', () => {
  test('eventMode from options overrides the boundary-forced static', () => {
    expect(new View3D({ ...SIZE }).eventMode).toBe('static');
    expect(new View3D({ ...SIZE, eventMode: 'none' }).eventMode).toBe('none');
  });

  test('parent from options contains the view after construction', () => {
    const parent = new Container();
    const view3d = new View3D({ ...SIZE, parent });

    expect(view3d.parent).toBe(parent);
    expect(parent.children).toContain(view3d);
  });

  test('undefined-valued keys do not clobber defaults', () => {
    const view3d = new View3D({ ...SIZE, eventMode: undefined });
    expect(view3d.eventMode).toBe('static');
  });
});
