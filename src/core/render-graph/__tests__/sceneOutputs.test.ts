import { getApp, renderFrame } from '@test-utils';
import { Geometry, GlProgram, RenderTexture, Shader, Sprite, State, Texture } from 'pixi.js';
import type { Application, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { assertSceneOutput, sameSceneOutput } from '~/core/render-graph/SceneOutput';
import type { SceneOutput } from '~/core/render-graph/SceneOutput';
import { collectSceneOutputs } from '~/core/render-graph/sceneOutputs';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { FullscreenPass } from '~/post-processing/effects/FullscreenPass';
import { PostEffect } from '~/post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO } from '~/post-processing/effects/PostEffect';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 32;

const maskOutput: SceneOutput = { name: 'mask', format: 'r8unorm' };

const motionOutput: SceneOutput = { name: 'motion', format: 'rg16float' };

const maskBit: ShaderBit = {
  name: 'testSceneOutputMask',
  outputs: { mask: 'f32' },
  gpu: { fragment: { end: 'outputs.mask = 1.0;' } },
  gl: { fragment: { end: 'outputs.mask = 1.0;' } },
};

const coverOutputBit: ShaderBit = {
  name: 'testSceneOutputCover',
  outputs: { cover: 'vec4<f32>' },
  gpu: { fragment: { end: 'outputs.cover = vec4<f32>(1.0);' } },
  gl: { fragment: { end: 'outputs.cover = vec4(1.0);' } },
};

const coverOutput: SceneOutput = { name: 'cover', format: 'rgba8unorm', bits: { transparent: coverOutputBit } };

const SHOW_RED: EffectFragment = {
  gpu: 'fn effect(uv: vec2<f32>) -> vec4<f32> { return vec4<f32>(sampleColor(uv).r, 0.0, 0.0, 1.0); }',
  gl: 'vec4 effect(vec2 uv) { return vec4(sampleColor(uv).r, 0.0, 0.0, 1.0); }',
};

const HALF: EffectFragment = {
  gpu: 'fn effect(uv: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.5); }',
  gl: 'vec4 effect(vec2 uv) { return vec4(0.5); }',
};

class ShowOutput extends PostEffect {
  public override readonly requiredOutputs: readonly SceneOutput[];

  constructor(private readonly _output: SceneOutput) {
    super({ stage: 'afterToneMapping' });
    this.requiredOutputs = [_output];
  }

  public override build(graph: RenderGraph, io: EffectIO): void {
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'showOutput',
        fragment: SHOW_RED,
        reads: { color: graph.getSceneOutput(this._output) },
        writes: io.output,
      }),
    );
  }
}

class FillOutput extends Pass3D {
  public readonly stage: PassStage = 'afterOpaque';
  public readonly requiredOutputs: readonly SceneOutput[];

  constructor(private readonly _output: SceneOutput) {
    super();
    this.requiredOutputs = [_output];
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new FullscreenPass({
        renderer: ctx.renderer,
        label: 'fillOutput',
        fragment: HALF,
        writes: graph.getSceneOutput(this._output),
      }),
    );
  }
}

class CopyOutput extends Pass3D {
  public readonly stage: PassStage = 'afterTransparent';
  public readonly requiredOutputs: readonly SceneOutput[];

  constructor(
    private readonly _output: SceneOutput,
    private readonly _into: RenderTexture,
  ) {
    super();
    this.requiredOutputs = [_output];
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new FullscreenPass({
        renderer: ctx.renderer,
        label: 'copyOutput',
        fragment: SHOW_RED,
        reads: { color: graph.getSceneOutput(this._output) },
        writes: graph.importColor(() => this._into),
      }),
    );
  }
}

class PaintSceneColor extends Pass3D {
  public readonly stage: PassStage = 'beforeOpaque';

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new FullscreenPass({
        renderer: ctx.renderer,
        label: 'paintSceneColor',
        fragment: HALF,
        writes: graph.sceneColor,
      }),
    );
  }
}

