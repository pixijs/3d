import type { TestScene } from '@test-utils';
import { Matrix, RenderTexture } from 'pixi.js';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { DepthClearPass } from '~/core/render-passes/depth-clear/DepthClearPass';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { PointLight } from '~/scene/lights/PointLight';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * A dark wall lit by ranged lights near screen edges and the camera plane
 *
 * The light loop skips a light when its bit is clear in the fragment's tile mask. See `binLightTiles`.
 * The mask must preserve every light that passes the per-fragment range test. Reference images
 * show the output with tile rejection disabled. Incorrect binning or tile lookup cuts a straight
 * edge into a pool of light.
 *
 * What is in the picture:
 * - a 3×3 grid of point lights just in front of the wall, the outer eight centred on the screen's
 *   edges and corners, where a sphere's image stretches into an ellipse wider than its centre
 *   plus its radius;
 * - a spot light raking across the wall from the right;
 * - a point light behind the camera whose range reaches past it onto the two near blocks, so its
 *   sphere crosses the camera plane and has no bounded image;
 * - a point light wholly behind the camera, which must light nothing.
 *
 * Variants check pixel-to-tile mapping with an offset view, an offscreen scene transient, an inset
 * camera and a camera render texture.
 */

const WALL_Z = -8;
const LIGHT_Z = WALL_Z + 1.5;
const EYE = { x: 0, y: 0, z: 10 };

/** Wide enough that the outer lights sit well off-axis */
const FOV = 75;

/** Half the wall's visible extent at the lights' depth: where the screen's edges cut it */
const EDGE = Math.tan((FOV * Math.PI) / 360) * (EYE.z - LIGHT_Z);

const GRID_COLORS = [0xff5a4d, 0xffc53d, 0x7be36a, 0x3dd6ff, 0xffffff, 0x6f7cff, 0xd96bff, 0xff7ab8, 0x63ffd1];

