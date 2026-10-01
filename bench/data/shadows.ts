/**
 * The `shadows` scene as plain data: a ground that receives, a seeded field of spinning casters above it, a
 * sun and four spot lights, and which of those lights cast.
 *
 * 2000 casters over the eight generated geometries on an 80-unit ground, the camera above and behind, and the four
 * spots at the corners aimed inwards, at an intensity of 150 so the ground is not tone-mapped to white and the
 * shadows show. The casters spin, so every map is re-rendered every frame.
 */

import type { FieldScene } from './field.ts';
import type { Geometry } from './geometry.ts';
import { fieldGeometries } from './geometry.ts';
import type { PbrSpec, SceneLook, SunSpec, Vec3 } from './look.ts';
import { fieldLook, greyMaterial, spinner, sun } from './look.ts';
import { rng } from './rng.ts';

/**
 * Which lights cast: none, the sun's one map, the sun's and the four spots', or the sun's as cascades that
 * follow the camera. Every light is in the scene on every rung, so a step up the ladder adds shadow maps and
 * shadow lookups and leaves the lights' own shading alone.
 */
export type ShadowCasting = 'off' | 'sun' | 'sun-spots' | 'cascades';

export interface SpotSpec {
  position: Vec3;
  target: Vec3;
  color: Vec3;
  intensity: number;
  range: number;
  /** Half-angle of the cone in degrees. */
  angle: number;
  /** Fraction of the cone that fades out towards its edge, 0 to 1. */
  penumbra: number;
}

/** Every casting light's map settings: one set for all of them, since the view sizes every map alike. */
export interface ShadowMapSpec {
  /** Texels per side. */
  size: number;
  /** Normalised depth a receiver is moved towards the light by before the compare. */
  bias: number;
  /** World units a receiver is pushed along its normal before the lookup. */
  normalBias: number;
}

export interface BoxSpec {
  min: Vec3;
  max: Vec3;
}

export interface ShadowSunSpec extends SunSpec {
  /** How far back along its direction from the origin the light sits, aimed at the origin. */
  distance: number;
  /** The world box the sun's one map covers. */
  box: BoxSpec;
  /** The `cascades` rung: how many maps split the camera's view, and how far from the camera they reach. */
  cascades: { count: 4; maxDistance: number };
}

export interface ShadowsScene extends FieldScene {
  ground: { geometry: Geometry; material: PbrSpec };
  sun: ShadowSunSpec;
  spots: SpotSpec[];
  shadow: ShadowMapSpec;
}

const CASTERS = 2000;
const GROUND_SIZE = 80;
const SUN_DISTANCE = 50;

/** A flat square on the XZ plane facing +Y, counter-clockwise from above, as the field geometries are wound. */
function ground(size: number): Geometry {
  const half = size / 2;
  return {
    positions: new Float32Array([-half, 0, half, half, 0, half, half, 0, -half, -half, 0, -half]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

function spot(x: number, z: number, color: Vec3): SpotSpec {
  return {
    position: [x, 18, z],
    target: [x * 0.3, 0, z * 0.3],
    color,
    intensity: 150,
    range: 70,
    angle: 30,
    penumbra: 0.3,
  };
}

/** The `shadows` scene, every light in it; the bench decides which of them cast. */
export function shadowsScene(seed = 5): ShadowsScene {
  const random = rng(seed);
  const geometries = fieldGeometries();
  const geom = new Uint16Array(CASTERS);
  const scale = new Float32Array(CASTERS);
  const position = new Float32Array(CASTERS * 3);
  for (let i = 0; i < CASTERS; i++) {
    geom[i] = random.int(geometries.length);
    scale[i] = random.range(0.6, 1.4);
    position[i * 3] = random.range(-35, 35);
    position[i * 3 + 1] = random.range(0.6, 4);
    position[i * 3 + 2] = random.range(-35, 35);
  }
  const quat = new Float32Array(CASTERS * 4);
  const spin = spinner(random, CASTERS);
  spin(0, quat);

  const framing = fieldLook();
  const look: SceneLook = {
    camera: { position: [0, 28, 48], target: [0, 0, 0], fovY: 50, near: 0.5, far: 250 },
    clearColor: framing.clearColor,
    ambient: framing.ambient && { color: framing.ambient.color, intensity: 0.15 },
    // The scene brings its own sun, since it is the one that casts.
    sun: null,
  };
  const light = sun([-0.4, -1, -0.3], 1.6);
  const box: BoxSpec = { min: [-GROUND_SIZE / 2, 0, -GROUND_SIZE / 2], max: [GROUND_SIZE / 2, 5, GROUND_SIZE / 2] };
  return {
    look,
    geometries,
    materials: [greyMaterial()],
    count: CASTERS,
    geom,
    material: new Uint16Array(CASTERS),
    position,
    scale,
    quat,
    ground: { geometry: ground(GROUND_SIZE), material: { color: [0.55, 0.55, 0.55], roughness: 0.9, metalness: 0 } },
    sun: {
      ...light,
      distance: SUN_DISTANCE,
      box,
      cascades: { count: 4, maxDistance: 120 },
    },
    spots: [
      spot(25, 25, [1, 0.6, 0.3]),
      spot(-25, 25, [0.3, 0.6, 1]),
      spot(25, -25, [0.4, 1, 0.4]),
      spot(-25, -25, [1, 0.35, 0.8]),
    ],
    shadow: { size: 2048, bias: 0.001, normalBias: 0.1 },
    update(seconds) {
      spin(seconds, quat);
    },
  };
}
