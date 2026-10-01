import 'pixi.js/browser';
import type { Container } from 'pixi.js';
import { describe, expect, expectTypeOf, test } from 'vitest';

import type { RaycastHit3D } from '~/events/HitResult3D';
import type { Pointer3DEvent } from '~/events/Pointer3DEvent';
import type { Container3D } from '~/scene/Container3D';
import { View3D } from '~/scene/View3D';

describe('View3D listener typing, checked by tsc: 2D listeners read the 3D fields without narrowing', () => {
  const SIZE = { width: 10, height: 10 };

  test('on() infers the 3D fields on pointer and wheel events', () => {
    const view3d = new View3D(SIZE);
    const boundaryListeners = view3d.listenerCount('pointermove');

    view3d.on('pointermove', (e) => {
      expectTypeOf(e.target3D).toEqualTypeOf<Container3D | null>();
      expectTypeOf(e.currentTarget3D).toEqualTypeOf<Container3D | null>();
      expectTypeOf(e.hit3D).toEqualTypeOf<RaycastHit3D | null>();
    });
    view3d.on('wheel', (e) => {
      expectTypeOf(e.hit3D).toEqualTypeOf<RaycastHit3D | null>();
    });

    expect(view3d.listenerCount('pointermove')).toBe(boundaryListeners + 1);
  });

  test('on-handler properties and addEventListener are typed with the fields too', () => {
    const view3d = new View3D(SIZE);

    view3d.onclick = (e) => {
      expectTypeOf(e.hit3D).toEqualTypeOf<RaycastHit3D | null>();
    };
    view3d.addEventListener('pointertap', (e) => {
      expectTypeOf(e.hit3D).toEqualTypeOf<RaycastHit3D | null>();
    });

    expect(view3d.onclick).not.toBeNull();
  });

  test('off() accepts a Pointer3DEvent-typed handler', () => {
    const view3d = new View3D(SIZE);
    const boundaryListeners = view3d.listenerCount('pointermove');
    const handler = (e: Pointer3DEvent): void => void e.target3D;

    view3d.on('pointermove', handler);
    view3d.off('pointermove', handler);

    expect(view3d.listenerCount('pointermove')).toBe(boundaryListeners);
  });

  test('controls: 3D chain and 2D container surface are unchanged', () => {
    const view3d = new View3D(SIZE);

    view3d.root.on('pointermove', (e) => {
      expectTypeOf(e).toEqualTypeOf<Pointer3DEvent>();
    });
    view3d.on('added', (container) => {
      expectTypeOf(container).toEqualTypeOf<Container>();
    });
    const asContainer: Container = view3d;

    expect(asContainer).toBe(view3d);
  });
});
