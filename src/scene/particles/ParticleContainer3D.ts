import { Buffer, BufferUsage, Color, definedProps, Texture } from 'pixi.js';
import type { Attribute, ColorSource } from 'pixi.js';

import { collectAttributes } from '../../core/shader/codegen/collectAttributes';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { Geometry3D } from '../../geometry/Geometry3D';
import type { AlphaMode } from '../../materials/BaseMaterial3D';
import type { Destroy3DOptions } from '../../utils/Destroy3DOptions';
import { warnOnce } from '../../utils/warnOnce';
import type { Container3DOptions } from '../Container3D';
import type { BillboardMode } from '../Mesh3D';
import { Mesh3D } from '../Mesh3D';
import { getParticleBit } from './bits/particleBit';
import type { ParticleBillboardMode } from './bits/particleBit';
import { ParticleMaterial } from './ParticleMaterial';
import type { ParticleBlendMode } from './ParticleMaterial';
import { packParticleColor } from './utils/packParticleColor';
import { packParticleFrames } from './utils/packParticleFrames';
import { unorm16, unorm8 } from './utils/packUnorm';
import {
  acquireQuadBuffers,
  INDICES_PER_PARTICLE,
  releaseQuadBuffers,
  VERTS_PER_PARTICLE,
} from './utils/particleGeometry';
import type { SharedQuadBuffers } from './utils/particleGeometry';
import { buildParticleLayout, expectShape } from './utils/particleLayout';
import type { ParticleAttribute } from './utils/particleLayout';
import type { ParticleAttributeValue, ParticleValues } from './utils/particleValues';

/**
 * Whether particle positions are in world space or move with their container; see
 * {@link ParticleContainer3DOptions.space}
 * @example
 * ```ts
 * const space: ParticleSpace = followsShip ? 'local' : 'world';
 * const exhaust = new ParticleSystem3D({ space });
 * ```
 * @category scene
 * @standard
 */
export type ParticleSpace = 'world' | 'local';

/**
 * Constructor options for {@link ParticleContainer3D}
 *
 * The container builds its own geometry and material, so it takes the {@link Container3DOptions}
 * rather than the mesh ones, less `width`, `height` and `depth`, since particles have no bounds to
 * measure. Particles never cast or receive shadows.
 * @example
 * ```ts
 * const sparks = new ParticleContainer3D({
 *   texture: spark,
 *   capacity: 500,
 *   blendMode: 'add',
 *   space: 'local',
 * });
 * ```
 * @see {@link ParticleContainer3D} For the constructed container.
 * @category scene
 * @standard
 */
export interface ParticleContainer3DOptions<B extends readonly ShaderBit[] = readonly ShaderBit[]> extends Omit<
  Container3DOptions,
  'width' | 'height' | 'depth'
