import { ShaderStage } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { buildWgslBindingMap, collectBindings } from '~/core/gpu/codegen/wgslBindingsPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

const template: ShaderBitTemplate = { bindGroups: ['global'], gpu: '{{header}}' };

/** The WebGPU layout entry generated for the binding `name` */
function entryFor(bits: ShaderBit[], name: string) {
  const { gpuLayout } = compileWgslSource({ bits, template });
  const map = buildWgslBindingMap(collectBindings(bits, template));
  const { groupIndex, entries } = map.global;
  const binding = entries.find((e) => e.name === name)!.binding;
  return gpuLayout[groupIndex].find((e) => e.binding === binding)!;
}

describe("a { type, visibility } binding is visible to its stage only, so it spends only that stage's storage budget", () => {
  const bits: ShaderBit[] = [
    {
      name: 'visBits',
      bindings: {
        global: {
          uVertexOnly: { type: 'storage<f32>', visibility: 'vertex' },
          uFragmentOnly: { type: 'storage<f32>', visibility: 'fragment' },
        },
      },
    },
  ];

  it('narrows a vertex-tagged binding to VERTEX', () => {
    expect(entryFor(bits, 'uVertexOnly').visibility).toBe(ShaderStage.VERTEX);
  });

  it('narrows a fragment-tagged binding to FRAGMENT', () => {
    expect(entryFor(bits, 'uFragmentOnly').visibility).toBe(ShaderStage.FRAGMENT);
  });
});
