import { getApp, renderFrame } from '@test-utils';
import { RenderTexture } from 'pixi.js';
import type { Application, Renderer, Shader, Texture, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { MERGE_THRESHOLD } from '~/core/batcher/batchConstants';
import type { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';
import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { ColorHandle } from '~/core/render-graph/ResourceHandle';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { velocityOutput } from '~/extras/scene-outputs/velocityOutput';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { FullscreenPass } from '~/post-processing/effects/FullscreenPass';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 32;
const RESOLUTION = 2;
const PHYSICAL = SIZE * RESOLUTION;
const WORLD_PER_PIXEL = 20 / PHYSICAL;

interface Frame {
  width: number;
  height: number;
  velocity: Float32Array;
  covered: Uint8Array;
}

interface PendingCopy {
  buffer: GPUBuffer;
  bytesPerRow: number;
}

class VelocityReadbackPass {
  public readonly name = 'velocityReadback';
  public readonly bit = RenderPassBit.NONE;
  private _pending: { velocity: PendingCopy; color: PendingCopy; width: number; height: number } | null = null;
  private _frame: Frame | null = null;

  constructor(
    private readonly _velocity: ColorHandle,
    private readonly _sceneColor: ColorHandle,
  ) {}

  public setup(b: PassBuilder): void {
    b.read(this._velocity);
    b.read(this._sceneColor);
    b.sideEffect();
  }

  public render(session: RenderSession): void {
    const graph = session.view3d._graph;
    const velocity = graph.getTexture(this._velocity, session);
    const color = graph.getTexture(this._sceneColor, session);
    const width = Math.round(velocity.frame.width * velocity.source.resolution);
    const height = Math.round(velocity.frame.height * velocity.source.resolution);

    if (session.renderer.name === 'webgpu') {
      const renderer = session.renderer as WebGPURenderer;
      if (this._pending) {
        this._pending.velocity.buffer.destroy();
        this._pending.color.buffer.destroy();
      }
      renderer.renderTarget.finishRenderPass();
      session.activeTarget = null;
      const copy = (texture: Texture): PendingCopy => {
        const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
        const buffer = renderer.gpu.device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        renderer.encoder.commandEncoder.copyTextureToBuffer(
          { texture: renderer.texture.getGpuSource(texture.source) },
          { buffer, bytesPerRow },
          { width, height },
        );
        return { buffer, bytesPerRow };
      };
      this._pending = { velocity: copy(velocity), color: copy(color), width, height };
      return;
    }

    const renderer = session.renderer as WebGLRenderer;
    const gl = renderer.gl;
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const attach = (texture: Texture): void => {
      const glTexture = renderer.texture.getGlSource(texture.source).texture;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glTexture, 0);
    };

    attach(velocity);
    const rgba = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, rgba);
    attach(color);
    const bytes = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    gl.deleteFramebuffer(framebuffer);
    session.activeTarget = null;

    const frame: Frame = {
      width,
      height,
      velocity: new Float32Array(width * height * 2),
      covered: new Uint8Array(width * height),
    };
    for (let i = 0; i < width * height; i++) {
      frame.velocity[i * 2] = rgba[i * 4];
      frame.velocity[i * 2 + 1] = rgba[i * 4 + 1];
      frame.covered[i] = bytes[i * 4 + 3] > 127 ? 1 : 0;
    }
    this._frame = frame;
  }

  public async read(): Promise<Frame> {
    const pending = this._pending;
    if (pending) {
      this._pending = null;
      const { width, height } = pending;
      const frame: Frame = {
        width,
        height,
        velocity: new Float32Array(width * height * 2),
        covered: new Uint8Array(width * height),
      };

      await pending.velocity.buffer.mapAsync(GPUMapMode.READ);
      const halves = new Float16Array(pending.velocity.buffer.getMappedRange());
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width * 2; x++) {
          frame.velocity[y * width * 2 + x] = halves[(y * pending.velocity.bytesPerRow) / 2 + x];
        }
      }

      await pending.color.buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(pending.color.buffer.getMappedRange());
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          frame.covered[y * width + x] = bytes[y * pending.color.bytesPerRow + x * 4 + 3] > 127 ? 1 : 0;
        }
      }

      for (const copy of [pending.velocity, pending.color]) {
        copy.buffer.unmap();
        copy.buffer.destroy();
      }
      this._frame = frame;
    }
    if (!this._frame) throw new Error('the readback pass did not run');
    const frame = this._frame;
    this._frame = null;
    return frame;
  }
}

