/**
 * The props the pick runs over: a turntable of nineteen clay shapes, the picked one glowing
 *
 * Nothing here picks. `index.ts` makes the shapes pickable and calls `raycast`; this file builds the shapes and lights
 * the one it hands back.
 */

import { Container3D, Mesh3D } from '@pixi/3d';

import { createClayMaterial } from '../shared/theme/clay';
import type { GlowingClayMaterial } from '../shared/theme/clay';
import { BRAND, CLAY } from '../shared/theme/palette';
import type { ClayColor } from '../shared/theme/palette';
import { clayGeometry } from '../shared/theme/shapes';
import type { ClayShape } from '../shared/theme/shapes';

/**
 * The glow of the picked shape. Added light alone turns pale clay white, so the clay itself turns pink as well, and the
 * hot pink glow lifts it.
 */
const GLOW_STRENGTH = 0.6;

/** The field's rings, centre first: each slot's shape, evenly round the ring from +z toward +x */
const RINGS: readonly { radius: number; color: ClayColor; shapes: readonly ClayShape[] }[] = [
  { radius: 0, color: 'purple', shapes: ['sphere'] },
  { radius: 1.5, color: 'lilac', shapes: ['cube', 'torus', 'capsule', 'octahedron', 'puck', 'pyramid'] },
  {
    radius: 3,
    color: 'paleSky',
    shapes: [
      'cube',
      'puck',
      'sphere',
      'pyramid',
      'capsule',
      'torus',
      'octahedron',
      'cube',
      'puck',
      'sphere',
      'torus',
      'capsule',
    ],
  },
];

export interface Field {
  /** The turntable every shape stands on */
  readonly root: Container3D;
  /** Every shape, labelled by its shape and slot: `'sphere 0'` in the middle, `'puck 8'` at the front right */
  readonly shapes: readonly Mesh3D[];
  /** Lights `target` and puts out the shape lit before; `null`, or a node that isn't one of the shapes, lights none */
  light(target: Container3D | null): void;
}

/** Nineteen clay shapes standing on the floor in a centre and two rings, each with a glow of its own */
export function createField(parent: Container3D): Field {
  const root = new Container3D({ label: 'field', parent });
  const shapes: Mesh3D[] = [];
  const glows: GlowingClayMaterial[] = [];
  const colors: number[] = [];
  let lit = -1;

  function setGlow(i: number, on: boolean): void {
    glows[i].baseColor = on ? CLAY.pink : colors[i];
    glows[i].emissive.strength = on ? GLOW_STRENGTH : 0;
  }

  for (const ring of RINGS) {
    ring.shapes.forEach((shape, i) => {
      const angle = (i / ring.shapes.length) * Math.PI * 2;
      const geometry = clayGeometry(shape);
      // Its own material, so it glows alone.
      const material = createClayMaterial({ color: ring.color, emissive: { color: BRAND.hotPink, strength: 0 } });

      shapes.push(
        new Mesh3D({
          label: `${shape} ${shapes.length}`,
          geometry,
          material,
          // Standing on the floor.
          position: { x: ring.radius * Math.sin(angle), y: -geometry.bounds3D.min.y, z: ring.radius * Math.cos(angle) },
          parent: root,
        }),
      );
      glows.push(material);
      colors.push(CLAY[ring.color]);
    });
  }

  return {
    root,
    shapes,
    light(target) {
      let next = -1;

      for (let i = 0; i < shapes.length; i++) if (shapes[i] === target) next = i;
      if (next === lit) return;
      if (lit !== -1) setGlow(lit, false);
      if (next !== -1) setGlow(next, true);
      lit = next;
    },
  };
}
