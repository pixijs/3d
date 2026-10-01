/**
 * The PBR material scene, as plain data: five meshes, each with its own geometry and its own lit, textured,
 * normal-mapped material, side by side across the view, in a view with a flat environment (so image-based lighting
 * compiles in) and point lights all within range of every fragment.
 *
 * The scene never names a shader, so whatever the engine compiles for such a material is what gets measured, and a
 * refactor that keeps the public API keeps the bench. The materials draw their four textures from one pool of ten
 * distinct noise fields, so neighbouring materials share textures and the engine decides how to bind them.
 *
 * The meshes are five strips, a fifth of the view each, rather than five quads over the whole view: in a static
 * frame, opaque quads stacked at one depth are shaded once a pixel by a GPU that removes hidden surfaces and up to
 * five times by one that does not. Side by side, every pixel is shaded once on any GPU and every material is drawn.
 */

/** Distinct noise fields the materials share. */
export const TEXTURE_POOL = 10;

/** Edge of the noise fields: full size, because a sampler walking a real texture is what costs. */
export const TEXTURE_SIZE = 1024;

/** Meshes, and so draws: five materials of four textures stepping through a pool of ten cover every texture twice. */
export const MESH_COUNT = 5;

/** Where the camera sits on +Z, looking down -Z at the strips, and its vertical field of view in degrees. */
export const CAMERA = { distance: 3, fovY: 60 };

/**
 * Half the strips' height: past the 1.73 the view reaches at the camera's distance, so they cover it with a margin.
 * Their width together is the height times the view's aspect, so they cover it sideways too.
 */
const HALF_HEIGHT = 2;

/** The view's aspect, 1920×1080. */
const ASPECT = 1920 / 1080;

export interface StripGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

/**
 * Strip `index` of the five, facing the camera: counter-clockwise, normals on +Z. Its UVs are its fifth of the
 * unit square across and the whole of it down.
 */
export function strip(index: number): StripGeometry {
  const halfWidth = HALF_HEIGHT * ASPECT;
  const left = -halfWidth + (2 * halfWidth * index) / MESH_COUNT;
  const right = -halfWidth + (2 * halfWidth * (index + 1)) / MESH_COUNT;
  const h = HALF_HEIGHT;
  const u0 = index / MESH_COUNT;
  const u1 = (index + 1) / MESH_COUNT;
  return {
    positions: new Float32Array([left, -h, 0, right, -h, 0, right, h, 0, left, h, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([u0, 0, u1, 0, u1, 1, u0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

/** One material of the scene: its factors, and which of the pool's textures fills each of its slots. */
export interface PbrMaterial {
  roughness: number;
  metallic: number;
  textures: { baseColor: number; metallicRoughness: number; occlusion: number; normal: number };
}

/**
 * The material a glTF model brings: every PBR texture set, mid metal and mid roughness, so none of the textures
 * multiplies into a constant. Material `index` takes the four pool textures after the previous one's, wrapping, so
 * neighbouring strips read different slots and any 3 of them cover all ten.
 */
export function pbrMaterial(index: number): PbrMaterial {
  const slot = (offset: number): number => (index * 4 + offset) % TEXTURE_POOL;
  return {
    roughness: 0.45,
    metallic: 0.35,
    textures: { baseColor: slot(0), metallicRoughness: slot(1), occlusion: slot(2), normal: slot(3) },
  };
}

/** The environment's solid colour as 8-bit RGB. */
export const ENVIRONMENT_RGB: readonly [number, number, number] = [96, 110, 128];

/** One point light of the scene. The colour is display-encoded; the intensity is in albedo/π units. */
export interface PbrLight {
  position: [number, number, number];
  color: [number, number, number];
  intensity: number;
  range: number;
}

/**
 * Point lights in front of the strips, on a ring, all within range of every fragment: a light loop leaves early for
 * a light out of range, and eight lights that all miss would measure as one.
 */
export function pbrLights(count: number): PbrLight[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / Math.max(1, count)) * Math.PI * 2;
    return {
      position: [0.6 * Math.cos(angle), 0.6 * Math.sin(angle), 1.2],
      color: [0.9, 0.85, 0.8],
      intensity: Math.PI,
      range: 12,
    };
  });
}

/**
 * A value in 0…255 from `x`, `y` and `seed`, well mixed. The sampler cannot see what is in a texture, so this only
 * has to be varied, and repeatable, since the gate compares two arms' frames pixel for pixel.
 */
function hash(x: number, y: number, seed: number): number {
  let value = (x * 0x1_f1f1 + y * 0x2_7d4e + seed * 0x9e_3779) | 0;
  value = Math.imul(value ^ (value >>> 15), 0x85eb_ca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2_ae35);
  return (value ^ (value >>> 16)) & 0xff;
}

/**
 * A `size`² field of noise as `rgba8unorm` bytes. A texture sample's cost is mostly the memory it touches, so these
 * are full-size fields rather than 1×1 textures, generated so a run needs no assets.
 */
export function noisePixels(size: number, seed: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const words = new Uint32Array(pixels.buffer);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = hash(x, y, seed);
      const g = hash(x, y, seed + 101);
      const b = hash(x, y, seed + 211);
      // Alpha stays high, so a colour read as premultiplied by its alpha is never divided by almost nothing.
      words[y * size + x] = (0xf0 << 24) | (b << 16) | (g << 8) | r;
    }
  }
  return pixels;
}
