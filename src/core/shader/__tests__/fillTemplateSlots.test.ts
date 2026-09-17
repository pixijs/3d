import { describe, expect, it } from 'vitest';

import { fillTemplateSlots } from '~/core/shader/codegen/fillTemplateSlots';

describe('fillTemplateSlots', () => {
  it('fills a single-pass template with provided slot code', () => {
    const template = '{{header}}\nvoid main() { {{body}} }';
    const result = fillTemplateSlots(template, {
      header: ['uniform float uTime;'],
      body: ['gl_Position = vec4(0.0);'],
    });
    expect(result).toBe('uniform float uTime;\nvoid main() { gl_Position = vec4(0.0); }');
  });

  it('drops markers with no provided code', () => {
    const result = fillTemplateSlots('a {{missing}} b', {});
    expect(result).toBe('a  b');
  });

  it('joins multiple contributions to the same slot with newlines', () => {
    const result = fillTemplateSlots('{{x}}', { x: ['one', 'two', 'three'] });
    expect(result).toBe('one\ntwo\nthree');
  });

  it('expands nested markers introduced by an outer slot value', () => {
    // Mimics the lobe composition pattern: one slot's value contains markers
    // that resolve in a second pass.
    const template = '{{outer}}';
    const result = fillTemplateSlots(template, {
      outer: ['for (i=0; i<N; i++) { {{innerLobe}} }'],
      innerLobe: ['accum += contribution(i);'],
    });
    expect(result).toBe('for (i=0; i<N; i++) { accum += contribution(i); }');
  });

  it('handles three-level nesting', () => {
    const result = fillTemplateSlots('{{a}}', {
      a: ['A({{b}})'],
      b: ['B({{c}})'],
      c: ['C'],
    });
    expect(result).toBe('A(B(C))');
  });

  it('strips unmatched markers after iteration completes', () => {
    const result = fillTemplateSlots('start {{a}} {{never_filled}} end', {
      a: ['A_value'],
    });
    expect(result).toBe('start A_value  end');
  });

  it('throws on cyclic markers instead of shipping a shader with code silently missing', () => {
    // A slot whose value reintroduces its own marker can never resolve; the
    // pass cap guarantees termination and the survivor check makes the cycle
    // a loud authoring error rather than silently stripped output.
    expect(() => fillTemplateSlots('{{self}}', { self: ['hi {{self}}'] })).toThrow(/\{\{self\}\}/);
    expect(() => fillTemplateSlots('{{a}}', { a: ['x {{b}}'], b: ['y {{a}}'] })).toThrow(/substitution passes/);
  });

  it('preserves text containing single curly braces', () => {
    const template = 'struct Foo { x: f32 }; {{slot}}';
    const result = fillTemplateSlots(template, { slot: ['VAL'] });
    expect(result).toBe('struct Foo { x: f32 }; VAL');
  });
});