class VelocityCapture extends Pass3D {
  public readonly stage = 'afterTransparent';
  public readonly requiredOutputs = [velocityOutput];
  public readback: VelocityReadbackPass | null = null;

  public build(graph: RenderGraph): void {
    this.readback = graph.addPass(new VelocityReadbackPass(graph.getSceneOutput(velocityOutput), graph.sceneColor));
  }

  public read(): Promise<Frame> {
    return this.readback!.read();
  }
}

class SceneColorFill extends Pass3D {
  public readonly stage = 'beforeOpaque';

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new FullscreenPass({
        renderer: ctx.renderer,
        label: 'sceneColorFill',
        fragment: {
          gpu: 'fn effect(uv: vec2<f32>) -> vec4<f32> { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }',
          gl: 'vec4 effect(vec2 uv) { return vec4(1.0, 0.0, 0.0, 1.0); }',
        },
        writes: graph.sceneColor,
      }),
    );
  }
}

class PlainPass extends Pass3D {
  public readonly stage = 'afterTransparent';
  public context: PassContext | null = null;

  public build(_graph: RenderGraph, ctx: PassContext): void {
    this.context = ctx;
  }
}

function at(frame: Frame, x: number, y: number): [number, number] {
  const i = (y * frame.width + x) * 2;
  return [frame.velocity[i], frame.velocity[i + 1]];
}

function largest(frame: Frame): number {
  let max = 0;
  for (let i = 0; i < frame.velocity.length; i++) max = Math.max(max, Math.abs(frame.velocity[i]));
  return max;
}

function expectCoveredReads(frame: Frame, u: number, v: number): void {
  const wrong: string[] = [];
  let covered = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const [ru, rv] = at(frame, x, y);
      if (!frame.covered[y * frame.width + x]) {
        if (ru !== 0 || rv !== 0) wrong.push(`nothing drawn at ${x}, ${y}, but it reads ${ru}, ${rv}`);
        continue;
      }
      covered++;
      if (Math.abs(ru - u) > 1e-4 || Math.abs(Math.abs(rv) - v) > 1e-4) wrong.push(`${x}, ${y} reads ${ru}, ${rv}`);
    }
  }
  expect(wrong.slice(0, 8), 'each covered texel reads the move, in size for v, and the rest read zero').toEqual([]);
  expect(covered, 'the mesh is in view').toBeGreaterThan(0);
}

function gpuCopies(app: Application<Renderer>, store: DataStoreBuffer<Mesh3D>): number {
  const { _buffer, _textureSource } = store as unknown as Record<string, { _gpuData: Record<number, unknown> } | null>;
  return [_buffer, _textureSource].filter((view) => view?._gpuData[app.renderer.uid]).length;
}

function plane(width: number, height: number, alphaMode: 'opaque' | 'blend' = 'opaque'): Mesh3D {
  return new Mesh3D({
    geometry: new PlaneGeometry({ width, height }),
    material: new FlatMaterial({ doubleSided: true, alphaMode, alpha: alphaMode === 'blend' ? 0.5 : 1 }),
  });
}

function shaderOutputs(app: Application<Renderer>, shader: Shader): number | null {
  return app.renderer.name === 'webgpu' ? shader.gpuProgram.fragmentOutputMask : shader.glProgram.fragmentOutputMask;
}