> {
  /**
   * The sprite drawn for every particle
   *
   * Pass an array of frames for a flipbook. The frames must share one `TextureSource`, such as a
   * sprite sheet.
   * @default Texture.WHITE
   * @example
   * ```ts
   * const sparks = new ParticleSystem3D({ texture: sparkTexture });
   * const flames = new ParticleSystem3D({ texture: sheet.animations.flame, frameMode: 'animate' });
   * ```
   */
  texture?: Texture | readonly Texture[];
  /**
   * How many particles the system can hold, fixed for its lifetime
   *
   * Every slot costs 4 vertices whether or not a particle is in it, so size it to the peak you
   * need.
   * @default 1000
   * @example
   * ```ts
   * const puff = new ParticleSystem3D({ capacity: 64 });
   * ```
   */
  capacity?: number;
  /**
   * How each particle faces the camera; see {@link ParticleBillboardMode}
   * @default 'spherical'
   * @example
   * ```ts
   * const fire = new ParticleSystem3D({ billboard: 'cylindrical' });
   * ```
   */
  billboard?: ParticleBillboardMode;
  /**
   * How particles blend over the scene; see {@link ParticleBlendMode}
   * @default 'normal'
   * @example
   * ```ts
   * const sparks = new ParticleSystem3D({ blendMode: 'add' });
   * ```
   */
  blendMode?: ParticleBlendMode;
  /**
   * Whether particle positions are in world space (`'world'`) or relative to this node
   * (`'local'`)
   *
   * World-space particles are left behind as the emitter moves, which suits smoke and dust.
   * Local-space particles move with the node, so a system on a moving object travels with it, at
   * no extra cost. Particle size is a world-space diameter either way; the node's scale doesn't
   * change it.
   * @default 'world'
   * @example
   * ```ts
   * const exhaust = new ParticleSystem3D({ space: 'local' });
   * ship.addChild(exhaust);
   * ```
   */
  space?: ParticleSpace;
  /**
   * How particle transparency works
   *
   * - `'blend'`: blends over the scene with {@link ParticleContainer3DOptions.blendMode | blendMode}.
   *   Particles draw in slot order, not sorted by depth, which shows under `'normal'` blending.
   * - `'mask'`: hard-edged cutouts that write depth, so they overlap correctly in any order; suits
   *   leaves and debris.
   * - `'opaque'`: solid quads, the cheapest; only for textures with no transparent texels.
   * @default 'blend'
   * @example
   * ```ts
   * const leaves = new ParticleSystem3D({ texture: leafTexture, alphaMode: 'mask' });
   * ```
   */
  alphaMode?: AlphaMode;
  /**
   * Alpha below which a texel is cut away under `alphaMode: 'mask'`
   * @default 0.5
   * @example
   * ```ts
   * const leaves = new ParticleSystem3D({ texture: leafTexture, alphaMode: 'mask', alphaCutoff: 0.3 });
   * ```
   */
  alphaCutoff?: number;
  /**
   * Extra shader bits composed into the particle material
   *
   * Each bit's `attributes` get space in every particle, writable with
   * {@link ParticleContainer3D.setParticle}, and its `material` bindings become fields on the
   * container's {@link ParticleContainer3D.uniforms | uniforms}. The bits run after the base colour
   * is sampled, so they see and can change `albedo` and `alpha`; {@link getParticleBit} lists the
   * vertex-stage locals they can change.
   * @example
   * ```ts
   * const particles = new ParticleContainer3D({ extraBits: [particleLifetimeBit, particleAlphaOverLifeBit] });
   * ```
   */
  extraBits?: B;
}

/**
 * Typed-array views over the particle vertex buffer, for code that writes particles itself
 * instead of through {@link ParticleContainer3D.setParticleAt | setParticleAt}
 *
 * All three views share one `ArrayBuffer`. Each particle is 4 consecutive vertices holding the
 * same data. Vertex `v`'s position starts at `f32[v * floatStride]`, and any other attribute sits
 * `offsets[name] / 4` elements after that. Call {@link ParticleContainer3D.markDirty | markDirty}
 * for what you write.
 * @category scene
 * @advanced
 */
export interface ParticleContainerViews {
  /** The buffer as floats: position, size, rotation, and the float attributes of extra bits */
  f32: Float32Array;
  /** The buffer as 32-bit words, for packed attributes such as the `unorm8x4` colour */
  u32: Uint32Array;
  /** The buffer as 16-bit words, for the `unorm16x4` flipbook frame of a system with frames */
  u16: Uint16Array;
  /**
   * Elements per vertex in {@link ParticleContainerViews.f32} and
   * {@link ParticleContainerViews.u32}: 6 for a plain system, 8 with frames, more with extra bits'
   * attributes; twice that in {@link ParticleContainerViews.u16}
   */
  floatStride: number;
  /** Bytes per vertex: 24 for a plain system, 32 with frames, more with extra bits' attributes */
  vertexStride: number;
  /** Byte offset of each attribute within a vertex, by name, built-ins and extra bits' alike */
  offsets: Readonly<Record<string, number>>;
}

/**
 * A fixed pool of camera-facing quads drawn in one call, which you move yourself
 *
 * Use it to draw a simulation you already have, such as a physics solver or a replayed recording.
 * For particles that move on their own, use `ParticleSystem3D` from `@pixi/3d/extras`, which
 * extends this class.
 *
 * Write particles with {@link ParticleContainer3D.setParticleAt | setParticleAt}, which allocates
 * nothing, then call {@link ParticleContainer3D.upload | upload}. A slot with a size of 0 draws
 * nothing.
 * @example
 * ```ts
 * const particles = new ParticleContainer3D({ texture: smoke, capacity: 500, blendMode: 'add' });
 * view.root.addChild(particles);
 *
 * // Drive it yourself:
 * particles.setParticleAt(0, x, y, z, 0.5, 0, 0xff6622, 0.8);
 * particles.upload();
 *
 * // One tint for the whole pool? Pack it once, then write through writePacked:
 * const tint = packParticleColor(0xff6622, 0.8);
 *
 * for (let i = 0; i < count; i++) particles.writePacked(i, x[i], y[i], z[i], 0.5, 0, tint);
 * particles.upload();
 * ```
 * @see {@link ParticleContainer3DOptions} for the constructor options.
 * @typeParam B - The extra bits, inferred from `extraBits`; they decide what
 * {@link ParticleContainer3D.setParticle} accepts. On the bare `ParticleContainer3D` type,
 * `setParticle` type-checks only the built-in attributes.
 * @category scene
 * @advanced
 */
