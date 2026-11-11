import type { TestScene } from '@test-utils';
import { AlphaFilter, Container, Matrix, RenderTexture } from 'pixi.js';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { BackgroundPass } from '~/core/render-passes/background/BackgroundPass';
import { ConeGeometry } from '~/geometry/ConeGeometry';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Container3D } from '~/scene/Container3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * A security camera on a monitor: a second camera drawing the world into a texture.
 *
 * A fixed `Camera3D` high on one side carries a `RenderTexture`; the opaque and transparent
 * passes that name it, at the `'beforeOpaque'` stage, land in that texture instead of on the
 * screen. The monitor is a quad with a `FlatMaterial` showing the feed, and the main camera
 * looks straight at it.
 *
 * What the picture proves:
 * - a camera with a render texture is a feed: the graph draws into that texture, clears it on
 *   its first writer, and later scene passes can sample it — so a material can show it in the
 *   same view;
 * - the feed camera's projection is built in the *texture's* space — full width, its own
 *   aspect — not in the view's;
 * - the white marker cone stands at the eye, where only the feed can see it, and appears on the
 *   monitor;
 * - a `BackgroundPass` on the feed camera fills the feed's sky, so every texel the opaque screen
 *   shows has alpha 1 and the floor's horizon stays anti-aliased.
 *
 * The pair proves the winding parity is decided per target. Pixi resolves it as
 * `flipY XOR (isWebGL && !isRoot)`, and a texture is never root — so straight to the canvas the
 * feed's parity is the opposite of the view's on WebGL, and taking the outer target's answer
 * would cull the feed's front faces away. The `filter` variant then wraps the view in a pixi
 * filter, which makes the *outer* target non-root too: the view camera's parity flips and the
 * feed's stays put, and the monitor shows the same picture in both scenes.
 */

/** The colour behind everything: the app's clear, the view's background and the feed's sky */
const SKY = 0x101418;

/**
 * Draws the view's background into the feed before its scene
 *
 * A feed camera draws no sky of its own, and its texture clears to transparent black. The screen
 * is opaque, so it would show the floor's colour at full strength on every edge texel with any
 * coverage, and the horizon would step and spread into the sky.
 */
class FeedSkyPass extends Pass3D {
  public readonly stage = 'beforeOpaque';

  private readonly _camera: Camera3D;

  constructor(camera: Camera3D) {
    super();
    this._camera = camera;
  }

  public build(graph: RenderGraph, { renderer }: PassContext): void {
    graph.addPass(new BackgroundPass({ renderer, camera: this._camera }));
  }
}

/** Where the monitor hangs, and how big its screen is in world units */
const TV_X = 0;
const TV_Y = 1.9;
const TV_Z = -10.05;
const SCREEN_WIDTH = 4.6;
const SCREEN_HEIGHT = 2.6;

/** The main camera stands square in front of the monitor, at the same height */
const EYE_Z = -1.4;

/** The feed texture: 16:9, its own aspect, nothing to do with the view's */
const FEED_WIDTH = 512;
const FEED_HEIGHT = 288;

function block(color: number): Material3D {
  return new Material3D({ baseColor: color, metallic: 0, roughness: 0.75 });
}

/**
 * The security-camera arena, straight to the screen or inside a pixi filter
 * @param options - Scene variant.
 * @param options.filter - Wraps the view in an `AlphaFilter`, so the outer render target is a
 *   texture rather than the canvas and the view camera's winding flips.
 * @returns The scene, ready for `defineSceneTests`.
 */