function materialShaderOutputs(app: Application<Renderer>, mesh: Mesh3D): number | null {
  return shaderOutputs(app, mesh._passCache[mesh.material._passBit & RenderPassBit.MATERIAL_PASS_MASK].shader);
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`velocity output (${preference})`, () => {
    let app: Application<Renderer>;
    let view3d: View3D;

    async function setup(id: string, passes: Pass3D[], width = SIZE, height = SIZE): Promise<void> {
      app = await getApp<Renderer>({
        id: `velocity-${id}-${preference}`,
        appOptions: {
          preference,
          width,
          height,
          resolution: RESOLUTION,
          backgroundColor: 0x000000,
          autoStart: false,
        },
      });
      expect(app.renderer.name).toBe(preference);
      view3d = new View3D({ toneMapping: 'none', width, height, passes });
      app.stage.addChild(view3d);
    }

    afterEach(() => {
      view3d?.destroy(true);
      app?.destroy();
    });

    it('reads a pan as the UV the surface moved, so uv - velocity lands on it in the previous frame', async () => {
      const capture = new VelocityCapture();
      await setup('pan', [capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);

      const wall = plane(100, 100);
      wall.position.set(-50, 50, 0);
      view3d.root.addChild(wall);

      await renderFrame(app);
      const before = await capture.read();

      view3d.camera.position.set(-2 * WORLD_PER_PIXEL, 4 * WORLD_PER_PIXEL, 10);
      await renderFrame(app);
      const after = await capture.read();

      expect(after.width).toBe(PHYSICAL);
      expect(after.height).toBe(PHYSICAL);

      const count = (frame: Frame): number => frame.covered.reduce((sum, c) => sum + c, 0);
      expect(count(before), 'the wall fills a quarter of the image').toBe((PHYSICAL / 2) ** 2);
      expect(count(after), 'the pan brings 2 more columns and 4 more rows of it in').toBe(
        (PHYSICAL / 2 + 2) * (PHYSICAL / 2 + 4),
      );

      const wrong: string[] = [];
      let traced = 0;
      for (let y = 0; y < PHYSICAL; y++) {
        for (let x = 0; x < PHYSICAL; x++) {
          const i = y * PHYSICAL + x;
          const [u, v] = at(after, x, y);
          if (!after.covered[i]) {
            if (u !== 0 || v !== 0) wrong.push(`nothing drawn at ${x}, ${y}, but it reads ${u}, ${v}`);
            continue;
          }
          if (Math.abs(u - 2 / PHYSICAL) > 1e-4 || Math.abs(Math.abs(v) - 4 / PHYSICAL) > 1e-4) {
            wrong.push(`${x}, ${y} reads ${u}, ${v}`);
          }

          const px = Math.round(x - u * PHYSICAL);
          const py = Math.round(y - v * PHYSICAL);
          if (px < 0 || py < 0 || px >= PHYSICAL || py >= PHYSICAL) continue;
          if (!before.covered[py * PHYSICAL + px]) wrong.push(`${x}, ${y} came from ${px}, ${py}, which was empty`);
          if (!before.covered[i]) traced++;
        }
      }
      expect(wrong).toEqual([]);
      expect(traced, 'texels the pan uncovered, traced back onto the wall').toBeGreaterThan((4 * PHYSICAL) / 2);
    });

    it("reads a mesh's own move in front of a still camera", async () => {
      const capture = new VelocityCapture();
      await setup('object', [capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const square = plane(8, 8);
      view3d.root.addChild(square);

      await renderFrame(app);
      await capture.read();
      square.position.set(2 * WORLD_PER_PIXEL, -4 * WORLD_PER_PIXEL, 0);
      await renderFrame(app);
      expectCoveredReads(await capture.read(), 2 / PHYSICAL, 4 / PHYSICAL);

      await renderFrame(app);
      expect(largest(await capture.read()), 'it reads zero once it stops').toBeLessThan(1e-4);
    });

    it("adds the mesh's move to the camera's, in perspective", async () => {
      const capture = new VelocityCapture();
      await setup('object-perspective', [capture]);
      view3d.camera.position.set(0, 0, 10);
      const square = plane(2, 2);
      view3d.root.addChild(square);
      const halfHeight = 10 * Math.tan((view3d.camera.fov * Math.PI) / 360);
      const centre = PHYSICAL / 2;

      await renderFrame(app);
      await capture.read();
      square.position.set(0.4, -0.25, 0);
      await renderFrame(app);
      const [u, v] = at(await capture.read(), centre, centre);
      expect(u, 'a 0.4 move right, 10 units away').toBeCloseTo(0.4 / (2 * halfHeight), 4);
      expect(Math.abs(v)).toBeCloseTo(0.25 / (2 * halfHeight), 4);

      square.position.set(0.8, -0.5, 0);
      view3d.camera.position.set(0.2, 0.1, 10);
      await renderFrame(app);
      const [both, bothV] = at(await capture.read(), centre, centre);
      expect(both, 'the mesh moves 0.4 right as the camera moves 0.2 right').toBeCloseTo(0.2 / (2 * halfHeight), 4);
      expect(Math.abs(bothV)).toBeCloseTo(0.35 / (2 * halfHeight), 4);
    });

    it('reads a mesh that moves with the camera as still, and the wall behind it as panning', async () => {
      const capture = new VelocityCapture();
      await setup('cockpit', [capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      view3d.root.addChild(plane(400, 400));
      const cockpit = plane(4, 4);
      cockpit.position.set(0, 0, 5);
      view3d.root.addChild(cockpit);

      await renderFrame(app);
      await capture.read();
      view3d.camera.position.set(-2 * WORLD_PER_PIXEL, 0, 10);
      cockpit.position.set(-2 * WORLD_PER_PIXEL, 0, 5);
      await renderFrame(app);
      const frame = await capture.read();

      const [u, v] = at(frame, PHYSICAL / 2, PHYSICAL / 2);
      expect(Math.abs(u)).toBeLessThan(1e-4);
      expect(Math.abs(v)).toBeLessThan(1e-4);
      expect(at(frame, 2, 2)[0], 'the wall').toBeCloseTo(2 / PHYSICAL, 4);
    });

    it("reads a BatchedMesh3D slot's move and the BatchedMesh3D's own", async () => {
      const capture = new VelocityCapture();
      await setup('batched', [capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const batched = new BatchedMesh3D({ size: 2 });
      const matrix = new Matrix4();
      for (let i = 0; i < 2; i++) {
        batched.setGeometryAt(i, new PlaneGeometry({ width: 4, height: 4 }));
        batched.setMaterialAt(i, new FlatMaterial({ doubleSided: true }));
        batched.setPassesAt(i, RenderPassBit.OPAQUE);
      }
      batched.setMatrixAt(0, matrix.makeTranslation(-4, 0, 0));
      batched.setMatrixAt(1, matrix.makeTranslation(4, 0, 0));
      view3d.root.addChild(batched);
      const left = Math.round(PHYSICAL * (6 / 20));
      const right = PHYSICAL - left;
      const row = PHYSICAL / 2;

      await renderFrame(app);
      await capture.read();
      batched.setMatrixAt(1, matrix.makeTranslation(4 + 2 * WORLD_PER_PIXEL, 0, 0));
      await renderFrame(app);
      const slot = await capture.read();
      expect(at(slot, right, row)[0], 'the slot that moved').toBeCloseTo(2 / PHYSICAL, 4);
      expect(Math.abs(at(slot, left, row)[0]), 'the slot that held still').toBeLessThan(1e-4);

      batched.position.set(0, 4 * WORLD_PER_PIXEL, 0);
      await renderFrame(app);
      const node = await capture.read();
      expect(Math.abs(at(node, left, row)[1]), 'moving the node moves every slot').toBeCloseTo(4 / PHYSICAL, 4);
      expect(Math.abs(at(node, right, row)[1])).toBeCloseTo(4 / PHYSICAL, 4);
      expect(at(node, right, row)[0]).toBeCloseTo(0, 4);
    });

    it('reads each mesh its own move when their materials draw merged', async () => {
      const capture = new VelocityCapture();
      await setup('merged', [capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const geometry = new PlaneGeometry({ width: 1, height: 1 });
      const tiles: Mesh3D[] = [];
      for (let i = 0; i < MERGE_THRESHOLD + 4; i++) {
        const tile = new Mesh3D({ geometry, material: new FlatMaterial({ doubleSided: true }) });
        tile.position.set((i % 5) * 2 - 4, Math.floor(i / 5) * 2 - 4, 0);
        view3d.root.addChild(tile);
        tiles.push(tile);
      }

      await renderFrame(app);
      await capture.read();
      for (const tile of tiles) tile.position.x += 2 * WORLD_PER_PIXEL;
      await renderFrame(app);
      expectCoveredReads(await capture.read(), 2 / PHYSICAL, 0);

      const commands = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
      expect(commands.count, 'one merged command draws every tile').toBe(1);
    });

    it("reads zero on a mesh's first frame, though it takes the row a removed mesh left", async () => {
      const capture = new VelocityCapture();
      await setup('new-mesh', [capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const leaving = plane(4, 4);
      leaving.position.set(-5, 0, 0);
      view3d.root.addChild(leaving);

      await renderFrame(app);
      await capture.read();
      const row = leaving._storeIndex;
      view3d.root.removeChild(leaving);
      const joining = plane(4, 4);
      joining.position.set(5, 0, 0);
      view3d.root.addChild(joining);
      await renderFrame(app);

      expect(joining._storeIndex, 'the new mesh reuses the store row').toBe(row);
      expect(largest(await capture.read())).toBeLessThan(1e-4);
      leaving.destroy();
    });

    it('reads UV across the view, not across the pooled texture, on a view of no power-of-two size', async () => {
      const capture = new VelocityCapture();
      await setup('npot', [capture], 24, 20);
      const width = 24 * RESOLUTION;
      const height = 20 * RESOLUTION;
      const worldPerPixel = 20 / width;
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      view3d.root.addChild(plane(400, 400));

      await renderFrame(app);
      await capture.read();
      view3d.camera.position.set(-2 * worldPerPixel, 0, 10);
      await renderFrame(app);
      const frame = await capture.read();

      expect(frame.width).toBe(width);
      expect(frame.height).toBe(height);
      const [u, v] = at(frame, width / 2, height / 2);
      expect(u).toBeCloseTo(2 / width, 4);
      expect(v).toBeCloseTo(0, 4);
    });

    it('reads the same UV at half resolution, from a half-size texture', async () => {
      const capture = new VelocityCapture();
      await setup('half', [capture]);
      view3d.resolution = RESOLUTION / 2;
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      view3d.root.addChild(plane(400, 400));

      await renderFrame(app);
      await capture.read();
      view3d.camera.position.set(-4 * WORLD_PER_PIXEL, 0, 10);
      await renderFrame(app);
      const frame = await capture.read();

      expect([frame.width, frame.height]).toEqual([SIZE, SIZE]);
      const [u, v] = at(frame, SIZE / 2, SIZE / 2);
      expect(u, 'four screen pixels of pan, as a fraction of the view').toBeCloseTo(4 / PHYSICAL, 4);
      expect(v).toBeCloseTo(0, 4);
    });

    it("compares each render with the camera's last one, whatever target that drew into", async () => {
      const capture = new VelocityCapture();
      await setup('twice', [capture]);
      const rt = RenderTexture.create({ width: SIZE, height: SIZE, resolution: RESOLUTION });
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      view3d.root.addChild(plane(400, 400));

      await renderFrame(app);
      await capture.read();

      view3d.camera.position.set(-2 * WORLD_PER_PIXEL, 0, 10);
      app.renderer.render({ container: view3d, target: rt });
      const [u, v] = at(await capture.read(), PHYSICAL / 2, PHYSICAL / 2);
      expect(u, 'the texture render reads the move since the canvas render').toBeCloseTo(2 / PHYSICAL, 4);
      expect(v).toBeCloseTo(0, 4);

      await renderFrame(app);
      expect(largest(await capture.read()), 'a second render of the same frame reads no motion').toBeLessThan(1e-4);
      rt.destroy(true);
    });

    it('clears the velocity alone when a beforeOpaque pass drew the scene colour first', async () => {
      const capture = new VelocityCapture();
      await setup('fill', [new SceneColorFill(), capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const wall = plane(100, 100);
      wall.position.set(-50, 50, 0);
      view3d.root.addChild(wall);

      await renderFrame(app);
      await capture.read();
      view3d.camera.position.set(-2 * WORLD_PER_PIXEL, 0, 10);
      await renderFrame(app);
      const moved = await capture.read();

      expect(
        moved.covered.every((c) => c === 1),
        "the fill survives the depth reset's bind",
      ).toBe(true);
      expect(largest(moved), 'the wall moved').toBeGreaterThan(1e-3);

      wall.position.set(-5000, 5000, 0);
      view3d.camera.position.set(-4 * WORLD_PER_PIXEL, 0, 10);
      await renderFrame(app);
      const empty = await capture.read();

      expect(empty.covered.every((c) => c === 1)).toBe(true);
      expect(largest(empty), "last frame's motion is cleared where nothing writes velocity now").toBe(0);
    });

    it('takes the jitter out, so a still camera with a changing jitter reads zero', async () => {
      const capture = new VelocityCapture();
      await setup('jitter', [capture]);
      view3d.camera.position.set(0, 0, 10);
      view3d.root.addChild(plane(400, 400));

      view3d.camera.jitter.set(0.25, -0.25);
      await renderFrame(app);
      await capture.read();

      view3d.camera.jitter.set(-0.4, 0.3);
      await renderFrame(app);
      expect(largest(await capture.read())).toBeLessThan(1e-4);

      view3d.camera.jitter.set(0.5, 0.5);
      await renderFrame(app);
      expect(largest(await capture.read())).toBeLessThan(1e-4);
    });

    it('leaves the opaque motion under a blended surface, which writes none', async () => {
      const capture = new VelocityCapture();
      await setup('glass', [capture]);
      view3d.camera.position.set(0, 0, 10);
      view3d.root.addChild(plane(400, 400));

      const glass = plane(4, 4, 'blend');
      glass.position.set(0, 0, 5);
      view3d.root.addChild(glass);

      const centre = PHYSICAL / 2;
      const corner = 2;

      await renderFrame(app);
      await capture.read();
      view3d.camera.position.set(0.5, 0, 10);
      await renderFrame(app);
      const blended = await capture.read();

      const wallMotion = at(blended, corner, corner);
      expect(wallMotion[0]).toBeLessThan(-1e-3);
      expect(at(blended, centre, centre)[0]).toBeCloseTo(wallMotion[0], 4);
      expect(at(blended, centre, centre)[1]).toBeCloseTo(wallMotion[1], 4);
      expect(materialShaderOutputs(app, glass), 'the blended material writes colour alone').toBe(0b1);

      glass.material.alphaMode = 'opaque';
      view3d.camera.position.set(0, 0, 10);
      await renderFrame(app);
      await capture.read();
      view3d.camera.position.set(0.5, 0, 10);
      await renderFrame(app);
      const opaque = await capture.read();

      expect(at(opaque, centre, centre)[0], 'the same quad drawn opaque writes its own, larger motion').toBeLessThan(
        wallMotion[0] * 1.5,
      );
      expect(materialShaderOutputs(app, glass)).toBe(0b11);
    });

    it('leaves the opaque motion under a transmissive surface, which writes none', async () => {
      const capture = new VelocityCapture();
      await setup('transmission', [capture]);
      view3d.camera.position.set(0, 0, 10);
      view3d.root.addChild(plane(400, 400));

      const glass = new Mesh3D({
        geometry: new PlaneGeometry({ width: 4, height: 4 }),
        material: new Material3D({ doubleSided: true, transmission: { factor: 1 } }),
      });
      glass.position.set(0, 0, 5);
      view3d.root.addChild(glass);

      await renderFrame(app);
      await capture.read();
      view3d.camera.position.set(0.5, 0, 10);
      await renderFrame(app);
      const frame = await capture.read();

      const centre = PHYSICAL / 2;
      const wallMotion = at(frame, 2, 2);
      expect(wallMotion[0]).toBeLessThan(-1e-3);
      expect(at(frame, centre, centre)[0]).toBeCloseTo(wallMotion[0], 4);
      expect(at(frame, centre, centre)[1]).toBeCloseTo(wallMotion[1], 4);
      expect(materialShaderOutputs(app, glass), 'the transmissive material writes colour alone').toBe(0b1);
    });

    it("reads zero on a camera's first render", async () => {
      const capture = new VelocityCapture();
      await setup('first', [capture]);
      view3d.camera.position.set(0, 0, 10);
      view3d.camera.jitter.set(0.3, -0.2);
      view3d.root.addChild(plane(400, 400));

      await renderFrame(app);
      expect(largest(await capture.read())).toBeLessThan(1e-4);

      view3d.camera.position.set(1, 0, 10);
      await renderFrame(app);
      expect(largest(await capture.read()), 'the second render does move').toBeGreaterThan(1e-3);

      const next = new Camera3D();
      next.position.set(-3, 2, 12);
      next.jitter.set(-0.1, 0.4);
      view3d.camera = next;
      await renderFrame(app);
      expect(largest(await capture.read()), "the new camera's first render").toBeLessThan(1e-4);
    });

    it('draws the velocity-writing materials into a target with no velocity attachment', async () => {
      const feed = RenderTexture.create({ width: 16, height: 16, resolution: 1 });
      const feedCamera = new Camera3D({ renderTexture: feed });
      const capture = new VelocityCapture();
      await setup('feed', [new MeshPass({ name: 'opaque', camera: feedCamera, stage: 'beforeOpaque' }), capture]);
      feedCamera.position.set(0, 0, 10);
      view3d.root.addChild(feedCamera);
      view3d.camera.position.set(0, 0, 10);
      const wall = plane(400, 400);
      view3d.root.addChild(wall);

      await renderFrame(app);
      await capture.read();
      expect(materialShaderOutputs(app, wall)).toBe(0b11);

      const pixels = app.renderer.extract.pixels({ target: feed }).pixels;
      expect(pixels[0], "the feed drew the wall through the material's colour output").toBe(255);
      expect(pixels[3]).toBe(255);
      feed.destroy(true);
    });

    it('costs nothing when no pass uses it, and re-keys the materials when one does', async () => {
      const plain = new PlainPass();
      await setup('off', [plain]);
      view3d.camera.position.set(0, 0, 10);
      const wall = plane(400, 400);
      view3d.root.addChild(wall);

      await renderFrame(app);

      expect(view3d._graph.sceneOutputs).toEqual([]);
      expect(view3d._sceneBatch.storeBuffer.previous, "no copy of last frame's transforms").toBeNull();
      expect(view3d._graph.sceneColor, 'the view still draws straight to the screen').toBe(view3d._graph.defaultColor);
      expect(view3d.passByBit[RenderPassBit.OPAQUE].outputLocations).toEqual(['color']);
      expect(materialShaderOutputs(app, wall)).toBe(0b1);

      const capture = new VelocityCapture();
      view3d.passes = [plain, capture];
      await renderFrame(app);
      await capture.read();

      expect(view3d._graph.sceneOutputs, 'the graph attaches what the capture requires').toEqual([velocityOutput]);
      const previous = view3d._sceneBatch.storeBuffer.previous!;
      expect(previous, "the scene keeps last frame's transforms").not.toBeNull();
      expect(gpuCopies(app, previous)).toBe(1);
      expect(view3d._graph.sceneColor, 'requiring velocity composites').not.toBe(view3d._graph.defaultColor);
      expect(view3d.passByBit[RenderPassBit.OPAQUE].outputLocations).toEqual(['color', 'velocity']);
      expect(materialShaderOutputs(app, wall)).toBe(0b11);

      capture.enabled = false;
      await renderFrame(app);

      expect(view3d._sceneBatch.storeBuffer.previous).toBeNull();
      expect(gpuCopies(app, previous), "the copy's GPU memory is freed").toBe(0);
      expect(view3d.passByBit[RenderPassBit.OPAQUE].outputLocations).toEqual(['color']);
      expect(view3d._graph.sceneColor).toBe(view3d._graph.defaultColor);
      expect(materialShaderOutputs(app, wall)).toBe(0b1);
    });

    it("frees the copy of last frame's transforms with the view's unload, and makes it again on the next render", async () => {
      const capture = new VelocityCapture();
      await setup('unload', [capture]);
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const square = plane(8, 8);
      view3d.root.addChild(square);
      await renderFrame(app);
      await capture.read();
      const previous = view3d._sceneBatch.storeBuffer.previous!;
      expect(gpuCopies(app, previous)).toBe(1);

      view3d.unload();
      expect(gpuCopies(app, previous)).toBe(0);

      await renderFrame(app);
      await capture.read();
      expect(gpuCopies(app, previous)).toBe(1);
      square.position.set(2 * WORLD_PER_PIXEL, 0, 0);
      await renderFrame(app);
      expectCoveredReads(await capture.read(), 2 / PHYSICAL, 0);
    });
  });
}
