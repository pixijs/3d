/**
 * What every bench scene is made of: vectors, cameras, materials and lights, and the framing the generated scenes
 * share.
 *
 * Every scene is framed for 1920×1080 and populated by a seeded generator, so it is the same workload on every
 * machine and in every run. `coverageScale` shrinks the objects as the count grows so the screen stays about as
 * covered: without it a ladder measures fill rate rather than per-object cost.
 */

import type { Rng } from './rng.ts';

export type Vec3 = [number, number, number];

export interface CameraSpec {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees. */
  fovY: number;
  near: number;
  far: number;
}

export interface PbrSpec {
  /** Linear colour; `displayColor` encodes it for pixi-3d on the way in. */
  color: Vec3;
  roughness: number;
  metalness: number;
  /** Seed of the material's base-colour and normal map pair (`textures.ts`); without it the colour is the surface. */
  texture?: number;
}

export interface SunSpec {
  direction: Vec3;
  color: Vec3;
  intensity: number;
}

export interface AmbientSpec {
  color: Vec3;
  intensity: number;
}

/** How a scene is framed and lit before it adds anything of its own. A light that is `null` is left out. */
export interface SceneLook {
  /** The camera's starting pose. A scene with a camera path moves the camera from its own update. */
  camera: CameraSpec;
  clearColor: Vec3;
  ambient: AmbientSpec | null;
  sun: SunSpec | null;
}

export const SCENE_ASPECT = 1920 / 1080;

const CLEAR: Vec3 = [0.02, 0.02, 0.025];
const AMBIENT: AmbientSpec = { color: [0.6, 0.65, 0.75], intensity: 0.3 };
const GREY: PbrSpec = { color: [0.72, 0.72, 0.72], roughness: 0.5, metalness: 0 };

export const FIELD_CAMERA: CameraSpec = { position: [0, 0, 40], target: [0, 0, 0], fovY: 50, near: 0.5, far: 200 };

function normalise(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function sun(direction: Vec3 = [-0.4, -1, -0.3], intensity = 2.2): SunSpec {
  return { direction: normalise(direction), color: [1, 0.97, 0.92], intensity };
}

/** sRGB hue to linear colour, so a material's colour is a colour and not a byte triple. */
export function hsvToLinear(hue: number, saturation: number, value: number): Vec3 {
  const channel = (n: number): number => {
    const k = (n + hue * 6) % 6;
    const srgb = value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1));
    return srgb <= 0.040_45 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return [channel(5), channel(3), channel(1)];
}

/**
 * Keeps the screen about as covered as the count grows, so a ladder isolates per-object cost instead of
 * turning into a fill-rate measurement.
 */
export function coverageScale(count: number, k = 3000, min = 0.2, max = 2): number {
  return Math.min(max, Math.max(min, Math.sqrt(k / count)));
}

/** Points scattered through the camera's frustum between two distances, inside a margin. */
export function scatterInFrustum(
  random: Rng,
  camera: CameraSpec,
  count: number,
  near: number,
  far: number,
  margin: number,
): Float32Array {
  const out = new Float32Array(count * 3);
  const tanHalf = Math.tan((camera.fovY * Math.PI) / 360);
  for (let i = 0; i < count; i++) {
    const distance = random.range(near, far);
    const halfHeight = Math.max(0, distance * tanHalf - margin);
    const halfWidth = Math.max(0, distance * tanHalf * SCENE_ASPECT - margin);
    out[i * 3] = random.range(-halfWidth, halfWidth);
    out[i * 3 + 1] = random.range(-halfHeight, halfHeight);
    out[i * 3 + 2] = camera.position[2] - distance;
  }
  return out;
}

/** Per-object spin: a random axis, speed and phase each; the returned writer fills quaternions. */
export function spinner(random: Rng, count: number): (seconds: number, quat: Float32Array) => void {
  const axis = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    random.unit(axis, i * 3);
    speed[i] = random.range(0.3, 1.5) * (random.next() < 0.5 ? -1 : 1);
    phase[i] = random.range(0, Math.PI * 2);
  }
  return (seconds, quat) => {
    for (let i = 0; i < count; i++) {
      const half = ((phase[i] ?? 0) + (speed[i] ?? 0) * seconds) * 0.5;
      const sin = Math.sin(half);
      quat[i * 4] = (axis[i * 3] ?? 0) * sin;
      quat[i * 4 + 1] = (axis[i * 3 + 1] ?? 0) * sin;
      quat[i * 4 + 2] = (axis[i * 3 + 2] ?? 0) * sin;
      quat[i * 4 + 3] = Math.cos(half);
    }
  };
}

/**
 * The generated scenes' framing: the camera forty units back looking at the origin, a dark backdrop, an ambient
 * fill and a sun.
 */
export function fieldLook(): SceneLook {
  return { camera: { ...FIELD_CAMERA }, clearColor: CLEAR, ambient: AMBIENT, sun: sun() };
}

/** The one grey material the plain field uses. */
export function greyMaterial(): PbrSpec {
  return { ...GREY };
}