export function securityCameraScene(options: { filter?: boolean } = {}): TestScene {
  const filter = options.filter ?? false;

  return {
    app: {
      backgroundColor: SKY,
    },
    create: async (app, context) => {
      const size = app.screen.width;

      const view3d = new View3D({
        width: size,
        height: size,
        environment: { skyColor: 0x9fb8d8, groundColor: 0x2b2418 },
        background: SKY,
      });

      if (filter) {
        const wrapper = new Container();
        wrapper.filters = [new AlphaFilter({ alpha: 1 })];
        wrapper.addChild(view3d);
        app.stage.addChild(wrapper);
      } else {
        app.stage.addChild(view3d);
      }

      const sun = new DirectionalLight({ color: 0xfff2d8, intensity: 4 });
      sun.rotation.set(-0.9, 0.6, 0);
      sun.rotationDirty = true;
      view3d.root.addChild(sun);

      const ground = new Mesh3D({
        geometry: new PlaneGeometry({ width: 30, height: 30 }),
        material: block(0x4a5560),
      });
      ground.rotation.set(-Math.PI / 2, 0, 0);
      ground.rotationDirty = true;
      view3d.root.addChild(ground);

      // What the feed has to show: four pillars is enough that a wrong winding reads as missing
      // geometry rather than as a dim picture.
      const pillarGeometry = new CubeGeometry({ width: 1.2, height: 3, depth: 1.2 });
      for (const [x, z, color] of [
        [-4.8, -2.4, 0xd2544b],
        [4.8, -2.4, 0x4fae5b],
        [-4.4, -7.4, 0x4a76d2],
        [4.4, -7.4, 0xd9a02c],
      ] as const) {
        const pillar = new Mesh3D({ geometry: pillarGeometry, material: block(color) });
        pillar.position.set(x, 1.5, z);
        view3d.root.addChild(pillar);
      }

      // The player marker: a cone the feed sees and the main camera does not. It sits exactly at
      // the eye, so the main camera stands inside it and back-face culling hides it; the only
      // place it shows up is the monitor.
      const marker = new Container3D();
      marker.position.set(TV_X, TV_Y, EYE_Z);
      view3d.root.addChild(marker);

      const markerCone = new Mesh3D({
        geometry: new ConeGeometry({ radius: 0.45, height: 1.4, radialSegments: 12 }),
        material: block(0xffffff),
      });
      markerCone.rotation.set(-Math.PI / 2, 0, 0);
      markerCone.rotationDirty = true;
      marker.addChild(markerCone);

      view3d.camera.fov = 60;
      view3d.camera.near = 0.15;
      view3d.camera.far = 120;
      view3d.camera.position.set(TV_X, TV_Y, EYE_Z);

      // --- The camera on the wall ---
      const feed = RenderTexture.create({
        width: FEED_WIDTH,
        height: FEED_HEIGHT,
        resolution: 1,
        // Set at creation: a scale mode or mip flag assigned afterwards misses the WebGPU sampler.
        autoGenerateMipmaps: true,
        scaleMode: 'linear',
      });

      const feedCamera = new Camera3D({ fov: 56, near: 0.5, far: 60, renderTexture: feed });
      feedCamera.position.set(-3.2, 6.2, -10.2);
      feedCamera.lookAt({ x: 0.8, y: 0.5, z: -1.6 });
      view3d.root.addChild(feedCamera);

      // The sky, then the same memberships the main camera draws, from the wall camera, before the
      // scene.
      const feedPasses = [
        new FeedSkyPass(feedCamera),
        new MeshPass({ name: 'opaque', camera: feedCamera }),
        new MeshPass({ name: 'transparent', camera: feedCamera, sort: 'distance' }),
      ];
      view3d.passes = feedPasses;

      // --- The monitor ---
      const tv = new Container3D();
      tv.position.set(TV_X, TV_Y, TV_Z);
      view3d.root.addChild(tv);

      // The bezel earns its place: the feed's own sky is dark, so without a light surround a
      // screen that stopped drawing would look much like one that is drawing.
      const bezel = new Mesh3D({
        geometry: new CubeGeometry({ width: SCREEN_WIDTH + 0.4, height: SCREEN_HEIGHT + 0.4, depth: 0.22 }),
        material: new Material3D({ baseColor: 0x14161b, metallic: 0.1, roughness: 0.55 }),
      });
      bezel.position.set(0, 0, -0.12);
      tv.addChild(bezel);

      // Unlit, so what you see is the feed's own brightness. The UV transform flips V: a render
      // texture is stored in the orientation pixi's 2D pipeline samples it in, and a mesh's UVs
      // run the other way.
      const screen = new Mesh3D({
        geometry: new PlaneGeometry({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }),
        material: new FlatMaterial({
          baseColorTexture: feed,
          uvTransform: new Matrix(1, 0, 0, -1, 0, 1),
        }),
      });
      tv.addChild(screen);

      // The one thing the reference image cannot show: that turning the feed on changed only the
      // monitor's own pixels. Render once with the feed passes off (the texture is never written,
      // so the screen stays blank) and once with them on, then compare the two full-screen
      // extracts. The monitor faces the camera square on, so its rect is the quad's world size
      // divided by the perspective at that distance, centred — padded 2px for the
      // logical→physical rounding of the extract.
      for (const pass of feedPasses) pass.enabled = false;
      app.render();
      const blank = app.renderer.extract.pixels({ target: app.stage, frame: app.screen });
      for (const pass of feedPasses) pass.enabled = true;
      app.render();
      const live = app.renderer.extract.pixels({ target: app.stage, frame: app.screen });

      const scale = blank.width / app.screen.width;
      const halfFrustum = Math.tan((view3d.camera.fov * Math.PI) / 360) * (EYE_Z - TV_Z);
      const pixelsPerUnit = (size / (2 * halfFrustum)) * scale;
      const centre = (size / 2) * scale;
      const left = Math.floor(centre - (SCREEN_WIDTH / 2) * pixelsPerUnit) - 2;
      const right = Math.ceil(centre + (SCREEN_WIDTH / 2) * pixelsPerUnit) + 2;
      const top = Math.floor(centre - (SCREEN_HEIGHT / 2) * pixelsPerUnit) - 2;
      const bottom = Math.ceil(centre + (SCREEN_HEIGHT / 2) * pixelsPerUnit) + 2;

      let outsideDiffering = 0;
      let insideDiffering = 0;
      for (let y = 0; y < blank.height; y++) {
        for (let x = 0; x < blank.width; x++) {
          const i = (y * blank.width + x) * 4;
          const differs =
            blank.pixels[i] !== live.pixels[i] ||
            blank.pixels[i + 1] !== live.pixels[i + 1] ||
            blank.pixels[i + 2] !== live.pixels[i + 2] ||
            blank.pixels[i + 3] !== live.pixels[i + 3];
          if (!differs) continue;
          if (x >= left && x < right && y >= top && y < bottom) insideDiffering++;
          else outsideDiffering++;
        }
      }
      context.expect(outsideDiffering).toBe(0);
      // The feed is a lit room over a blank screen: most of the quad moves.
      context.expect(insideDiffering).toBeGreaterThan(((right - left) * (bottom - top)) / 3);
    },
  };
}
