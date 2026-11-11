import { describe, expect, it } from 'vitest';

import { resolveShaderBits } from '~/core/shader/resolveShaderBits';
import type { ShaderBit } from '~/core/shader/ShaderBit';

const names = (bits: ShaderBit[]): string[] => bits.map((bit) => bit.name);

describe('resolveShaderBits', () => {
  it('keeps one copy of a bit listed twice, at its first place, with no requires in the list', () => {
    const a: ShaderBit = { name: 'resolve-twice-a' };
    const b: ShaderBit = { name: 'resolve-twice-b' };

    expect(resolveShaderBits([a, b, a])).toEqual([a, b]);
  });

  it('adds a required bit just ahead of the first bit that requires it, once', () => {
    const helper: ShaderBit = { name: 'resolve-helper' };
    const first: ShaderBit = { name: 'resolve-first', requires: [helper] };
    const second: ShaderBit = { name: 'resolve-second', requires: [helper] };
    const plain: ShaderBit = { name: 'resolve-plain' };

    expect(names(resolveShaderBits([plain, first, second]))).toEqual([
      'resolve-plain',
      'resolve-helper',
      'resolve-first',
      'resolve-second',
    ]);
  });

  it('adds what a required bit itself requires, ahead of it', () => {
    const base: ShaderBit = { name: 'resolve-base' };
    const helper: ShaderBit = { name: 'resolve-nested-helper', requires: [base] };
    const user: ShaderBit = { name: 'resolve-user', requires: [helper] };

    expect(names(resolveShaderBits([user]))).toEqual(['resolve-base', 'resolve-nested-helper', 'resolve-user']);
  });

  it('keeps one copy of a required bit that the list also names, wherever it is named', () => {
    const helper: ShaderBit = { name: 'resolve-listed-helper' };
    const user: ShaderBit = { name: 'resolve-listed-user', requires: [helper] };

    expect(names(resolveShaderBits([helper, user]))).toEqual(['resolve-listed-helper', 'resolve-listed-user']);
    expect(names(resolveShaderBits([user, helper]))).toEqual(['resolve-listed-helper', 'resolve-listed-user']);
  });

  it('lands each of two bits that require each other once', () => {
    const a: ShaderBit = { name: 'resolve-cycle-a' };
    const b: ShaderBit = { name: 'resolve-cycle-b', requires: [a] };
    a.requires = [b];

    expect(names(resolveShaderBits([a]))).toEqual(['resolve-cycle-b', 'resolve-cycle-a']);
  });
});
