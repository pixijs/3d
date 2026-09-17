import 'pixi.js/browser';
import { Application, Container } from 'pixi.js';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { Container3D } from '~/scene/Container3D';
import { View3D } from '~/scene/View3D';

// Pins the documented divergence: the renderer-wide eventMode default applies to 2D
// containers only. 3D nodes always default to 'passive' — an interactive global default
// would put the entire scene on the pick list — and the boundary warns once about it.
describe("renderer eventMode default — 2D honors it, 3D stays 'passive'", () => {
  let app: Application;

  beforeAll(async () => {
    app = new Application();
    await app.init({ width: 64, height: 64, eventMode: 'static', preference: 'webgl' });
  });

  afterAll(() => {
    app.destroy();
  });

  test("a fresh 2D Container resolves to the renderer default, a Container3D to 'passive'", () => {
    expect(new Container().eventMode).toBe('static');
    expect(new Container3D().eventMode).toBe('passive');
  });

  test('the boundary warns once on its first hit test', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view3d = new View3D({ width: 64, height: 64 });
    const matching = (): number =>
      spy.mock.calls.filter((args) => args.some((a) => String(a).includes('applies only to 2D containers'))).length;

    view3d.containsPoint({ x: 1, y: 1 });
    expect(matching()).toBe(1);

    view3d.containsPoint({ x: 1, y: 1 });
    expect(matching()).toBe(1);
    spy.mockRestore();
  });
});
