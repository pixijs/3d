import { describe, expect, expectTypeOf, test } from 'vitest';

import type { Pointer3DEvent } from '~/events/Pointer3DEvent';
import { Container3D } from '~/scene/Container3D';
import type { Mesh3D } from '~/scene/Mesh3D';

// Compile-time contract: known events keep exact payload inference while arbitrary
// string / symbol events stay open, mirroring pixi 2D's `ContainerEvents & AnyEvent`.
// `npm run test:types` is the real gate; the runtime assertions below are smoke.
describe('Container3D emitter typing — open custom events, precise known events', () => {
  test('known events keep exact payload types', () => {
    const node = new Container3D();

    node.on('pointerdown', (e) => {
      expectTypeOf(e).toEqualTypeOf<Pointer3DEvent>();
    });
    node.on('childAdded', (child, container, index) => {
      expectTypeOf(child).toEqualTypeOf<Container3D>();
      expectTypeOf(container).toEqualTypeOf<Container3D>();
      expectTypeOf(index).toEqualTypeOf<number>();
    });
    // @ts-expect-error a wrong listener shape on a known key is still rejected
    node.on('childAdded', (a: string) => a);

    expect(node.listenerCount('pointerdown')).toBe(1);
  });

  test('arbitrary string and symbol events compile and fire', () => {
    const node = new Container3D();
    const sym = Symbol('signal');
    let stringPayload: unknown;
    let symbolHits = 0;

    node.on('my-custom-thing', (value: number) => (stringPayload = value));
    node.once(sym, () => symbolHits++);
    node.emit('my-custom-thing', 42);
    node.emit(sym);
    node.off('my-custom-thing');

    expect(stringPayload).toBe(42);
    expect(symbolHits).toBe(1);
  });

  test('subclasses inherit the open map', () => {
    class GameNode extends Container3D {}
    const node = new GameNode();
    let heard = false;

    node.on('game-tick', () => (heard = true));
    node.emit('game-tick');

    // Mesh3D needs a full geometry/material to construct, so its check stays type-only.
    expectTypeOf<Parameters<Mesh3D['on']>[0]>().toEqualTypeOf<Parameters<Container3D['on']>[0]>();
    expect(heard).toBe(true);
  });
});
