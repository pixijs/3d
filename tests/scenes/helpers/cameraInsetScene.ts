import type { TestScene } from '@test-utils';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { DepthClearPass } from '~/core/render-passes/depth-clear/DepthClearPass';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { ConeGeometry } from '~/geometry/ConeGeometry';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Container3D } from '~/scene/Container3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Picture-in-picture: one View3D, two cameras.
 *
 * The main image is a perspective camera standing in a small block arena. The inset in the top-right
 * is a second camera — orthographic, high above, looking straight down — installed by a `Pass3D`
 * that adds a depth clear plus opaque and transparent forward passes for it. Both pairs of
 * passes share one draw list per bit; only the camera differs.
 *
 * What the picture proves:
 * - the inset lands inside `mapCamera.viewport` and nothing spills outside it (the executor
 *   narrows the GPU viewport to the camera's frame);
 * - the marker cone sits at the eye, so the main camera near-clips it while the map shows it;
 * - the two translucent blocks are sorted per camera — the lower one is nearer to the eye, the
 *   higher one is nearer to the map, so their overlap band blends in opposite orders.
 *
 * The `composite` variant runs the same arena through an offscreen scene transient, which is the
 * other half of the executor's viewport maths: a transient holds the view's content at its
 * origin in texels, so the node's frame is shifted and scaled rather than used as it stands.
 */

/**
 * Where the map lands inside the view, in normalised View3D space
 *
 * That the inset stays inside this rect and disturbs nothing outside it is asserted directly in
 * `src/core/render-passes/__tests__/cameraPerPass.test.ts`; here it is what you see.
 */
const MAP_VIEWPORT = { x: 0.66, y: 0.02, width: 0.32, height: 0.32 };

/** The perspective camera's fixed pose: eye height, standing back from the blocks, looking down -Z */
const EYE = { x: 0.6, y: 1.7, z: 7.5 };
const YAW = 0.18;

/**
 * Installs the minimap: a depth clear plus opaque and transparent draws, all from `camera`
 *
 * Policy lives here rather than in the engine — a pass with a camera is the whole mechanism, and
 * which passes an inset wants is the demo's call.
 */
class MinimapPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'afterTransparent';

  private readonly _camera: Camera3D;

  constructor(camera: Camera3D) {
    super();
    this._camera = camera;
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const { renderer } = ctx;
    const camera = this._camera;

    graph.addPass(new DepthClearPass({ renderer, camera }));
    graph.addPass(new ForwardRenderPass({ renderer, name: 'opaque', sort: 'key', camera }));
    graph.addPass(new ForwardRenderPass({ renderer, name: 'transparent', sort: 'distance', camera }));
  }
}

/** Flat-ish PBR block colour — distinct hues so the two views are easy to line up */
function block(color: number): Material3D {
  return new Material3D({ baseColor: color, metallic: 0, roughness: 0.75 });
}

function translucent(color: number): Material3D {
  return new Material3D({ baseColor: color, alpha: 0.5, metallic: 0, roughness: 0.3, alphaMode: 'blend' });
}

/**
 * The picture-in-picture arena, direct to the screen or through a scene transient
 * @param options - Scene variant.
 * @param options.composite - Routes the scene through an offscreen transient, and sits the view
 *   off the screen origin — which is what makes the executor's transient shift observable (a
 *   transient holds the view's content at its own origin, the screen does not).
 * @returns The scene, ready for `defineSceneTests`.
 */
