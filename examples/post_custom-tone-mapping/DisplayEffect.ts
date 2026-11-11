/** The two output steps a view leaves to you under `toneMapping: 'custom'`: compress linear light, then encode it */

import { PostEffect } from '@pixi/3d';
import type { EffectFragment } from '@pixi/3d';
import { UniformGroup } from 'pixi.js';

export interface DisplayEffectOptions {
  /** Roll light above 1 off with the curve (on by default) */
  reinhard?: boolean;
  /** Encode for the screen (on by default) */
  encode?: boolean;
}

export class DisplayEffect extends PostEffect {
  // One vec4 holds both switches: x turns the curve on, y the encode. Each switch writes one lane, so flipping it
  // never rebuilds the graph.
  protected override readonly uniforms = new UniformGroup({
    uOutput: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  // The scene colour arrives premultiplied and both steps are nonlinear, so they run on straight colour and the
  // result is premultiplied again.
  protected readonly fragment: EffectFragment = {
    gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let sample = sampleColor(uv);
  var rgb = max(sample.rgb / max(sample.a, 0.00001), vec3<f32>(0.0));
  if (fx.uOutput.x > 0.5) { rgb = rgb / (1.0 + rgb); }
  if (fx.uOutput.y > 0.5) { rgb = pow(rgb, vec3<f32>(1.0 / 2.2)); }
  return vec4<f32>(rgb * sample.a, sample.a);
}`,
    gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 sampled = sampleColor(uv);
  vec3 rgb = max(sampled.rgb / max(sampled.a, 0.00001), vec3(0.0));
  if (uOutput.x > 0.5) { rgb = rgb / (1.0 + rgb); }
  if (uOutput.y > 0.5) { rgb = pow(rgb, vec3(1.0 / 2.2)); }
  return vec4(rgb * sampled.a, sampled.a);
}`,
  };

  constructor({ reinhard = true, encode = true }: DisplayEffectOptions = {}) {
    super();
    this.reinhard = reinhard;
    this.encode = encode;
  }

  /** Reinhard, `x / (1 + x)`, rolls every linear value into 0 to 1. Off, anything above 1 clips to flat colour. */
  public get reinhard(): boolean {
    return this.uniforms.uniforms.uOutput[0] > 0.5;
  }

  public set reinhard(value: boolean) {
    this.writeLane(this.uniforms, 'uOutput', 0, Number(value));
  }

  /** The display encode, `pow(x, 1 / 2.2)`, as the engine's own curves end. Off, linear light shows too dark. */
  public get encode(): boolean {
    return this.uniforms.uniforms.uOutput[1] > 0.5;
  }

  public set encode(value: boolean) {
    this.writeLane(this.uniforms, 'uOutput', 1, Number(value));
  }
}
