/**
 * `orbit-change`: an app that draws on demand from an OrbitCamera `'change'` listener and re-poses the camera there
 * through `orbit.update()`, the pattern the thunder-clouds port drew with. Damping is on at 0.033 and a mouse drags
 * sideways every frame; the app steps the orbit once a frame too, as its ticker would. Each `'change'` runs the
 * listener, which updates the orbit and renders the stage.
 *
 * The scene is one finely tessellated sphere at the orbit's target, lit from straight above, so a sideways orbit draws
 * the same frame at any turn: two trees that leave the camera at different turns still pass the pixel gate. Judged on
 * `cpu.update`, where the move, the orbit updates and the listener's renders run.
 */

import { Material3D, Mesh3D, SphereGeometry } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { frame } from 'benchy';
import type { FederatedPointerEvent } from 'pixi.js';

import type { PixiStage } from './stage.ts';

/** Seconds of one pass: the drag goes right for half of it and back for the other half. */
const DURATION = 4;

/** View pixels the mouse travels a second: 5 a frame at 60 fps. */
const DRAG_SPEED = 300;

const START_X = 200;

frame('orbit-change', {
  variants: {
    drag: { dampingFactor: 0.033 },
  },
  primary: 'cpu.update',
  duration: 4,
  create({ renderer, view, lights }: PixiStage, { dampingFactor }) {
    const stage = view.parent!;

    lights.sun.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2);

    const geometry = new SphereGeometry({ radius: 10, widthSegments: 256, heightSegments: 128 });
    const material = new Material3D({ baseColor: 0x4f9ed9, roughness: 0.5 });

    view.root.addChild(new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false }));

    const orbit = new OrbitCamera({ view, enableDamping: true, dampingFactor, autoUpdate: false });

    orbit.on('change', () => {
      orbit.update();
      renderer.render(stage);
    });

    const pointer = {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      global: { x: START_X, y: view.height / 2 },
    } as unknown as FederatedPointerEvent;

    view.emit('pointerdown', pointer);

    return {
      simulate(seconds) {
        const t = seconds % DURATION;

        pointer.global.x = START_X + DRAG_SPEED * Math.min(t, DURATION - t);
      },
      update() {
        view.emit('globalpointermove', pointer);
        orbit.update();
      },
      destroy() {
        orbit.destroy();
        geometry.destroy();
        material.destroy();
      },
    };
  },
});