/** Opaque and transparent draws from `camera`, over a depth clear, into its corner of the view */
class InsetPass extends Pass3D {
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

/** Options for {@link lightTilesScene} */
interface LightTilesSceneOptions {
  /** Offsets a non-square view from the screen origin on both axes */
  offset?: boolean;
  /** Routes the scene through an offscreen transient, whose viewport starts at the texture's origin */
  composite?: boolean;
  /** Adds an orthographic camera drawing the same wall into a corner of the view */
  inset?: boolean;
  /** Adds a camera drawing the wall from the side into a render texture, shown on an unlit panel */
  renderTexture?: boolean;
  /** Places the main camera inside one large, dim light */
  cameraInside?: boolean;
}

/**
 * Creates the light-tile wall with the selected viewport and camera settings
 * @param options - Scene variant.
 * @returns The scene, ready for `defineSceneTests`.
 */
export function lightTilesScene(options: LightTilesSceneOptions = {}): TestScene {
  const { offset = false, composite = false, inset = false, renderTexture = false, cameraInside = false } = options;

  return {
    app: {
      backgroundColor: 0x05060a,
    },
    create: async (app) => {
      const view3d = new View3D({
        width: offset ? 300 : app.screen.width,
        height: offset ? 200 : app.screen.height,
        composite,
      });
      if (offset) view3d.position.set(150, 220);

      app.stage.addChild(view3d);

      const wall = new Mesh3D({
        geometry: new PlaneGeometry({ width: 80, height: 80 }),
        material: new Material3D({ baseColor: 0xb8b8b8, metallic: 0, roughness: 0.6 }),
        castShadow: false,
        receiveShadow: false,
      });
      wall.position.set(0, 0, WALL_Z);
      view3d.root.addChild(wall);

      // Close to the eye and off to the sides: only the light behind the camera reaches them.
      const blockGeometry = new CubeGeometry({ width: 2, height: 2, depth: 2 });
      for (const x of [-3.2, 3.2]) {
        const block = new Mesh3D({
          geometry: blockGeometry,
          material: new Material3D({ baseColor: 0xd8d2c4, metallic: 0, roughness: 0.5 }),
          castShadow: false,
          receiveShadow: false,
        });
        block.position.set(x, -0.6, EYE.z - 3.4);
        block.rotation.set(0.3, x > 0 ? -0.6 : 0.6, 0);
        block.rotationDirty = true;
        view3d.root.addChild(block);
      }

      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          const light = new PointLight({ color: GRID_COLORS[row * 3 + column], intensity: 400, range: 5 });
          light.position.set((column - 1) * EDGE, (row - 1) * EDGE, LIGHT_Z);
          view3d.root.addChild(light);
        }
      }

      const spot = new SpotLight({ color: 0xfff0c8, intensity: 260, range: 16, coneAngle: 28, penumbra: 0.4 });
      spot.position.set(EDGE * 0.9, EDGE * 0.45, WALL_Z + 6);
      spot.lookAt({ x: -EDGE * 0.2, y: -EDGE * 0.4, z: WALL_Z });
      view3d.root.addChild(spot);

      const straddling = new PointLight({ color: 0xffe2b0, intensity: 60, range: 9 });
      straddling.position.set(0, 1, EYE.z + 2);
      view3d.root.addChild(straddling);

      const behind = new PointLight({ color: 0xff00ff, intensity: 400, range: 4 });
      behind.position.set(0, 0, EYE.z + 20);
      view3d.root.addChild(behind);

      if (cameraInside) {
        const surrounding = new PointLight({ color: 0x9fb4ff, intensity: 500, range: 40 });
        surrounding.position.set(1, 2, EYE.z - 1);
        view3d.root.addChild(surrounding);
      }

      view3d.camera.fov = FOV;
      view3d.camera.near = 0.15;
      view3d.camera.far = 120;
      view3d.camera.position.set(EYE.x, EYE.y, EYE.z);

      if (inset) {
        // Square on to the wall and wider than the main camera, so the same nine pools sit
        // somewhere else on the screen, in a viewport that starts partway across the target.
        const insetCamera = new Camera3D({ mode: 'orthographic', orthographicSize: EDGE * 1.5, near: 1, far: 60 });
        insetCamera.position.set(0, 0, EYE.z);
        insetCamera.viewport.x = 0.56;
        insetCamera.viewport.y = 0.05;
        insetCamera.viewport.width = 0.4;
        insetCamera.viewport.height = 0.3;
        view3d.root.addChild(insetCamera);

        view3d.passes = [new InsetPass(insetCamera)];
      }

      if (renderTexture) {
        const feed = RenderTexture.create({ width: 320, height: 192, resolution: 1, scaleMode: 'linear' });

        // From the side, so every pool is off-axis and foreshortened in the feed.
        const feedCamera = new Camera3D({ fov: 70, near: 0.5, far: 80, renderTexture: feed });
        feedCamera.position.set(-EDGE * 1.3, EDGE * 0.4, EYE.z - 6);
        feedCamera.lookAt({ x: EDGE * 0.3, y: 0, z: WALL_Z });
        view3d.root.addChild(feedCamera);

        view3d.passes = [
          new MeshPass({ name: 'opaque', camera: feedCamera }),
          new MeshPass({ name: 'transparent', camera: feedCamera, sort: 'distance' }),
        ];

        // Unlit, so the panel shows the feed as drawn. The V flip matches a render texture's
        // storage to a mesh's UVs.
        const panel = new Mesh3D({
          geometry: new PlaneGeometry({ width: 6, height: 3.6 }),
          material: new FlatMaterial({ baseColorTexture: feed, uvTransform: new Matrix(1, 0, 0, -1, 0, 1) }),
        });
        panel.position.set(0, -1.2, EYE.z - 5);
        view3d.root.addChild(panel);
      }
    },
  };
}