export class ParticleContainer3D<B extends readonly ShaderBit[] = readonly ShaderBit[]> extends Mesh3D {
  /** How many particles the pool holds, fixed at construction */
  public readonly capacity: number = 0;

  /** Whether particle positions are in world space or this node's, fixed at construction */
  public readonly space: ParticleSpace;

  /** Typed-array views over the vertex buffer; see {@link ParticleContainerViews} */
  public readonly data: ParticleContainerViews;

  /**
   * The flipbook frames, in frame order; one entry for a single sprite
   *
   * A `ParticleSystem3D` with `frameMode` `'animate'` or `'overLife'` holds one texture over the
   * whole sheet here instead.
   */
  public readonly textures: readonly Texture[];

  /** Each frame's window in the vertex buffer's `unorm16x4` encoding; empty for a single sprite */
  protected readonly _packedFrames: Uint16Array;
  /** A flipbook's whole sheet, so the material's UV transform is identity, as `ParticleMaterial` requires */
  private readonly _sheet: Texture | null;

  private readonly _vertexBuffer: Buffer;
  /**
   * Shared with other containers until `destroy`; `aUV` goes last, since the vertex count comes from
   * the first attribute and the shared corner buffer can be bigger
   */
  private readonly _quads: SharedQuadBuffers;
  private readonly _floatStride: number = 0;
  private readonly _sizeRotIndex: number = 0;
  private readonly _colorIndex: number = 0;
  /** `-1` when the system has one frame */
  private readonly _uvFrameIndex: number = 0;
  /** Built from the bits of `ParticleMaterial._bits` that declare attributes: the particle bit and the extra bits */
  private readonly _attributes: Record<string, ParticleAttribute>;
  private readonly _bytesPerParticle: number = 0;
  private readonly _particleMaterial: ParticleMaterial;

  /** Inclusive dirty particle range; `_dirtyHi < _dirtyLo` means nothing pending */
  private _dirtyLo = 0;
  private _dirtyHi = -1;

  /** Highest slot written since the last `clear`; every slot past it is still zero */
  private _written = -1;

  /** Defaults for every new `ParticleContainer3D`; an option passed as `undefined` keeps its default */
  public static override defaultOptions: ParticleContainer3DOptions = {
    capacity: 1000,
    billboard: 'spherical',
    blendMode: 'normal',
    space: 'world',
    alphaMode: 'blend',
    alphaCutoff: 0.5,
  };

  /**
   * Creates a particle container; add it under a {@link View3D}'s root to draw it
   * @param options - Construction options; see {@link ParticleContainer3DOptions}.
   */
  constructor(options: ParticleContainer3DOptions<B> = {}) {
    const { capacity, billboard, blendMode, space, texture, extraBits, alphaMode, alphaCutoff, parent, ...rest } = {
      ...ParticleContainer3D.defaultOptions,
      ...definedProps(options),
    };

    if (capacity === undefined || !Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`[ParticleContainer3D] capacity must be a whole number of at least 1, got ${capacity}`);
    }

    const textures: readonly Texture[] =
      texture === undefined
        ? [Texture.WHITE]
        : Array.isArray(texture)
          ? (texture as readonly Texture[]).slice()
          : [texture as Texture];
    if (textures.length === 0) throw new Error('[ParticleContainer3D] texture: [] names no frames');

    const packedFrames = packParticleFrames(textures);
    const useFrames = textures.length > 1;
    const sheet = useFrames ? new Texture({ source: textures[0].source }) : null;

    const particleBit = getParticleBit({ billboard: billboard!, frames: useFrames, localSpace: space === 'local' });
    const layout = buildParticleLayout(collectAttributes([particleBit, ...(extraBits ?? [])]));
    const { vertexStride } = layout;
    const floatStride = vertexStride / 4;
    const vertexCount = capacity * VERTS_PER_PARTICLE;

    const words = new ArrayBuffer(vertexCount * vertexStride);
    const f32 = new Float32Array(words);
    const vertexBuffer = new Buffer({
      data: f32,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      label: 'particle-vertices',
      shrinkToFit: false,
    });

    const attributes: Record<string, Attribute> = {};