const OBJECT_ID = 7;

const objectIdBit: ShaderBit = {
  name: 'testSceneOutputObjectId',
  outputs: { objectId: 'u32' },
  gpu: { fragment: { end: `outputs.objectId = ${OBJECT_ID}u;` } },
  gl: { fragment: { end: `outputs.objectId = ${OBJECT_ID}u;` } },
};

class ReadIdGl extends Pass3D {
  public readonly stage: PassStage = 'afterTransparent';
  public readonly requiredOutputs: readonly SceneOutput[];
  private readonly _geometry = new Geometry({
    attributes: { aPosition: { buffer: new Float32Array([-1, -1, 3, -1, -1, 3]), format: 'float32x2' } },
  });
  private readonly _shader = new Shader({
    glProgram: GlProgram.from({
      vertex: '#version 300 es\nin vec2 aPosition; void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }',
      fragment: `#version 300 es
        precision highp float;
        uniform highp usampler2D uIds;
        out vec4 fragColor;
        void main() {
          uint id = texelFetch(uIds, ivec2(${SIZE / 2}, ${SIZE / 2}), 0).r;
          fragColor = vec4(float(id) / 255.0, 0.0, 0.0, 1.0);
        }`,
    }),
    resources: { uIds: Texture.EMPTY.source },
  });

  constructor(
    private readonly _output: SceneOutput,
    private readonly _into: RenderTexture,
  ) {
    super();
    this.requiredOutputs = [_output];
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const ids = graph.getSceneOutput(this._output);
    const into = graph.importColor(() => this._into);
    const renderer = ctx.renderer as WebGLRenderer;
    graph.addPass({
      name: 'readId',
      setup: (b) => {
        b.read(ids);
        b.writeColor(into);
      },
      render: (session) => {
        this._shader.resources.uIds = graph.getTexture(ids, session).source;
        renderer.encoder.draw({ geometry: this._geometry, shader: this._shader, state: State.for2d(), size: 3 });
      },
    });
  }

  public override destroy(): void {
    this._shader.destroy();
    this._geometry.destroy();
  }
}

function red(pixels: Uint8ClampedArray, x: number, y: number): number {
  return pixels[(y * SIZE + x) * 4];
}

