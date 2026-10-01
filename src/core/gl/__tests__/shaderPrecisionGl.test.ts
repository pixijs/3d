import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { SsaoEffect } from '~/extras/post-processing/effects/SsaoEffect';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

interface CompiledShader {
  source: string;
  fragment: boolean;
}

const SAMPLER_TYPES = [
  'sampler2D',
  'usampler2D',
  'isampler2D',
  'samplerCube',
  'sampler2DArray',
  'sampler2DArrayShadow',
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Returns what `source` uses at a precision below highp, or an empty list
 *
 * Desktop and Apple GPUs run everything at highp, so no visual scene can catch a missing
 * declaration; `GLSL_PRECISION_PRELUDE` in `glslPrecisionPlugin` says what Mali does instead.
 */
function lowPrecisionUses({ source, fragment }: CompiledShader): string[] {
  const code = stripComments(source);
  const problems: string[] = [];

  for (const type of SAMPLER_TYPES) {
    if (new RegExp(`precision\\s+highp\\s+${type}\\s*;`).test(code)) continue;
    const uses = code.match(new RegExp(`(?:\\b(?:lowp|mediump|highp)\\s+)?\\b${type}\\b`, 'g')) ?? [];
    if (uses.some((use) => !use.startsWith('highp'))) problems.push(type);
  }

  if (fragment && /\buint\b|<<|>>/.test(code) && !/precision\s+highp\s+int\s*;/.test(code)) problems.push('int');

  return problems;
}

function colourFace(r: number, g: number, b: number): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([r, g, b, 255]),
      format: 'rgba8unorm',
      width: 1,
      height: 1,
    }),
  });
}

describe('WebGL shader precision', () => {
  it('declares highp for every sampler type and for fragment int maths in the material, IBL, skybox, shadow, effect and output shaders', async () => {
    const compiled: CompiledShader[] = [];
    const proto = WebGL2RenderingContext.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'shaderSource') as PropertyDescriptor;
    const shaderSource = descriptor.value as (
      this: WebGL2RenderingContext,
      shader: WebGLShader,
      source: string,
    ) => void;
    Object.defineProperty(proto, 'shaderSource', {
      ...descriptor,
      value(this: WebGL2RenderingContext, shader: WebGLShader, source: string) {
        compiled.push({ source, fragment: this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER });
        shaderSource.call(this, shader, source);
      },
    });

    const app = await getApp<WebGLRenderer>({
      id: 'gl-shader-precision',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });

    try {
      const cube = CubeTexture.from({
        faces: {
          right: colourFace(220, 60, 60),
          left: colourFace(60, 200, 200),
          top: colourFace(70, 200, 90),
          bottom: colourFace(200, 70, 200),
          front: colourFace(70, 110, 220),
          back: colourFace(220, 200, 70),
        },
      });

      const view3d = new View3D({ width: 64, height: 64, environment: cube, passes: [new SsaoEffect()] });
      view3d.background = cube;
      app.stage.addChild(view3d);

      const light = new DirectionalLight({ color: 0xffffff, intensity: 3, castShadow: true });
      light.rotation.set(-0.6, 0.4, 0);
      view3d.root.addChild(light);
      view3d.root.addChild(
        new Mesh3D({ geometry: new SphereGeometry(), material: new Material3D({ baseColor: 0xff8844 }) }),
      );
      view3d.camera.position.set(0, 0, 4);

      app.render();
      await new Promise((resolve) => setTimeout(resolve, 50));
      app.render();
    } finally {
      Object.defineProperty(proto, 'shaderSource', descriptor);
      app.destroy();
    }

    const sources = compiled.map((shader) => shader.source).join('\n');
    expect(sources, 'the material shader compiled').toContain('vTextureSlots');
    expect(sources, 'the PBR lighting compiled').toContain('geometrySchlickGGX');
    expect(sources, 'a depth-reading effect compiled').toContain('uOpaqueDepthTexture');
    expect(
      compiled.some((shader) => /samplerCube/.test(stripComments(shader.source))),
      'a cube-map shader compiled',
    ).toBe(true);

    const offenders = compiled
      .map((shader) => ({ problems: lowPrecisionUses(shader), head: shader.source.slice(0, 160) }))
      .filter((entry) => entry.problems.length > 0);
    expect(offenders).toEqual([]);
  });
});
