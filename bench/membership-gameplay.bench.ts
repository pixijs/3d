/**
 * A mixed scene with membership churn in it: a ground, 400 textured props, 24 articulated
 * characters, 120 projectiles drawn from a pool of 240 with two replaced every frame, 120
 * transparent effects with 24 visible, a moving camera and, in the shadow variants, two cascades.
 * `held` variants follow the same flights with the same meshes, so they draw the same picture with
 * no membership edits: the control the `spawn` variants are read against.
 */
import { Container3D, CubeGeometry, Material3D, Mesh3D, SphereGeometry } from '@pixi/3d';
import { frame } from 'benchy';

import { proceduralMaps } from './data/textures.ts';
import { toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** A small deterministic action scene, comparing membership churn with the same visible held-object replay. */
frame('membership gameplay replay', {
  variants: {
    'spawn-shadows': { spawning: true, shadows: true },
    'held-shadows': { spawning: false, shadows: true },
    'spawn-no-shadows': { spawning: true, shadows: false },
    'held-no-shadows': { spawning: false, shadows: false },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 4,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { spawning, shadows }) {
    const { view, lights } = stage;
    view.camera.position.set(0, 28, 36);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });
    view.camera.fov = 50;
    view.camera.near = 0.1;
    view.camera.far = 100;
    view.shadowQuality = 'low';
    view.shadowFilter = 'pcf';
    lights.sun.castShadow = shadows;
    lights.sun.shadow.cascades = 2;
    lights.sun.shadow.maxDistance = 80;
    lights.sun.shadow.update = [1, 1];
    lights.sun.position.set(-20, 30, 15);
    lights.sun.lookAt({ x: 0, y: 0, z: 0 });

    const cube = new CubeGeometry();
    const sphere = new SphereGeometry({ radius: 0.5, widthSegments: 8, heightSegments: 6 });
    const texture = toTexture(proceduralMaps(1210, 64).albedo, 'gameplay-props');
    const propMaterials = [0x718770, 0xb09c76, 0x797b8b, 0x8a7368].map(
      (baseColor) => new Material3D({ baseColor, baseColorTexture: texture, roughness: 0.9 }),
    );
    const actorMaterials = [0x5ea4d9, 0xd9855e, 0x87b578, 0xc993c2].map(
      (baseColor) => new Material3D({ baseColor, roughness: 0.65 }),
    );
    const floorMaterial = new Material3D({ baseColor: 0x383e49, roughness: 0.95 });
    const shotMaterial = new Material3D({ baseColor: 0xffdc79, roughness: 0.3 });
    const effectMaterial = new Material3D({ baseColor: 0xffa64f, alphaMode: 'blend', alpha: 0.4, roughness: 1 });
    const materials = [...propMaterials, ...actorMaterials, floorMaterial, shotMaterial, effectMaterial];
    const ground = new Mesh3D({ geometry: cube, material: floorMaterial, receiveShadow: shadows });
    ground.position.set(0, -0.15, 0);
    ground.scale.set(50, 0.2, 50);
    view.root.addChild(ground);
    for (let i = 0; i < 400; i++) {
      const mesh = new Mesh3D({
        geometry: cube,
        material: propMaterials[i % 4],
        castShadow: shadows,
        receiveShadow: shadows,
      });
      const height = 0.3 + (i % 7) * 0.12;
      mesh.position.set(((i % 20) - 9.5) * 1.2, height / 2, -19 + Math.floor(i / 20));
      mesh.scale.set(0.65, height, 0.65);
      view.root.addChild(mesh);
    }

    const actors: Container3D[] = [];
    const limbs: Mesh3D[] = [];
    const actorCount = 24;
    for (let i = 0; i < actorCount; i++) {
      const actor = new Container3D({ label: `replay-actor-${i}` });
      const material = actorMaterials[i % 4];
      const body = new Mesh3D({ geometry: cube, material, castShadow: shadows, receiveShadow: shadows });
      body.position.set(0, 0.95, 0);
      body.scale.set(0.55, 0.7, 0.32);
      const head = new Mesh3D({ geometry: sphere, material, castShadow: shadows, receiveShadow: shadows });
      head.position.set(0, 1.55, 0);
      head.scale.set(0.45, 0.45, 0.45);
      actor.addChild(body, head);
      for (let part = 0; part < 4; part++) {
        const limb = new Mesh3D({ geometry: cube, material, castShadow: shadows, receiveShadow: shadows });
        const arm = part < 2;
        limb.position.set((part % 2 ? 1 : -1) * (arm ? 0.4 : 0.17), arm ? 0.95 : 0.3, 0);
        limb.scale.set(0.16, 0.55, 0.18);
        actor.addChild(limb);
        limbs.push(limb);
      }
      actor.position.set(((i % 8) - 3.5) * 3, 0, 4 + Math.floor(i / 8) * 4);
      actors.push(actor);
      view.root.addChild(actor);
    }

    const count = 120;
    const shots: Mesh3D[] = [];
    const effects: Mesh3D[] = [];
    for (let pool = 0; pool < 2; pool++) {
      for (let i = 0; i < count; i++) {
        const mesh = new Mesh3D({
          geometry: sphere,
          material: shotMaterial,
          castShadow: shadows,
          receiveShadow: shadows,
        });
        mesh.scale.set(0.16, 0.16, 0.35);
        shots.push(mesh);
        view.root.addChild(mesh);
      }
    }
    for (let i = 0; i < count; i++) {
      const effect = new Mesh3D({ geometry: sphere, material: effectMaterial });
      effect.visible = false;
      effects.push(effect);
      view.root.addChild(effect);
    }
    // Prime both identities without timing store growth on their first pooled replacement.
    stage.renderer.render({ container: view.parent ?? view });
    for (let i = count; i < shots.length; i++) shots[i].removeFromParent();
    view._invalidateDrawCaches();
    stage.renderer.render({ container: view.parent ?? view });

    const live = new Uint8Array(count);
    const departures = new Uint16Array(2);
    const arrivals = new Uint16Array(2);
    const actorPoses = new Float32Array(actorCount * 4);
    const shotPositions = new Float32Array(count * 3);
    const effectPositions = new Float32Array(count * 3);
    const effectSizes = new Float32Array(count);
    let changed = 0;
    let cameraX = 0;
    const aim = { x: 0, y: 0, z: 0 };
    return {
      simulate(seconds) {
        const frameIndex = Math.round(seconds * 60) % 240;
        const phase = (frameIndex / 240) * Math.PI * 2;
        cameraX = 3 * Math.sin(phase);
        for (let i = 0; i < actorCount; i++) {
          actorPoses[i * 4] = ((i % 8) - 3.5) * 3 + 0.35 * Math.sin(phase + i);
          actorPoses[i * 4 + 1] = 4 + Math.floor(i / 8) * 4 + 0.5 * Math.cos(phase + i);
          actorPoses[i * 4 + 2] = 10 * Math.sin(phase + i);
          actorPoses[i * 4 + 3] = 25 * Math.sin(phase * 4 + i);
        }
        changed = 0;
        for (let i = 0; i < count; i++) {
          const age = (frameIndex + (i % 60)) % 60;
          const progress = age / 60;
          if (spawning && age === 0) {
            departures[changed] = live[i] * count + i;
            live[i] ^= 1;
            arrivals[changed++] = live[i] * count + i;
          }
          const actor = (i % actorCount) * 4;
          const spread = (Math.floor(i / actorCount) - 2) * 0.12;
          shotPositions[i * 3] = actorPoses[actor] + spread;
          shotPositions[i * 3 + 1] = 0.8 + 0.3 * Math.sin(progress * Math.PI);
          shotPositions[i * 3 + 2] = actorPoses[actor + 1] - progress * 20;
          effectPositions[i * 3] = actorPoses[actor] + spread;
          effectPositions[i * 3 + 1] = 0.3 + i * 0.0001;
          effectPositions[i * 3 + 2] = actorPoses[actor + 1] - 20;
          effectSizes[i] = age >= 48 ? 0.3 + (age - 48) * 0.025 : 0;
        }
      },
      update() {
        for (let i = 0; i < changed; i++) shots[departures[i]].removeFromParent();
        for (let i = 0; i < changed; i++) view.root.addChild(shots[arrivals[i]]);
        for (let i = 0; i < actorCount; i++) {
          actors[i].position.set(actorPoses[i * 4], 0, actorPoses[i * 4 + 1]);
          actors[i].angle.y = actorPoses[i * 4 + 2];
          const swing = actorPoses[i * 4 + 3];
          for (let part = 0; part < 4; part++) limbs[i * 4 + part].angle.x = part % 2 ? swing : -swing;
        }
        for (let i = 0; i < count; i++) {
          shots[live[i] * count + i].position.fromArray(shotPositions, i * 3);
          const effect = effects[i];
          effect.visible = effectSizes[i] > 0;
          effect.position.fromArray(effectPositions, i * 3);
          effect.scale.set(effectSizes[i], effectSizes[i], effectSizes[i]);
        }
        view.camera.position.set(cameraX, 28, 36);
        view.camera.lookAt(aim);
      },
      destroy() {
        for (const shot of shots) shot.destroy();
        for (const material of materials) material.destroy();
        texture.destroy(true);
        cube.destroy(true);
        sphere.destroy(true);
      },
    };
  },
});
