import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { ColorHandle, DepthHandle } from '~/core/render-graph/ResourceHandle';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import type { ForwardRenderPassOptions } from '~/core/render-passes/ForwardRenderPass';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext } from '~/post-processing/Pass3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { PointLight } from '~/scene/lights/PointLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function readPixel(gl: WebGL2RenderingContext, x: number, y: number): number[] {
  const pixel = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return [pixel[0], pixel[1], pixel[2]];
}

function wallView(size: number): View3D {
  const view3d = new View3D({ width: size, height: size });
  view3d.camera.position.set(0, 0, 5);
  view3d.root.addChild(
    new Mesh3D({
      geometry: new PlaneGeometry({ width: 8, height: 8 }),
      material: new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1, doubleSided: true }),
      castShadow: false,
      receiveShadow: false,
    }),
  );
  return view3d;
}

class TargetForwardPass extends ForwardRenderPass {
  public center: number[] = [];

  constructor(
    options: ForwardRenderPassOptions,
    private readonly _color: ColorHandle,
    private readonly _depth: DepthHandle,
    private readonly _size: number,
  ) {
    super(options);
  }

  public override setup(builder: PassBuilder): void {
    builder.writeColor(this._color);
    builder.writeDepth(this._depth);
  }

  public override render(session: RenderSession): void {
    super.render(session);
    this.center = readPixel((session.renderer as WebGLRenderer).gl, this._size / 2, this._size / 2);
  }
}

class SmallTargetPass extends Pass3D {
  public readonly stage = 'beforeOpaque';
  public forward: TargetForwardPass | null = null;

  constructor(
    private readonly _camera: Camera3D,
    private readonly _size: number,
  ) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const color = graph.createColor({ width: this._size, height: this._size, resolution: 1 });
    const depth = graph.createDepth({ width: this._size, height: this._size, resolution: 1 });
    this.forward = new TargetForwardPass(
      { renderer: ctx.renderer, name: 'opaque', sort: 'key', camera: this._camera },
      color,
      depth,
      this._size,
    );
    graph.addPass(this.forward);
    graph.addPass({
      name: 'readLightTileTarget',
      setup(builder) {
        builder.read(color);
        builder.writeColor(builder.defaultColor);
        builder.writeDepth(builder.defaultDepth);
      },
      render() {},
    });
  }
}

describe('light tile rendering (WebGL)', () => {
  it('renders light 31, keeps it lit when it moves to slot 0, and drops it when the list becomes empty', async () => {
    const size = 128;
    const app = await getApp<WebGLRenderer>({
      id: 'light-tiles-light-count',
      appOptions: { preference: 'webgl', width: size, height: size, backgroundColor: 0, autoStart: false },
    });
    const view3d = wallView(size);
    app.stage.addChild(view3d);

    try {
      const offscreen: PointLight[] = [];
      for (let i = 0; i < 31; i++) {
        const light = new PointLight({ range: 1, intensity: 50, castShadow: false });
        light.position.set(100, 0, 1);
        offscreen.push(light);
        view3d.root.addChild(light);
      }

      const light = new PointLight({ range: 1.25, intensity: 50, castShadow: false });
      light.position.set(0, 0, 1);
      view3d.root.addChild(light);

      app.render();
      const lastSlot = readPixel(app.renderer.gl, size / 2, size / 2);
      expect(lastSlot[0]).toBeGreaterThan(30);

      for (const hidden of offscreen) hidden.destroy();
      app.render();
      const firstSlot = readPixel(app.renderer.gl, size / 2, size / 2);
      expect(firstSlot).toEqual(lastSlot);

      light.destroy();
      app.render();
      expect(readPixel(app.renderer.gl, size / 2, size / 2)).toEqual([0, 0, 0]);
    } finally {
      view3d.destroy(true);
      app.destroy();
    }
  });

  it('uses the live viewport when a forward pass writes a smaller custom target', async () => {
    const size = 512;
    const app = await getApp<WebGLRenderer>({
      id: 'light-tiles-custom-target',
      appOptions: { preference: 'webgl', width: size, height: size, backgroundColor: 0, autoStart: false },
    });
    const view3d = wallView(size);
    app.stage.addChild(view3d);

    try {
      const camera = new Camera3D();
      camera.position.copyFrom(view3d.camera.position);
      view3d.root.addChild(camera);
      const pass = new SmallTargetPass(camera, 128);
      view3d.passes = [pass];

      const light = new PointLight({ range: 1.25, intensity: 50, castShadow: false });
      light.position.set(0, 0, 1);
      view3d.root.addChild(light);

      app.render();

      expect(
        pass.forward?.center[0],
        'the light reaches the 128px target centre, which the 512px viewport would map to a lower-left tile',
      ).toBeGreaterThan(30);
      expect(readPixel(app.renderer.gl, size / 2, size / 2)[0], 'the light reaches the canvas centre').toBeGreaterThan(
        30,
      );
    } finally {
      view3d.destroy(true);
      app.destroy();
    }
  });
});