describe('assertSceneOutput', () => {
  it('rejects a name a shader field can not carry, a reserved word, and color', () => {
    for (const name of ['2d', 'object-id', '', 'Color', 'my_mask']) {
      expect(() => assertSceneOutput({ name, format: 'r8unorm' }), name).toThrow(/can't name a fragment output/);
    }
    for (const name of ['output', 'sample', 'loop', 'filter']) {
      expect(() => assertSceneOutput({ name, format: 'r8unorm' }), name).toThrow(/reserves the word/);
    }
    expect(() => assertSceneOutput({ name: 'color', format: 'r8unorm' })).toThrow(/the scene colour's own output/);
  });

  it('rejects a bit that does not declare the output', () => {
    const bit: ShaderBit = { name: 'myOtherOutputBit', outputs: { other: 'f32' } };
    expect(() => assertSceneOutput({ name: 'mask', format: 'r8unorm', bits: { opaque: bit } })).toThrow(
      /bit 'myOtherOutputBit' for the opaque pass doesn't declare it/,
    );
  });

  it('rejects a float output the transparent pass writes as less than a vec4, and allows an integer one', () => {
    const motionBit: ShaderBit = { name: 'myMotionBit', outputs: { motion: 'vec2<f32>' } };
    expect(() => assertSceneOutput({ name: 'motion', format: 'rg16float', bits: { transparent: motionBit } })).toThrow(
      /bit 'myMotionBit' for the transparent pass writes it as vec2<f32>/,
    );
    expect(() =>
      assertSceneOutput({ name: 'motion', format: 'rg16float', bits: { opaque: motionBit, transmission: motionBit } }),
    ).not.toThrow();

    const idBit: ShaderBit = { name: 'myIdBit', outputs: { pickId: 'u32' } };
    expect(() => assertSceneOutput({ name: 'pickId', format: 'r32uint', bits: { transparent: idBit } })).not.toThrow();
  });
});

describe('sameSceneOutput', () => {
  it('counts two objects with one name and the same content as one output, and any difference as two', () => {
    const copy: SceneOutput = { ...maskOutput };
    expect(sameSceneOutput(maskOutput, copy)).toBe(true);
    expect(sameSceneOutput(maskOutput, { ...maskOutput, format: 'rgba8unorm' })).toBe(false);
    expect(sameSceneOutput(maskOutput, { ...maskOutput, clearValue: [1, 0, 0, 1] })).toBe(false);
    expect(sameSceneOutput(coverOutput, { ...coverOutput, bits: {} })).toBe(false);
    expect(collectSceneOutputs([new FillOutput(maskOutput), new FillOutput(copy)])).toEqual([maskOutput]);
  });
});

describe('collectSceneOutputs', () => {
  it('collects each output once, sorted by name, and throws when two different outputs share a name', () => {
    const a = new FillOutput(maskOutput);
    const b = new FillOutput(motionOutput);
    const c = new FillOutput(maskOutput);

    expect(collectSceneOutputs([b, a, c])).toEqual([maskOutput, motionOutput]);

    const otherMask = new FillOutput({ name: 'mask', format: 'rgba8unorm' });
    expect(() => collectSceneOutputs([a, otherMask])).toThrow(
      /FillOutput uses a scene output named 'mask', and another pass uses a different one with that name/,
    );
  });

  it('adds the outputs given beside the ones the passes use, each once', () => {
    const mask = new FillOutput(maskOutput);

    expect(collectSceneOutputs([mask], [motionOutput, maskOutput])).toEqual([maskOutput, motionOutput]);
    expect(() => collectSceneOutputs([mask], [{ name: 'mask', format: 'rgba8unorm' }])).toThrow(
      /`sceneOutputs` uses a scene output named 'mask'/,
    );
  });
});

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`app-defined scene outputs (${preference})`, () => {
    let app: Application<Renderer>;
    let view3d: View3D;

    async function setup(id: string, passes: Pass3D[]): Promise<void> {
      app = await getApp<Renderer>({
        id: `scene-output-${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, autoStart: false },
      });
      expect(app.renderer.name).toBe(preference);
      view3d = new View3D({ width: SIZE, height: SIZE, passes });
      app.stage.addChild(view3d);
      view3d.camera.useOrthographic(SIZE, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
    }

    afterEach(() => {
      view3d?.destroy(true);
      app?.destroy();
    });

    it('is written only by the materials whose own bits declare it', async () => {
      await setup('material', [new ShowOutput(maskOutput)]);

      const masked = new Mesh3D({
        geometry: new PlaneGeometry({ width: SIZE, height: SIZE * 2 }),
        material: new FlatMaterial({ extraBits: [maskBit] }),
      });
      masked.position.set(-SIZE / 2, 0, 0);
      const plain = new Mesh3D({
        geometry: new PlaneGeometry({ width: SIZE, height: SIZE * 2 }),
        material: new FlatMaterial(),
      });
      plain.position.set(SIZE / 2, 0, 0);
      view3d.root.addChild(masked, plain);

      const pixels = await renderFrame(app);

      expect(view3d.passByBit[RenderPassBit.OPAQUE].outputLocations).toEqual(['color', 'mask']);
      expect(red(pixels, SIZE / 4, SIZE / 2), 'the material with the bit writes the mask').toBe(255);
      expect(red(pixels, (3 * SIZE) / 4, SIZE / 2), 'the plain material leaves it cleared').toBe(0);
    });

    it('is written by the passes its bits name, so a blended plane writes it and an opaque one leaves it', async () => {
      await setup('bits', [new ShowOutput(coverOutput)]);
      const opaque = new Mesh3D({
        geometry: new PlaneGeometry({ width: SIZE, height: SIZE * 2 }),
        material: new FlatMaterial(),
      });
      opaque.position.set(-SIZE / 2, 0, 0);
      const blended = new Mesh3D({
        geometry: new PlaneGeometry({ width: SIZE, height: SIZE * 2 }),
        material: new FlatMaterial({ alphaMode: 'blend' }),
      });
      blended.position.set(SIZE / 2, 0, 0);
      view3d.root.addChild(opaque, blended);

      const pixels = await renderFrame(app);

      expect(view3d.passByBit[RenderPassBit.TRANSPARENT].materialBits).toEqual([coverOutputBit]);
      expect(view3d.passByBit[RenderPassBit.OPAQUE].materialBits).toEqual([]);
      expect(red(pixels, SIZE / 4, SIZE / 2), 'the opaque plane leaves it cleared').toBe(0);
      expect(red(pixels, (3 * SIZE) / 4, SIZE / 2), 'the blended plane writes it').toBe(255);
    });

    it("clears each output to its own clearValue, and the scene colour to the bind's", async () => {
      const full: SceneOutput = { name: 'full', format: 'rgba8unorm', clearValue: [1, 0, 0, 1] };
      const half: SceneOutput = { name: 'halfRed', format: 'rgba8unorm', clearValue: [0.5, 0, 0, 1] };
      const fullCopy = RenderTexture.create({ width: SIZE, height: SIZE });
      const halfCopy = RenderTexture.create({ width: SIZE, height: SIZE });
      await setup('clear-value', [new CopyOutput(full, fullCopy), new CopyOutput(half, halfCopy)]);
      const plane = new Mesh3D({
        geometry: new PlaneGeometry({ width: SIZE, height: SIZE * 2 }),
        material: new FlatMaterial(),
      });
      plane.position.set(-SIZE / 2, 0, 0);
      view3d.root.addChild(plane);

      const pixels = await renderFrame(app);
      const fullPixels = app.renderer.extract.pixels({ target: fullCopy }).pixels;
      const halfPixels = app.renderer.extract.pixels({ target: halfCopy }).pixels;

      expect(red(fullPixels, (3 * SIZE) / 4, SIZE / 2), 'the output no draw writes holds its clear value').toBe(255);
      expect(Math.abs(red(halfPixels, (3 * SIZE) / 4, SIZE / 2) - 128), 'each output has its own').toBeLessThanOrEqual(
        1,
      );
      expect(red(pixels, (3 * SIZE) / 4, SIZE / 2), 'the scene colour clears as before').toBe(0);
      fullCopy.destroy(true);
      halfCopy.destroy(true);
    });

    it('clears an output to its clearValue when the scene colour a pass drew first is kept', async () => {
      const full: SceneOutput = { name: 'full', format: 'rgba8unorm', clearValue: [1, 0, 0, 1] };
      const copy = RenderTexture.create({ width: SIZE, height: SIZE });
      await setup('clear-alone', [new PaintSceneColor(), new CopyOutput(full, copy)]);
      const plane = new Mesh3D({
        geometry: new PlaneGeometry({ width: SIZE, height: SIZE * 2 }),
        material: new FlatMaterial(),
      });
      plane.position.set(-SIZE / 2, 0, 0);
      view3d.root.addChild(plane);

      const pixels = await renderFrame(app);
      const copied = app.renderer.extract.pixels({ target: copy }).pixels;

      expect(red(copied, (3 * SIZE) / 4, SIZE / 2), 'the output clears to its value').toBe(255);
      expect(
        Math.abs(red(pixels, (3 * SIZE) / 4, SIZE / 2) - 128),
        'the painted scene colour is kept',
      ).toBeLessThanOrEqual(1);
      copy.destroy(true);
    });

    it('copies upright into a render texture the app owns, so a sprite can show it', async () => {
      const copy = RenderTexture.create({ width: SIZE, height: SIZE });
      await setup('copy', [new CopyOutput(maskOutput, copy)]);
      const masked = new Mesh3D({
        geometry: new PlaneGeometry({ width: SIZE, height: SIZE / 2 }),
        material: new FlatMaterial({ extraBits: [maskBit] }),
      });
      masked.position.set(0, SIZE / 4, 0);
      view3d.root.addChild(masked);
      app.stage.addChild(new Sprite(copy));

      const pixels = await renderFrame(app);

      const column = Array.from({ length: SIZE }, (_, y) => (red(pixels, SIZE / 2, y) > 128 ? '#' : '.')).join('');
      expect(red(pixels, SIZE / 2, SIZE / 2 - 4), `the plane lands above the middle (column: ${column})`).toBe(255);
      expect(red(pixels, SIZE / 2, SIZE / 2 + 4), `below the middle holds the clear (column: ${column})`).toBe(0);
      copy.destroy(true);
    });

    it('can be drawn by a pass instead of a material', async () => {
      await setup('pass', [new FillOutput(maskOutput), new ShowOutput(maskOutput)]);
      view3d.root.addChild(
        new Mesh3D({ geometry: new PlaneGeometry({ width: SIZE, height: SIZE }), material: new FlatMaterial() }),
      );

      const pixels = await renderFrame(app);

      expect(Math.abs(red(pixels, SIZE / 2, SIZE / 2) - 128)).toBeLessThanOrEqual(1);
    });

    it.runIf(preference === 'webgl')(
      "gives an integer output a sampler WebGL can read, so a pass's texelFetch gets the id",
      async () => {
        const objectIds: SceneOutput = { name: 'objectId', format: 'r32uint', bits: { opaque: objectIdBit } };
        const into = RenderTexture.create({ width: SIZE, height: SIZE });
        const reader = new ReadIdGl(objectIds, into);
        await setup('integer-read', [reader]);
        addPlane();

        await renderFrame(app);
        const read = app.renderer.extract.pixels({ target: into }).pixels;

        expect(red(read, SIZE / 2, SIZE / 2)).toBe(OBJECT_ID);
        reader.destroy();
        into.destroy(true);
      },
    );

    function colorAttachmentLimit(): number {
      if (preference === 'webgpu') return (app.renderer as WebGPURenderer).gpu.device.limits.maxColorAttachments;
      const gl = (app.renderer as WebGLRenderer).gl;
      return Math.min(gl.getParameter(gl.MAX_DRAW_BUFFERS), gl.getParameter(gl.MAX_COLOR_ATTACHMENTS));
    }

    function addPlane(): void {
      view3d.root.addChild(
        new Mesh3D({ geometry: new PlaneGeometry({ width: SIZE, height: SIZE }), material: new FlatMaterial() }),
      );
    }

    it('throws, naming each attachment, when the colour and one output per slot overfill the attachments', async () => {
      await setup('limit-count', []);
      const limit = colorAttachmentLimit();
      const outputs: SceneOutput[] = Array.from({ length: limit }, (_, i) => ({ name: `o${i}`, format: 'r8unorm' }));
      view3d.passes = outputs.map((output) => new FillOutput(output));
      addPlane();

      expect(() => app.render()).toThrow(
        new RegExp(
          `pass "\\w+" attaches ${limit + 1} colour textures, over this GPU's limit of ${limit}: sceneColor, o0,`,
        ),
      );
    });

    it.runIf(preference === 'webgpu')(
      'throws when the colour (8 bytes) and four rgba8unorm outputs (8 bytes each) need 40 bytes per pixel, over 32',
      async () => {
        await setup(
          'limit-bytes',
          ['a', 'b', 'c', 'd'].map((name) => new FillOutput({ name, format: 'rgba8unorm' })),
        );
        addPlane();

        expect(() => app.render()).toThrow(
          /pass "\w+" needs 40 bytes per pixel for its colour textures, over WebGPU's limit of 32: sceneColor \(\w+, 8 bytes\), a \(rgba8unorm, 8 bytes\)/,
        );
      },
    );
  });
}
