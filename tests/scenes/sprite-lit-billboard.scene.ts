import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

// The core injects billboarding from `Mesh3D.billboardMode`, so it composes with
// any material. This is the case that depends on that: **lit** billboards — the
// basis of impostor cards, which have to shade like the geometry they stand in
// for.
//
// Three rows, all the same PBR `Material3D` under one key light sitting roughly
// along the view axis.
//
//  - Top, `'spherical'` at three yaw angles: stays circular AND evenly lit,
//    because both the quad and its normal are rebuilt in the camera's basis.
//    Node yaw stops mattering entirely.
//  - Bottom, `'none'` at the same yaws: foreshortens into ellipses and dims as it
//    turns away, since the normal is still the node's own `+Z`.
//
// That pair isolates the normal handling. A billboarded quad whose normal was
// left un-rotated would stay circular but dim like the bottom row.
//
//  - Middle, `'spherical'` plus a hemisphere normal map: flat quads that read as
//    lit spheres, highlight up toward the key light.
//
// That row is the one that proves the *choice*. Overwriting `worldNormal` with a
// camera vector would light the top row evenly too — but it would leave nothing
// for a normal map to perturb, and the middle row would come out as flat discs.
// Rotating instead keeps authored normals alive, which is what impostor cards,
// bent foliage normals and octahedral impostors all need.
//
// Pass condition: round-and-even on top, squashed-and-dimming on the bottom,
// and sphere-shaded in the middle.

/** Opaque disc with a transparent surround, so `mask` has something to cut. */
function discCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/**
 * Tangent-space normal map of a hemisphere over the disc — the miniature of what
 * an impostor bake produces. On a flat quad it should shade like a ball.
 *
 * Green runs **down** the image, not up. The sprite quad's V axis runs top-to-
 * bottom in world space (that is what makes images render upright), and the
 * derivative-built tangent frame follows V — so tangent-space `+Y` comes out
 * pointing down in world. That is the Y-down convention, opposite to what a
 * v-up mesh wants. Author it the other way round and the dome lights from below.
 */
function domeNormalCanvas(): HTMLCanvasElement {
  const size = 64;
  const radius = 30;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5 - size / 2) / radius;
      // Y-down, per the note above: +Y in tangent space is down in the image.
      const ny = (y + 0.5 - size / 2) / radius;
      const rSq = nx * nx + ny * ny;
      const inside = rSq < 1;
      const nz = inside ? Math.sqrt(1 - rSq) : 1;
      const i = (y * size + x) * 4;
      image.data[i] = Math.round(((inside ? nx : 0) * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round(((inside ? ny : 0) * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

const YAWS = [0, 0.7, 1.1];

export const scene: TestScene = {
  create: async (app) => {
    const disc = Texture.from(discCanvas());
    disc.source.scaleMode = 'nearest';

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0.2, 11);
    view3d.camera.lookAt({ x: 0, y: 0.2, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0x2a3040, intensity: 1 }));

    // Key light down the view axis, so "faces the camera" and "faces the light"
    // are the same thing and the comparison reads as brightness.
    const key = new DirectionalLight({ color: 0xffffff, intensity: 4 });
    key.position.set(0.5, 3, 8);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(key);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 14, height: 14 }),
      material: new FlatMaterial({ baseColor: 0x14181f }),
    });
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3.1;
    view3d.root.addChild(ground);

    // Single-sided on purpose: `doubleSided` flips normals on back faces, which
    // would re-light the turned-away cards and hide the very thing under test.
    // Supplying the material is what makes that our call. The image and the
    // cutout mode live on the material — the shared-material form writes
    // nothing into it.
    const litMaterial = () =>
      new Material3D({ baseColorTexture: disc, alphaMode: 'mask', baseColor: 0xd8d2c4, metallic: 0, roughness: 0.65 });

    YAWS.forEach((yaw, i) => {
      const billboarded = new Sprite3D({
        billboardMode: 'spherical',
        height: 1.7,
        material: litMaterial(),
      });
      billboarded.position.set((i - 1) * 2.3, 1.9, 0);
      billboarded.rotation.y = yaw;
      view3d.root.addChild(billboarded);

      const plain = new Sprite3D({
        billboardMode: 'none',
        height: 1.7,
        material: litMaterial(),
      });
      plain.position.set((i - 1) * 2.3, -1.9, 0);
      plain.rotation.y = yaw;
      view3d.root.addChild(plain);
    });

    // Middle row: billboarded, lit, and normal-mapped. `normalMappingBit` builds
    // its tangent frame from screen-space derivatives of vPosition and vUV — both
    // of which the billboard rebuilt — so the frame lands in the billboard plane
    // and the map perturbs around the rotated normal. Flat quads should read as
    // lit spheres.
    //
    // One material, three sprites, nothing written into it — the shared-material
    // path, which is also how you keep the material count down at scale.
    const domed = new Material3D({
      baseColorTexture: disc,
      normalTexture: Texture.from({ resource: domeNormalCanvas(), label: 'sprite-dome-normal' }),
      metallic: 0,
      roughness: 0.35,
      alphaMode: 'mask',
    });

    YAWS.forEach((_, i) => {
      const impostor = new Sprite3D({ material: domed, billboardMode: 'spherical', height: 1.5 });
      impostor.position.set((i - 1) * 2.3, 0, 0);
      view3d.root.addChild(impostor);
    });
  },
};
