import { Assets, Container } from 'pixi.js';
import type { Application, CubeTexture } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

type Vec3 = readonly [number, number, number];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
};

/**
 * The "Venice Sunset" IBL the glTF scenes light models with: the
 * committed LDR cube-face capture (served from the test publicDir). `View3D`
 * prefilters it at runtime for diffuse + specular image-based lighting.
 */
const GLTF_ENV_URL = '/venice-sunset/venice-sunset.cubemap';

interface RenderGltfOptions {
  /** Asset key the model was registered/loaded under (a `/mirror/` URL from the asset manifest). */
  url: string;
  /** Margin multiplier on the tight-fit camera distance. Larger pulls the camera back. Default 1.05. */
  padding?: number;
  /** Key directional-light intensity. Default `0.8·π`. */
  lightIntensity?: number;
  /** Ambient fill intensity. Default `0.3`. */
  ambientIntensity?: number;
  /** `.cubemap` manifest for the IBL. Default the Venice Sunset capture. */
  environmentUrl?: string;
  /** Radiance multiplier before the sRGB encode. Default `1`. */
  exposure?: number;
}

/**
 * Loads a glTF/GLB model and frames it for a deterministic 512×512 snapshot,
 * lit the same way every time: the Venice Sunset IBL, a soft white ambient
 * term, and a single key directional, both parented to the camera so they
 * track the view, with no-curve sRGB-encode tone mapping so authored colours
 * read true.
 *
 * Centres the model on its local AABB and parks the camera on an elevated 3/4
 * diagonal at the tightest distance that still contains every AABB corner, so
 * the model fills the frame regardless of its authored scale, origin, or shape.
 *
 * Returns the model, framed and lit, for a test that changes it afterwards.
 */
export async function renderGltfModel(app: Application, options: RenderGltfOptions): Promise<Model3D> {
  const container = new Container();
  app.stage.addChild(container);

  const view3d = new View3D({
    width: app.screen.width,
    height: app.screen.height,
    // No tonal curve, sRGB-encode only — matches three's LinearToneMapping.
    toneMapping: 'none',
    exposure: options.exposure ?? 1,
  });
  container.addChild(view3d);

  const environment = await Assets.load<CubeTexture>(options.environmentUrl ?? GLTF_ENV_URL);
  // Determinism: the IBL prefilter samples source mips (mipBias = roughness·4).
  // On WebGPU, source-mip generation races the prefilter pass, giving two stable
  // outcomes (mips-ready vs base-level-only) and flaky snapshots. Disable source
  // mips so the prefilter always samples level 0 — the faces are low-frequency,
  // so there's no aliasing cost. Then force the upload before the lazy prefilter
  // runs, so it never samples a not-yet-uploaded source.
  environment.source.autoGenerateMipmaps = false;
  app.renderer.texture.initSource(environment.source);
  view3d.environment = environment;

  const source = Assets.get<Scene3DSource>(options.url);
  const model = new Model3D(source);
  view3d.root.addChild(model);

  const bounds = model.getLocalBounds();
  const center = bounds.getCenter();
  model.position.set(-center.x, -center.y, -center.z);

  // Elevated 3/4 view so axis-aligned models present three shaded faces instead
  // of one flat face, exposing per-face texture/normal/shading detail.
  const forward = unit([1, 0.6, 1]);
  // Orthonormal screen-plane basis ⟂ the view axis, to project the AABB onto.
  const right = unit(cross([0, 1, 0], forward));
  const up = cross(forward, right);

  const halfFov = (view3d.camera.fov * Math.PI) / 180 / 2;
  const tanV = Math.tan(halfFov);
  const tanH = tanV * (app.screen.width / app.screen.height);

  // Tightest distance that still contains every AABB corner: a corner at view
  // depth `d` with screen offset `o` fits when |o| ≤ (distance − d)·tan, i.e.
  // distance ≥ d + |o|/tan. The max over all corners fills the frame to the most
  // extreme corner, independent of the model's shape or scale.
  let fit = 0;

  for (const x of [-bounds.width / 2, bounds.width / 2]) {
    for (const y of [-bounds.height / 2, bounds.height / 2]) {
      for (const z of [-bounds.depth / 2, bounds.depth / 2]) {
        const corner: Vec3 = [x, y, z];
        const depth = dot(corner, forward);

        fit = Math.max(fit, depth + Math.abs(dot(corner, right)) / tanH, depth + Math.abs(dot(corner, up)) / tanV);
      }
    }
  }

  const distance = (fit || 1) * (options.padding ?? 1.05);

  view3d.camera.near = distance / 100;
  view3d.camera.far = distance * 100;
  view3d.camera.position.set(forward[0] * distance, forward[1] * distance, forward[2] * distance);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  // Punctual rig parented to the camera so the lights track the view. pixi
  // lights emit along local -Z; a +30° yaw points the key into the scene from
  // the camera's right.
  const ambient = new AmbientLight({ color: 0xffffff, intensity: options.ambientIntensity ?? 0.3 });
  view3d.camera.addChild(ambient);

  const key = new DirectionalLight({ color: 0xffffff, intensity: options.lightIntensity ?? Math.PI * 0.8 });
  key.rotation.set(0, Math.PI / 6, 0);
  view3d.camera.addChild(key);

  return model;
}
