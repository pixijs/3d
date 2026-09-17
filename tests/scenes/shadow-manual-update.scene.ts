import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Manual shadow update mode (`update: 'manual'`) across frames: the
 * cascade only re-renders when the light's one-shot invalidation fires, and a
 * freshly added light is force-invalidated.
 *
 * The caster starts hidden. Visibility never changes pass membership, so the
 * shadow pass stays active and the forced first update renders a validly
 * *empty* map (the compaction sees no visible casters) — consuming the
 * one-shot. Manual mode means manual: revealing the caster is a scene change
 * the app made, so the app calls {@link Light.refreshShadows} to request
 * the re-render, and the shadow MUST then appear on the next step. Guards the
 * manual-mode invalidation lifecycle on both backends (each honours update
 * rates identically).
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x1a1a2e,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'medium',
    });
    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 8, height: 8 }),
      material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
      castShadow: false,
    });
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    // Caster wrapped so `worldVisible` cascades from the parent — hidden on the
    // first frame, revealed before the second.
    const wrap = new Container3D();
    wrap.visible = false;
    view3d.root.addChild(wrap);

    const caster = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.4 }),
      castShadow: true,
    });
    wrap.addChild(caster);

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 6,
      castShadow: true,
      shadow: { update: 'manual' },
    });
    sun.rotation.set((-40 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 2, 4);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    // Frame 1: caster hidden → the shadow pass renders a validly empty map,
    // consuming the new light's forced invalidation.
    app.render();

    // Reveal the caster and request the manual re-render; the shadow must
    // appear on the next step (the harness renders the final frame).
    wrap.visible = true;
    sun.refreshShadows();
    app.render();
  },
};
