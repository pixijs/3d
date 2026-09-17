import type { TestScene } from '@test-utils';
import { ColorMatrixFilter, Container, Graphics } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * P1 repro: a shadow-casting {@link View3D} inside a 2D container carrying a 2D
 * filter. The shadow pass push/pops its cascade render target internally; that
 * pop reverts the live binding off the bind-only filter surface to the
 * render-target stack's root, so the View3D drew into the back buffer and the
 * filter composite then hid it. Fixed by the executor re-establishing the
 * default surface for the first colour pass (and the shadow pass nulling
 * `session.activeTarget`). The lit, shadowed scene must appear — desaturated by
 * the filter — inside the card; the colour grid backdrop around it proves the
 * filter boundary. Non-power-of-two canvas also exercises the frame-vs-source
 * viewport/projection path. Static rotation + `delay` for determinism.
 */
export const scene: TestScene = {
  app: {
    width: 320,
    height: 320,
    backgroundColor: 0x1a1a2e,
    useBackBuffer: true,
  },
  delay: 120,
  create: async (app) => {
    const w = app.screen.width;
    const h = app.screen.height;

    // Colour 2D grid backdrop (outside the filtered container — stays in colour).
    const backdrop = new Graphics();
    const step = 20;
    for (let x = 0; x <= w; x += step) backdrop.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += step) backdrop.moveTo(0, y).lineTo(w, y);
    backdrop.stroke({ color: 0x2e6c8c, width: 2, alpha: 1 });
    app.stage.addChild(backdrop);

    // Filtered 2D container wrapping the shadow-casting View3D.
    const card = new Container();
    card.position.set(w / 2, h / 2);
    card.filters = [new ColorMatrixFilter()];
    (card.filters[0] as ColorMatrixFilter).desaturate();
    app.stage.addChild(card);

    const view3d = new View3D({ width: 240, height: 240, anchor: 0.5, shadowQuality: 'medium' });
    card.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 8, height: 8 }),
      material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
      receiveShadow: true,
    });
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const caster = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.4 }),
      castShadow: true,
    });
    caster.rotation.set(0.3, 0.6, 0);
    view3d.root.addChild(caster);

    const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 6, castShadow: true });
    sun.rotation.set((-40 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 2, 4);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
