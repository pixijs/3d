/**
 * `transparency`: see-through meshes in a ball, over an opaque floor, with the camera circling them. Blended
 * surfaces are drawn back to front, and a circling camera changes that order every frame, so the engine sorts
 * them every frame; cutouts write depth like opaque surfaces and need no order at all. `alpha` says which the
 * objects are, and the rest of the scene is the same for every mix: the same shapes, places, sizes and colours.
 */

import { alphaTexture, BALL_RADIUS, orbit, orbitCamera, scatterInBall } from './cloud.ts';
import type { PixelTexture } from './cloud.ts';
import { box, cylinder, icosahedron, octahedron, sphere, torus } from './geometry.ts';
import type { Geometry } from './geometry.ts';
import { coverageScale, fieldLook, greyMaterial, hsvToLinear } from './look.ts';
import type { PbrSpec, SceneLook, Vec3 } from './look.ts';
import { rng } from './rng.ts';

/** Which surfaces the objects have: all blended, all cut out, or every other one each. */
export type AlphaMix = 'blend' | 'cutout' | 'mixed';

/** A surface that lets the scene behind it through. */
export interface AlphaMaterialSpec extends PbrSpec {
  /** Blended over what is behind it, or cut out where its alpha falls under the cutoff. */
  alpha: 'blend' | 'cutout';
  /** The material's own opacity, which the texture's alpha multiplies. */
  opacity: number;
}

/** One opaque object: the floor the see-through ones float over. */
export interface OpaqueSlab {
  geometry: Geometry;
  material: PbrSpec;
  position: Vec3;
  scale: Vec3;
}

export interface TransparencyScene {
  look: SceneLook;
  floor: OpaqueSlab;
  geometries: Geometry[];
  /** White, with round holes: what makes a cutout a cutout, and what a blended surface blends by. */
  texture: PixelTexture;
  /** Where a cutout's alpha is cut, which a blended surface ignores. */
  alphaCutoff: number;
  materials: AlphaMaterialSpec[];
  count: number;
  /** Index into `geometries`, per object. */
  geom: Uint8Array;
  /** Index into `materials`, per object. */
  material: Uint16Array;
  position: Float32Array;
  scale: Float32Array;
  /** `count × 4` quaternions, fixed: the objects stand still and the camera moves. */
  quat: Float32Array;
  /** Moves `look.camera` round its circle to `t` seconds. */
  update(seconds: number): void;
}

/** Colours in the palette; each is one blended material and one cutout. */
const COLOURS = 8;

/** Opacity of a blended surface; a cutout is opaque where it is not cut. */
const BLEND_OPACITY = 0.5;

/** Keeps the screen about as covered as the count grows; smaller than `field`'s, since every layer is shaded. */
const COVERAGE = 1500;

/**
 * `field`'s eight kinds of shape at a quarter of its triangles, sixty on average, so the GPU's vertex work stays
 * small beside the host's share of a cutout frame and does not pace the reading.
 */
function lowPolyShapes(): Geometry[] {
  return [
    box(),
    sphere(0.5, 8, 6),
    cylinder(0.5, 0.5, 1, 8),
    cylinder(0, 0.5, 1, 8),
    torus(0.35, 0.15, 6, 12),
    icosahedron(),
    octahedron(),
    sphere(0.5, 12, 8),
  ];
}

/** Four by four round holes, a third of each cell across. */
function perforated(): PixelTexture {
  return alphaTexture(64, (u, v) => {
    const x = ((u * 4) % 1) - 0.5;
    const y = ((v * 4) % 1) - 0.5;
    return Math.hypot(x, y) < 0.17 ? 0 : 1;
  });
}

function surface(color: Vec3, alpha: AlphaMaterialSpec['alpha']): AlphaMaterialSpec {
  return { color, roughness: 0.5, metalness: 0, alpha, opacity: alpha === 'blend' ? BLEND_OPACITY : 1 };
}

/**
 * `count` objects over eight low-poly shapes and eight colours, in a ball the camera circles. `mix`
 * decides only which material each object takes; the random stream is drawn the same way whatever it is, so every
 * mix is one scene with a different kind of surface.
 */
export function transparencyScene(count: number, mix: AlphaMix, seed = 5): TransparencyScene {
  const random = rng(seed);
  const palette = Array.from({ length: COLOURS }, () => hsvToLinear(random.next(), 0.6, 0.9));
  const scale = coverageScale(count, COVERAGE);
  const geometries = lowPolyShapes();
  const geom = new Uint8Array(count);
  const material = new Uint16Array(count);
  const scales = new Float32Array(count);
  const quat = new Float32Array(count * 4);
  const axis = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    geom[i] = random.int(geometries.length);
    const colour = random.int(COLOURS);
    material[i] = mix === 'mixed' && i % 2 === 1 ? COLOURS + colour : colour;
    scales[i] = scale * random.range(0.8, 1.2);
    random.unit(axis);
    const half = random.range(0, Math.PI);
    const sin = Math.sin(half);
    quat.set([(axis[0] ?? 0) * sin, (axis[1] ?? 0) * sin, (axis[2] ?? 0) * sin, Math.cos(half)], i * 4);
  }
  const position = scatterInBall(random, count, BALL_RADIUS);
  const blended = palette.map((color) => surface(color, 'blend'));
  const cut = palette.map((color) => surface(color, 'cutout'));
  const look: SceneLook = { ...fieldLook(), camera: orbitCamera() };
  return {
    look,
    floor: {
      geometry: box(),
      material: greyMaterial(),
      position: [0, -BALL_RADIUS - 1.5, 0],
      scale: [80, 1, 80],
    },
    geometries,
    texture: perforated(),
    alphaCutoff: 0.5,
    materials: mix === 'blend' ? blended : mix === 'cutout' ? cut : [...blended, ...cut],
    count,
    geom,
    material,
    position,
    scale: scales,
    quat,
    update(seconds) {
      orbit(look.camera, seconds);
    },
  };
}
