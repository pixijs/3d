import 'pixi.js/browser';
import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js';
import { Application, Ticker } from 'pixi.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { OrbitCameraOptions } from '~/extras/cameras/OrbitCamera';
import { OrbitCamera } from '~/extras/cameras/OrbitCamera';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 800, height: 600 };

function makeView(): View3D {
  const view = new View3D({ ...SIZE });

  view.camera.position.set(0, 0, 10);

  return view;
}

function pointer(overrides: Partial<FederatedPointerEvent> & { x: number; y: number }): FederatedPointerEvent {
  const { x, y, ...rest } = overrides;

  return {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    global: { x, y },
    ...rest,
  } as unknown as FederatedPointerEvent;
}

function wheel(deltaY: number): FederatedWheelEvent {
  return { deltaY, deltaMode: 0, ctrlKey: false, global: { x: 400, y: 300 } } as unknown as FederatedWheelEvent;
}

describe('OrbitCamera', () => {
  const created: OrbitCamera[] = [];
  const make = (options: Partial<OrbitCameraOptions> = {}): OrbitCamera => {
    const controls = new OrbitCamera({ view: makeView(), autoUpdate: false, ...options });

    created.push(controls);

    return controls;
  };

  afterEach(() => {
    for (const controls of created) controls.destroy();
    created.length = 0;
  });

  it('applies constructor options and settles the camera on the target', () => {
    const controls = make({ target: { x: 0, y: 1, z: 0 }, minDistance: 2, maxDistance: 20, enableDamping: true });

    expect(controls.target.y).toBe(1);
    expect(controls.minDistance).toBe(2);
    expect(controls.enableDamping).toBe(true);
    expect(controls.distance).toBeCloseTo(Math.hypot(0, 1, 10));
  });

  it('rotates the camera on a left-button drag and emits start/change/end', () => {
    const controls = make();
    const events: string[] = [];

    controls.on('start', () => events.push('start'));
    controls.on('change', () => events.push('change'));
    controls.on('end', () => events.push('end'));

    const view = controls.view;

    view.emit('pointerdown', pointer({ x: 400, y: 300 }));
    view.emit('globalpointermove', pointer({ x: 500, y: 300 }));
    view.emit('pointerup', pointer({ x: 500, y: 300 }));

    expect(events).toEqual(['start', 'change', 'end']);
    expect(controls.camera.position.x).not.toBe(0);
    expect(controls.distance).toBeCloseTo(10);
  });

  it('zooms in on a wheel-up and respects minDistance', () => {
    const controls = make({ minDistance: 9.5 });
    const view = controls.view;

    view.emit('wheel', wheel(-100));
    expect(controls.distance).toBeLessThan(10);

    view.emit('wheel', wheel(-10000));
    expect(controls.distance).toBeCloseTo(9.5);
  });

  it('ignores input while disabled', () => {
    const controls = make({ enabled: false });
    const view = controls.view;

    view.emit('pointerdown', pointer({ x: 400, y: 300 }));
    view.emit('globalpointermove', pointer({ x: 500, y: 300 }));

    expect(controls.camera.position.x).toBe(0);
  });

  it('autoUpdate connects to Ticker.shared and destroy disconnects', () => {
    const base = Ticker.shared.count;
    const controls = make({ autoUpdate: true });

    expect(Ticker.shared.count).toBe(base + 1);

    controls.destroy();
    expect(Ticker.shared.count).toBe(base);
  });

  it('leaves update() safe after destroy (a stray ticker frame)', () => {
    const controls = make();

    controls.destroy();

    expect(() => controls.update()).not.toThrow();
    expect(() => controls.distance).not.toThrow();
  });
});

// Drives the real pixi EventSystem from DOM events on the canvas so the View3D
// hit-test, global-move tracking, and local-space conversion are all exercised.
describe('OrbitCamera through the pixi event system', () => {
  let app: Application;

  beforeAll(async () => {
    app = new Application();
    await app.init({ width: 400, height: 300, preference: 'webgl' });
    document.body.appendChild(app.canvas);
  });

  afterAll(() => {
    app.canvas.remove();
    app.destroy();
  });

  function dom(type: string, x: number, y: number, extra: PointerEventInit = {}): PointerEvent {
    const rect = app.canvas.getBoundingClientRect();

    return new PointerEvent(type, {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: rect.left + x,
      clientY: rect.top + y,
      ...extra,
    });
  }

  it('rotates on a canvas drag and zooms on a canvas wheel', () => {
    const view = new View3D({ width: 400, height: 300 });

    view.camera.position.set(0, 0, 10);
    app.stage.addChild(view);
    app.render();

    const controls = new OrbitCamera({ view, autoUpdate: false });
    const changes: number[] = [];

    controls.on('change', () => changes.push(1));

    app.canvas.dispatchEvent(dom('pointerdown', 200, 150, { buttons: 1 }));
    document.dispatchEvent(dom('pointermove', 260, 150, { buttons: 1 }));
    window.dispatchEvent(dom('pointerup', 260, 150));

    expect(changes.length).toBe(1);
    expect(view.camera.position.x).not.toBe(0);
    expect(controls.distance).toBeCloseTo(10);

    const rect = app.canvas.getBoundingClientRect();

    app.canvas.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, deltaY: -100, clientX: rect.left + 200, clientY: rect.top + 150 }),
    );

    expect(controls.distance).toBeLessThan(10);

    controls.destroy();
    view.destroy();
  });
});
