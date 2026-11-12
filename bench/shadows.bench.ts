/**
 * `shadows`: what shadow maps cost. 2000 spinning casters on a ground that receives, a sun and four spot lights
 * that are in the scene on every variant, and a ladder of which of them cast: `off` (none), `sun` (the sun's one
 * map), `sun-spots` (the sun's and the four spots', five maps), and `cascades` (the sun alone, as four cascades that
 * follow the camera). The lights' own shading is the same on every rung, so a step up is the maps being rendered and
 * the receivers looking them up. The casters spin, so every map is re-rendered every frame, which is why this is a
 * `frame()` bench judged on `gpu.frame` rather than a static `gpu()` one. `cpu.render` beside it carries the shadow
 * pass's culling and submission.
 *
 * Every map is 2048 texels a side (the view's `shadowQuality: 'high'`), filtered by `shadowFilter: 'pcf'`, with a
 * depth bias of 0.001 and a normal offset of 0.1 world units. The sun's map covers one fixed box (`shadow.bounds`).
 *
 * The view culls on the CPU (`cull: 'cpu'`): a GPU cull compacts the survivors in whatever order its threads finish,
 * so two runs would not draw the same frame.
 */

import { Box, DirectionalLight, Mesh3D, SpotLight, Vector3 } from '@pixi/3d';
import type { ShadowQuality } from '@pixi/3d';
import { frame } from 'benchy';

import { shadowsScene } from './data/shadows.ts';
import type { ShadowCasting } from './data/shadows.ts';
import { applyLook, displayColor, LIGHT_SCALE, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** The view's map presets by size: every map a view renders is one of these. */
const QUALITY: Record<number, ShadowQuality> = { 512: 'low', 1024: 'medium', 2048: 'high', 4096: 'ultra' };

frame('shadows', {
  variants: {
    off: { casting: 'off' },
    sun: { casting: 'sun' },
    'sun-spots': { casting: 'sun-spots' },
    cascades: { casting: 'cascades' },
  },
  primary: 'gpu.frame',
  gate: 'strict',
  options: { cull: 'cpu' },
  create(stage: PixiStage, { casting }: { casting: ShadowCasting }) {
    const data = shadowsScene();
    applyLook(stage, data.look);
    const { view } = stage;
    const { shadow } = data;
    const quality = QUALITY[shadow.size];
    if (quality === undefined) throw new Error(`shadows: PixiJS 3D has no shadow-map preset of ${shadow.size} texels`);
    view.shadowQuality = quality;
    // Named even where it is the default, so the filter this bench measures is on the page.
    view.shadowFilter = 'pcf';

    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map(toMaterial);
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < data.count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material) {
        throw new Error(`shadows: caster ${i} names a geometry or material that is not there`);
      }
      const mesh = new Mesh3D({ geometry, material, castShadow: true, receiveShadow: true });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      meshes.push(view.root.addChild(mesh));
    }
    const groundGeometry = toGeometry(data.ground.geometry);
    const groundMaterial = toMaterial(data.ground.material);
    view.root.addChild(
      new Mesh3D({ geometry: groundGeometry, material: groundMaterial, castShadow: false, receiveShadow: true }),
    );

    const spec = data.sun;
    const sun = new DirectionalLight({
      color: displayColor(spec.color),
      intensity: spec.intensity * LIGHT_SCALE,
      castShadow: casting !== 'off',
    });
    const [dx, dy, dz] = spec.direction;
    sun.position.set(-dx * spec.distance, -dy * spec.distance, -dz * spec.distance);
    sun.lookAt({ x: 0, y: 0, z: 0 });
    sun.shadow.bias = shadow.bias;
    sun.shadow.normalBias = shadow.normalBias;
    if (casting === 'cascades') {
      sun.shadow.cascades = spec.cascades.count;
      sun.shadow.maxDistance = spec.cascades.maxDistance;
    } else {
      const { min, max } = spec.box;
      sun.shadow.bounds = new Box(new Vector3(...min), new Vector3(...max));
    }
    view.root.addChild(sun);

    for (const light of data.spots) {
      const spot = new SpotLight({
        color: displayColor(light.color),
        intensity: light.intensity * LIGHT_SCALE,
        range: light.range,
        coneAngle: light.angle,
        penumbra: light.penumbra,
        castShadow: casting === 'sun-spots',
        shadow: { bias: shadow.bias, normalBias: shadow.normalBias },
      });
      spot.position.fromArray(light.position);
      spot.lookAt({ x: light.target[0], y: light.target[1], z: light.target[2] });
      view.root.addChild(spot);
    }

    const quat = data.quat;
    return {
      simulate(seconds) {
        data.update(seconds);
      },
      update() {
        let at = 0;
        for (const mesh of meshes) {
          mesh.quaternion.fromArray(quat, at);
          at += 4;
        }
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy();
        groundGeometry.destroy(true);
        groundMaterial.destroy();
      },
    };
  },
});