export function cameraInsetScene(options: { composite?: boolean } = {}): TestScene {
  const composite = options.composite ?? false;

  return {
    app: {
      backgroundColor: 0x101418,
    },
    create: async (app) => {
      const size = composite ? 380 : app.screen.width;
      const view3d = new View3D({
        width: size,
        height: size,
        environment: { skyColor: 0x9fb8d8, groundColor: 0x2b2418 },
        composite,
      });
      if (composite) view3d.position.set(70, 90);

      app.stage.addChild(view3d);

      const sun = new DirectionalLight({ color: 0xfff2d8, intensity: 4 });
      sun.rotation.set(-0.9, 0.6, 0);
      sun.rotationDirty = true;
      view3d.root.addChild(sun);

      const ground = new Mesh3D({
        geometry: new PlaneGeometry({ width: 24, height: 24 }),
        material: block(0x4a5560),
      });
      ground.rotation.set(-Math.PI / 2, 0, 0);
      ground.rotationDirty = true;
      view3d.root.addChild(ground);

      // Asymmetric on purpose: the map only reads as the same arena if its layout has no
      // symmetry to mistake it for.
      const pillarGeometry = new CubeGeometry({ width: 1.2, height: 3, depth: 1.2 });
      for (const [x, z, color] of [
        [-3.2, -2.0, 0xd2544b],
        [3.4, -1.2, 0x4fae5b],
        [-1.4, -5.4, 0x4a76d2],
        [4.6, -6.0, 0xd9a02c],
      ] as const) {
        const pillar = new Mesh3D({ geometry: pillarGeometry, material: block(color) });
        pillar.position.set(x, 1.5, z);
        view3d.root.addChild(pillar);
      }

      // A long low wall across the far end — reads as a bar from above and a slab from the eye,
      // which is what fixes the map's orientation against the main image.
      const wall = new Mesh3D({
        geometry: new CubeGeometry({ width: 11, height: 1.1, depth: 0.7 }),
        material: block(0x8c7b66),
      });
      wall.position.set(0, 0.55, -8.4);
      view3d.root.addChild(wall);

      // The transparent pass, drawn by both cameras. Their overlap band is the per-camera sort:
      // the low block is nearer the eye, the high one nearer the map.
      const paneGeometry = new CubeGeometry({ width: 1.6, height: 1.6, depth: 1.6 });

      const lowPane = new Mesh3D({ geometry: paneGeometry, material: translucent(0x3bd6ff) });
      lowPane.position.set(1.4, 0.85, 0.4);
      view3d.root.addChild(lowPane);

      const highPane = new Mesh3D({ geometry: paneGeometry, material: translucent(0xff5cc8) });
      highPane.position.set(1.4, 2.1, -0.6);
      view3d.root.addChild(highPane);

      view3d.camera.fov = 65;
      view3d.camera.near = 0.15;
      view3d.camera.far = 120;
      view3d.camera.position.set(EYE.x, EYE.y, EYE.z);
      view3d.camera.rotation.set(0, YAW, 0);
      view3d.camera.rotationDirty = true;

      // The marker sits at the eye, so the main camera near-clips it and only the map sees it. The
      // pivot carries the yaw; the cone's own -90° tilt lays its apex along the pivot's forward.
      const marker = new Container3D();
      marker.position.set(EYE.x, EYE.y, EYE.z);
      marker.rotation.set(0, YAW, 0);
      marker.rotationDirty = true;
      view3d.root.addChild(marker);

      const markerCone = new Mesh3D({
        geometry: new ConeGeometry({ radius: 0.45, height: 1.3, radialSegments: 12 }),
        material: block(0xffffff),
      });
      markerCone.rotation.set(-Math.PI / 2, 0, 0);
      markerCone.rotationDirty = true;
      marker.addChild(markerCone);

      const mapCamera = new Camera3D({ mode: 'orthographic', orthographicSize: 9, near: 1, far: 34 });
      mapCamera.position.set(0, 24, 0);
      // Face straight down: local -Z onto world -Y, which also puts world -Z (the arena's "away")
      // at the top of the map.
      mapCamera.rotation.set(-Math.PI / 2, 0, 0);
      mapCamera.rotationDirty = true;
      mapCamera.viewport.x = MAP_VIEWPORT.x;
      mapCamera.viewport.y = MAP_VIEWPORT.y;
      mapCamera.viewport.width = MAP_VIEWPORT.width;
      mapCamera.viewport.height = MAP_VIEWPORT.height;
      view3d.root.addChild(mapCamera);

      view3d.passes = [new MinimapPass(mapCamera)];
    },
  };
}
