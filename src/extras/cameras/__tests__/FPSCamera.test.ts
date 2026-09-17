import type { FederatedPointerEvent } from 'pixi.js';
import { Ticker } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { FPSCameraOptions } from '~/extras/cameras/FPSCamera';
import { FPSCamera } from '~/extras/cameras/FPSCamera';
import { View3D } from '~/scene/View3D';

function pointer(x: number, y: number, overrides: Partial<FederatedPointerEvent> = {}): FederatedPointerEvent {
  return {
    pointerId: 1,
    pointerType: 'touch',
    global: { x, y },
    movement: { x: 0, y: 0 },
    nativeEvent: { target: null },
    ...overrides,
  } as unknown as FederatedPointerEvent;
}

function key(type: 'keydown' | 'keyup', code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code }));
}

describe('FPSCamera', () => {
  const created: FPSCamera[] = [];
  const make = (options: Partial<FPSCameraOptions> = {}): FPSCamera => {
    const view = new View3D({ width: 800, height: 600 });
    const controls = new FPSCamera({ view, autoUpdate: false, ...options });

    created.push(controls);

    return controls;
  };

  afterEach(() => {
    for (const controls of created) controls.destroy();
    created.length = 0;
  });

  it('applies position, yaw, and pitch at construction', () => {
    const controls = make({ position: { x: 1, y: 2, z: 3 }, yaw: 0.5, pitch: 5 });

    expect(controls.camera.position.z).toBe(3);
    expect(controls.yaw).toBe(0.5);
    expect(controls.pitch).toBeCloseTo(Math.PI * 0.49);
  });

  it('looks around on a drag and emits change', () => {
    const controls = make();
    const view = controls.view;
    let changes = 0;

    controls.on('change', () => changes++);

    view.emit('pointerdown', pointer(100, 100));
    view.emit('globalpointermove', pointer(150, 100));
    view.emit('pointerup', pointer(150, 100));
    view.emit('globalpointermove', pointer(300, 100));

    expect(changes).toBe(1);
    expect(controls.yaw).toBeCloseTo(-50 * controls.lookSpeed);
    expect(controls.camera.quaternion.y).not.toBe(0);
  });

  it('walks forward on W and strafes with the move vector', () => {
    const controls = make({ position: { x: 0, y: 1.7, z: 0 }, moveSpeed: 6 });

    key('keydown', 'KeyW');
    expect(controls.update()).toBe(true);
    key('keyup', 'KeyW');

    expect(controls.camera.position.z).toBeCloseTo(-6 / 60);

    controls.move.x = 1;
    controls.update();
    expect(controls.camera.position.x).toBeCloseTo(6 / 60);

    controls.move.x = 0;
    expect(controls.update()).toBe(false);
  });

  it('ignores input while disabled', () => {
    const controls = make({ enabled: false });

    controls.view.emit('pointerdown', pointer(100, 100));
    controls.view.emit('globalpointermove', pointer(150, 100));
    key('keydown', 'KeyW');
    controls.update();
    key('keyup', 'KeyW');

    expect(controls.yaw).toBe(0);
    expect(controls.camera.position.z).toBe(0);
  });

  it('autoUpdate connects to Ticker.shared and destroy disconnects', () => {
    const base = Ticker.shared.count;
    const controls = make({ autoUpdate: true });

    expect(Ticker.shared.count).toBe(base + 1);

    controls.destroy();
    expect(Ticker.shared.count).toBe(base);
    expect(() => controls.update()).not.toThrow();
  });
});