    for (const [name, a] of Object.entries(layout.attributes)) {
      attributes[name] = { buffer: vertexBuffer, format: a.format, stride: vertexStride, offset: a.offset };
    }

    const quads = acquireQuadBuffers(capacity);

    attributes.aUV = { buffer: quads.corners, format: 'unorm8x2', stride: 4, offset: 0 };

    const geometry = new Geometry3D({
      attributes,
      indices: quads.indices,
      indexCount: capacity * INDICES_PER_PARTICLE,
      topology: 'triangle-list',
      dynamic: true,
    });

    const material = new ParticleMaterial({
      texture: sheet ?? textures[0],
      billboard,
      useFrames,
      localSpace: space === 'local',
      blendMode,
      alphaMode,
      alphaCutoff,
      extraBits,
    });

    super({ label: 'ParticleContainer3D', ...rest, geometry, material, castShadow: false, receiveShadow: false });

    this.capacity = capacity;
    this.space = space!;
    this.textures = textures;
    this._packedFrames = packedFrames;
    this._sheet = sheet;
    this._particleMaterial = material;
    this._vertexBuffer = vertexBuffer;
    this._quads = quads;
    this._floatStride = floatStride;
    this._sizeRotIndex = layout.attributes.aParticleSizeRot.index;
    this._colorIndex = layout.attributes.aParticleColor.index;
    this._uvFrameIndex = useFrames ? layout.attributes.aParticleUVFrame.index : -1;
    this._attributes = layout.attributes;
    this._bytesPerParticle = VERTS_PER_PARTICLE * vertexStride;
    this._dirtyLo = capacity;

    this.data = {
      f32,
      u32: new Uint32Array(words),
      u16: new Uint16Array(words),
      floatStride,
      vertexStride,
      offsets: Object.fromEntries(Object.entries(layout.attributes).map(([name, a]) => [name, a.offset])),
    };

