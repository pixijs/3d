import { ShaderStage } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { buildWgslBindingMap, collectBindings } from '~/core/gpu/codegen/wgslBindingsPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

/**
 * The `{ type, visibility }` binding form narrows a WebGPU storage buffer to the
 * stage(s) that read it, so it counts against only that stage's
 * `maxStorageBuffersPerShaderStage` budget. Untagged bindings stay
 * `VERTEX | FRAGMENT`, exactly as pixi auto-generates. WebGL ignores the tag.
 */

const template: ShaderBitTemplate = { bindGroups: ['global'], gpu: '{{header}}' };

/** Look up the generated layout entry for a binding by name. */
function entryFor(bits: ShaderBit[], name: string) {
  const { gpuLayout } = compileWgslSource({ bits, template });
  const map = buildWgslBindingMap(collectBindings(bits, template));
  const { groupIndex, entries } = map.global;
  const binding = entries.find((e) => e.name === name)!.binding;
  return gpuLayout[groupIndex].find((e) => e.binding === binding)!;
}

describe('per-stage binding visibility', () => {
  const bits: ShaderBit[] = [
    {
      name: 'visBits',
      bindings: {
        global: {
          uVertexOnly: { type: 'storage<f32>', visibility: 'vertex' },
          uFragmentOnly: { type: 'storage<f32>', visibility: 'fragment' },
          uBothExplicit: { type: 'storage<f32>', visibility: 'both' },
          uBothDefault: 'storage<f32>',
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

  it("leaves an explicit 'both' tag at VERTEX | FRAGMENT", () => {
    expect(entryFor(bits, 'uBothExplicit').visibility).toBe(ShaderStage.VERTEX | ShaderStage.FRAGMENT);
  });

  it('defaults a bare-string binding to VERTEX | FRAGMENT', () => {
    expect(entryFor(bits, 'uBothDefault').visibility).toBe(ShaderStage.VERTEX | ShaderStage.FRAGMENT);
  });

  it('still emits the storage buffer as read-only-storage (type unaffected by the tag)', () => {
    const entry = entryFor(bits, 'uVertexOnly');
    expect(entry.buffer?.type).toBe('read-only-storage');
  });
});