    parent?.addChild(this);
  }

  /**
   * The uniforms the composed bits declare in their `material` bindings, by name
   *
   * Assigning one uploads it, so `particles.uniforms.uParticleTime = t` is a whole per-frame update.
   * A vector takes an array, such as `uGravity = [0, -9.8, 0]`; a `{ x, y, z }` object is silently
   * ignored. A vector reads back as a `Float32Array`, and writing one of its elements isn't
   * uploaded until you call `particles.material.update()`.
   */
  get uniforms(): Record<string, unknown> {
    return this._particleMaterial.data;
  }

  /** Always `'none'`; particles face the camera through the `billboard` option instead */
  override get billboardMode(): BillboardMode {
    return 'none';
  }

  /**
   * Ignored; a value other than `'none'` warns
   * @param value - Ignored
   */
  override set billboardMode(value: BillboardMode) {
    if (value === 'none') return;
    warnOnce(
      'pixi3d-particle-billboard-mode',
      `[ParticleContainer3D] billboardMode '${value}' is ignored — a particle container orients each quad ` +
        'itself. Pass the `billboard` option to the constructor instead.',
    );
  }

  /**
   * How particles blend over the scene; see {@link ParticleBlendMode}
   *
   * Ignored unless `alphaMode` is `'blend'`. A change rebuilds the draw state, so prefer setting it
   * once at construction. Fog reaches the particles only if the blend mode was `'normal'` at
   * construction; a later change doesn't turn it on or off.
   */
  get blendMode(): ParticleBlendMode {
    return this._particleMaterial.state.blendMode as ParticleBlendMode;
  }

  /**
   * Sets the blend mode
   * @param value - How particles blend over the scene.
   */
  set blendMode(value: ParticleBlendMode) {
    const material = this._particleMaterial;

    if (material.alphaMode !== 'blend' || material.state.blendMode === value) return;
    material.state.blendMode = value;
    this.invalidate();
  }

  /**
   * Writes one particle, to go out with the next {@link upload}
   *
   * Positions are in world space unless the container was built with `space: 'local'`. A `size`
   * of 0 empties the slot. To write many particles with one tint, {@link writePacked} skips
   * packing the colour on every call.
   * @param index - Slot to write, 0 to `capacity - 1`.
   * @param x - Particle centre x.
   * @param y - Particle centre y.
   * @param z - Particle centre z.
   * @param size - World-space diameter.
   * @param rotation - Spin in the quad's plane, in radians.
   * @param color - `0xRRGGBB` tint, in display (sRGB) space.
   * @param alpha - Opacity, 0 to 1.
   * @param frame - Flipbook frame index, wrapping past the last frame; ignored with one frame.
   */
  public setParticleAt(
    index: number,
    x: number,
    y: number,
    z: number,
    size: number,
    rotation = 0,
    color = 0xffffff,
    alpha = 1,
    frame = 0,
  ): void {
    this.writePacked(index, x, y, z, size, rotation, packParticleColor(color, alpha), frame);
  }

  /**
   * {@link setParticleAt} with a colour already packed by {@link packParticleColor}
   *
   * Use it when a tint is fixed, or changes less often than you write particles: pack it once,
   * then write many.
   * @param index - Slot to write, 0 to `capacity - 1`.
   * @param x - Particle centre x.
   * @param y - Particle centre y.
   * @param z - Particle centre z.
   * @param size - World-space diameter.
   * @param rotation - Spin in the quad's plane, in radians.
   * @param packedColor - Tint and opacity as `packParticleColor` returns them.
   * @param frame - Flipbook frame index, wrapping past the last frame; ignored with one frame.
   */
  public writePacked(
    index: number,
    x: number,
    y: number,
    z: number,
    size: number,
    rotation: number,
    packedColor: number,
    frame = 0,
  ): void {
    this._checkIndex(index);

    const stride = this._floatStride;
    const sizeRot = this._sizeRotIndex;
    const colorIndex = this._colorIndex;
    const { f32, u32 } = this.data;
    let o = index * VERTS_PER_PARTICLE * stride;

    for (let v = 0; v < VERTS_PER_PARTICLE; v++) {
      f32[o] = x;
      f32[o + 1] = y;
      f32[o + 2] = z;
      f32[o + sizeRot] = size;
      f32[o + sizeRot + 1] = rotation;
      u32[o + colorIndex] = packedColor;
      o += stride;
    }

    if (this._uvFrameIndex >= 0) this._writeFrame(index, frame);

    if (index < this._dirtyLo) this._dirtyLo = index;
    if (index > this._dirtyHi) this._dirtyHi = index;
    if (index > this._written) this._written = index;
  }

  /** Kept out of `writePacked`, so that stays small enough for V8 to inline into a caller's loop */
  private _writeFrame(index: number, frame: number): void {
    const stride = this._floatStride;
    const uvFrame = this._uvFrameIndex;
    const u16 = this.data.u16;
    const n = this.textures.length;
    const w = (((Math.floor(frame) % n) + n) % n) * 4;
    const packed = this._packedFrames;
    const u0 = packed[w];
    const v0 = packed[w + 1];
    const us = packed[w + 2];
    const vs = packed[w + 3];
    let o = index * VERTS_PER_PARTICLE * stride;

    for (let v = 0; v < VERTS_PER_PARTICLE; v++) {
      const h = (o + uvFrame) * 2;

      u16[h] = u0;
      u16[h + 1] = v0;
      u16[h + 2] = us;
      u16[h + 3] = vs;

      o += stride;
    }
  }

  /**
   * Writes any of a particle's attributes by name, to go out with the next {@link upload}
   *
   * Every `float32` to `float32x4`, `unorm8x4` and `unorm16x4` attribute the composed bits declare
   * can be written, built-ins included, so a bit that declares `aVel` makes `{ aVel: { x, y, z } }`
   * valid here; other formats throw, so write them through {@link data}. Attributes not named keep
   * their values. Each value takes the shape of its format; see {@link ParticleValues}. Declare your
   * bits with `satisfies ShaderBit`, not `: ShaderBit`, or their names and shapes aren't
   * type-checked.
   *
   * It looks each name up, so it's slower than {@link setParticleAt}: use it to spawn a particle,
   * not to rewrite every particle every frame.
   * @param index - Slot to write, 0 to `capacity - 1`.
   * @param values - Attribute name to value. An undeclared name throws.
   */
  public setParticle(index: number, values: ParticleValues<B>): void {
    this._checkIndex(index);

    const record = values as Record<string, ParticleAttributeValue>;
    const attributes = this._attributes;
    const stride = this._floatStride;
    const { f32, u32, u16 } = this.data;
    const base = index * VERTS_PER_PARTICLE * stride;

    for (const name in record) {
      const attribute = attributes[name];

      if (attribute === undefined) {
        throw new Error(
          `[ParticleContainer3D] no attribute '${name}'. The composed bits declare: ${Object.keys(attributes).join(', ')}`,
        );
      }

      const value = record[name];

      if (value === undefined) continue;

      let o = base + attribute.index;

      switch (attribute.kind) {
        case 'float': {
          const n = attribute.components;

          expectShape(name, value, n);

          if (n === 1) {
            for (let v = 0; v < VERTS_PER_PARTICLE; v++, o += stride) f32[o] = value as unknown as number;
          } else {
            for (let v = 0; v < VERTS_PER_PARTICLE; v++, o += stride) {
              f32[o] = value.x;
              f32[o + 1] = value.y;
              if (n > 2) f32[o + 2] = value.z;
              if (n > 3) f32[o + 3] = value.w;
            }
          }
          break;
        }
        case 'color': {
          const packed = packParticleColor(Color.shared.setValue(value as ColorSource).toNumber(), Color.shared.alpha);

          for (let v = 0; v < VERTS_PER_PARTICLE; v++, o += stride) u32[o] = packed;
          break;
        }
        case 'unorm8': {
          expectShape(name, value, 4);

          const packed =
            (unorm8(value.x) | (unorm8(value.y) << 8) | (unorm8(value.z) << 16) | (unorm8(value.w) << 24)) >>> 0;

          for (let v = 0; v < VERTS_PER_PARTICLE; v++, o += stride) u32[o] = packed;
          break;
        }
        case 'unorm16': {
          expectShape(name, value, 4);

          let h = o * 2;

          for (let v = 0; v < VERTS_PER_PARTICLE; v++, h += stride * 2) {
            u16[h] = unorm16(value.x);
            u16[h + 1] = unorm16(value.y);
            u16[h + 2] = unorm16(value.z);
            u16[h + 3] = unorm16(value.w);
          }
          break;
        }
        default:
          throw new Error(
            `[ParticleContainer3D] setParticle has no packer for '${name}'. Write it through data.offsets.`,
          );
      }
    }

    if (index < this._dirtyLo) this._dirtyLo = index;
    if (index > this._dirtyHi) this._dirtyHi = index;
    if (index > this._written) this._written = index;
  }

  /**
   * Marks particles `lo` to `hi`, inclusive, for the next {@link upload}
   *
   * Only needed after writing through {@link data} directly; the setters mark what they write.
   * The upload is one range spanning everything marked, so two far-apart particles send all the
   * slots between them. A range given the wrong way round marks the whole pool, and one past either
   * end is clamped to it.
   * @param lo - First particle in the range.
   * @param hi - Last particle in the range, inclusive.
   */
  public markDirty(lo: number, hi: number): void {
    const last = this.capacity - 1;

    if (lo > hi) {
      lo = 0;
      hi = last;
    }
    if (lo < 0) lo = 0;
    if (hi > last) hi = last;

    if (lo < this._dirtyLo) this._dirtyLo = lo;
    if (hi > this._dirtyHi) this._dirtyHi = hi;
    if (hi > this._written) this._written = hi;
  }

  /** Sends the particles written since the last upload to the GPU; call it after each frame's writes */
  public upload(): void {
    const lo = this._dirtyLo;
    const hi = this._dirtyHi;

    if (hi < lo) return;

    this._vertexBuffer.update((hi - lo + 1) * this._bytesPerParticle, lo * this._bytesPerParticle);

    this._dirtyLo = this.capacity;
    this._dirtyHi = -1;
  }

  /**
   * Empties every slot, from the next {@link upload} on
   *
   * It costs up to the highest slot written since the last clear, not the whole capacity.
   */
  public clear(): void {
    if (this._written < 0) return;

    this.data.f32.fill(0, 0, (this._written + 1) * VERTS_PER_PARTICLE * this._floatStride);
    this.markDirty(0, this._written);
    this._written = -1;
  }

  /** Throws, since a write past the pool lands nowhere but its upload range runs past the buffer */
  private _checkIndex(index: number): void {
    if (!(index >= 0 && index < this.capacity)) {
      throw new Error(`[ParticleContainer3D] particle ${index} is outside the pool of ${this.capacity}`);
    }
  }

  /**
   * Destroys the container and the geometry and material it built
   *
   * `children` works as for any node. `texture` frees a single sprite's texture but leaves a
   * flipbook's frames; add `textureSource` to free the sheet behind them.
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    const geometry = this.geometry;
    const material = this.material;

    super.destroy(options);
    geometry.destroy(false);
    releaseQuadBuffers(this._quads);
    this._vertexBuffer.destroy();
    material.destroy(options);
    this._sheet?.destroy(false);
  }

  /** Empty: under `geometry: true` the base would destroy the shared quad buffers; `destroy` keeps them */
  protected override _destroyGeometry(): void {}
}
