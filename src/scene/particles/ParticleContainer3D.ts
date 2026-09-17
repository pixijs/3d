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
 * How particle centres are interpreted — see {@link ParticleContainer3DOptions.space}
 * @category scene
 * @standard
 */
export type ParticleSpace = 'world' | 'local';

/**
 * Constructor options for {@link ParticleContainer3D}
 *
 * Every field is optional. The container builds its own geometry and material, so it takes the
 * {@link Container3DOptions} rather than the mesh ones, except `width`, `height` and `depth`: the
 * quads take shape in the shader, so the node has no local bounds to size against. Shadows are
 * always off.
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
   * Pass an array of frames for a flipbook — they must share one
   * `TextureSource` (a sprite sheet), since the whole system is a single draw
   * call.
   * @default Texture.WHITE
   */
  texture?: Texture | readonly Texture[];
  /**
   * How many particles the buffer can hold
   *
   * Fixed for the buffer's lifetime. Every slot costs 4 vertices whether or
   * not it's alive, so size it to the peak you actually need.
   * @default 1000
   */
  capacity?: number;
  /**
   * How each quad is oriented before its corners expand
   * @default 'spherical'
   */
  billboard?: ParticleBillboardMode;
  /**
   * How particles blend over the scene — see {@link ParticleBlendMode}
   * @default 'normal'
   */
  blendMode?: ParticleBlendMode;
  /**
   * Whether particle centres are world-space (`'world'`) or relative to this
   * node's transform (`'local'`)
   *
   * World-space particles are left behind as the emitter moves — the right
   * default for smoke and dust. Local-space particles ride the emitter's
   * transform, which the vertex shader applies for free, so a system attached
   * to a moving object travels with it.
   *
   * Particle *size* is a world-space diameter in both modes and is unaffected
   * by the node's scale.
   * @default 'world'
   */
  space?: ParticleSpace;
  /**
   * Which of the standard material alpha modes the particles use
   *
   * `'blend'` composites; `'mask'` makes hard depth-writing cutouts (no
   * inter-system sorting artifacts, early-z instead of blend fill rate);
   * `'opaque'` renders whole quads solid — only right for textures with no
   * transparent texels, where it's the cheapest mode of all.
   * @default 'blend'
   */
  alphaMode?: AlphaMode;
  /** Coverage threshold for `'mask'` — texels below it are discarded @default 0.5 */
  alphaCutoff?: number;
  /**
   * Extra shader bits composed into the particle material
   *
   * Soft particles, custom fades, distortion. They see the post-baseColor
   * `albedo` / `alpha`.
   *
   * A bit's `attributes` get space in the vertex buffer and its `bindings`
   * become accessors on the container's `uniforms`, so declaring what a bit
   * needs is all it takes for the container to carry it.
   */
  extraBits?: B;
}

/**
 * Raw typed-array views over the interleaved particle vertex buffer
 *
 * For code that writes records itself instead of going through
 * {@link ParticleContainer3D.setParticleAt | setParticleAt}.
 *
 * All three views alias one `ArrayBuffer`. Strides are in elements of the view
 * they name, so vertex `v`'s position starts at `f32[v * floatStride]`, and any
 * other attribute is at `offsets[name] / 4` elements past that. Every particle is 4
 * consecutive vertices carrying identical data.
 * @category scene
 * @advanced
 */
export interface ParticleContainerViews {
  /** Positions (3), size, rotation */
  f32: Float32Array;
  /** The packed `unorm8x4` colour attribute */
  u32: Uint32Array;
  /** The packed `unorm16x4` frame attribute, when the system has flipbook frames */
  u16: Uint16Array;
  /**
   * Elements per vertex in {@link ParticleContainerViews.f32} /
   * {@link ParticleContainerViews.u32} — 6 for a plain system, 8 with frames,
   * more once extra bits declare attributes
   */
  floatStride: number;
  /** Bytes per vertex — 24 for a plain system, 32 with frames, more once extra bits declare attributes */
  vertexStride: number;
  /**
   * Attribute name to byte offset within a vertex, derived from the attributes
   * the composed bits declare
   *
   * This is how code writing a bit's attribute by hand finds where it lives.
   */
  offsets: Readonly<Record<string, number>>;
}

/**
 * The rendering half of a particle system: a fixed pool of camera-facing quads
 * drawn in one call, with no opinion whatsoever about how they move
 *
 * This is the layer to build on when you already have a simulation — a physics
 * solver, a replayed recording, a GPU readback — and just want it on screen
 * cheaply. For "make smoke without writing a sim", use `ParticleSystem3D` from
 * `@pixi/3d/extras`, which extends this class.
 *
 * Every particle is four vertices in one streaming buffer, so the whole pool is
 * a single draw call and a single upload. Writing a particle is
 * {@link ParticleContainer3D.setParticleAt | setParticleAt}; nothing allocates,
 * and there are no per-particle objects anywhere. A dead slot is simply one
 * with `size = 0` — its quad collapses to a point and rasterizes nothing.
 *
 * `setParticleAt` packs the colour on every call. When a tint is fixed, or
 * changes more slowly than once per particle per frame, pack it yourself with
 * `packParticleColor` and write through
 * {@link ParticleContainer3D.writePacked | writePacked} instead.
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
 * @see `ParticleSystem3D` from `@pixi/3d/extras` for the standard simulation built on top of this.
 * @see {@link ParticleContainer3DOptions} for the constructor options.
 * @category scene
 * @advanced
 */
export class ParticleContainer3D<B extends readonly ShaderBit[] = readonly ShaderBit[]> extends Mesh3D {
  /** How many particles this buffer can hold. Fixed at construction */
  public readonly capacity: number;

  /** How particle centres are interpreted. Fixed at construction */
  public readonly space: ParticleSpace;

  /** Raw views over the interleaved vertex buffer — see {@link ParticleContainerViews} */
  public readonly data: ParticleContainerViews;

  /**
   * The textures particles sample, one entry per flipbook frame
   *
   * A particle's `frame` index means `textures[frame]`. A single entry for
   * plain sprites; every entry shares one `TextureSource`.
   */
  public readonly textures: readonly Texture[];

  /**
   * Each frame's sampling region, pre-quantized into the vertex layout's own
   * `unorm16x4` encoding
   *
   * `writePacked` copies it without conversion — the same idea as
   * `texture.uvs`, compacted to the bytes the GPU reads. Empty for
   * single-sprite systems. Derived once from `textures` at construction. The
   * encoding stays internal: callers reference frames by index, and
   * `setParticleAt` / `writePacked` do the stamping.
   */
  protected readonly _packedFrames: Uint16Array;
  /** The whole-sheet wrapper a flipbook binds, owned here; `null` for a single sprite */
  private readonly _sheet: Texture | null;

  private readonly _vertexBuffer: Buffer;
  /** The corner and index pair shared with every other container, released in `destroy` */
  private readonly _quads: SharedQuadBuffers;
  private readonly _floatStride: number;
  /** Float index of the size/rotation pair within a vertex, derived from the layout */
  private readonly _sizeRotIndex: number;
  /** Float index of the packed colour within a vertex, derived from the layout */
  private readonly _colorIndex: number;
  /** Float index of the packed frame window, or `-1` when the system has one frame */
  private readonly _uvFrameIndex: number;
  /** Every declared attribute by name, resolved — see `ParticleAttribute` */
  private readonly _attributes: Record<string, ParticleAttribute>;
  private readonly _bytesPerParticle: number;
  private readonly _particleMaterial: ParticleMaterial;

  /** Inclusive dirty particle range; `_dirtyHi < _dirtyLo` means nothing pending */
  private _dirtyLo: number;
  private _dirtyHi = -1;

  /** Highest slot ever written — the untouched tail beyond it is still zero */
  private _written = -1;

  /**
   * Default {@link ParticleContainer3DOptions} merged under every constructor call
   *
   * Mutate to change the defaults process-wide.
   */
  public static override defaultOptions: ParticleContainer3DOptions = {
    capacity: 1000,
    billboard: 'spherical',
    blendMode: 'normal',
    space: 'world',
    alphaMode: 'blend',
    alphaCutoff: 0.5,
  };

  /**
   * Creates a particle container
   *
   * Add it under a {@link View3D}'s root to render it.
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
    // A Texture's frame is CPU metadata, not a GPU crop: binding any frame
    // binds the shared sheet source. A flipbook binds a wrapper over the whole
    // sheet, so the derived uv transform is identity and the packed frames own
    // all UV mapping; a single sprite keeps its own frame, which IS its framing.
    const sheet = useFrames ? new Texture({ source: textures[0].source }) : null;

    // The same list ParticleMaterial composes; getParticleBit is cached, so
    // this is the very object the shader is generated from.
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

    // The corner id is per-vertex rather than per-particle, the only thing
    // telling a quad's four identical records apart. It and the indices are the
    // same for every container, so both come from one pair shared by all of
    // them, grown to the largest capacity asked for, and this geometry draws
    // its own prefix. The records stay first so the vertex count reads off
    // this container, not the shared pair.
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

    // Joining a parent reads the finished container, so it waits for the end.
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
   * The container's uniforms, by the name bits read them under
   *
   * Assigning marks the material for upload, so `particles.uniforms.uTime = t`
   * is the whole of a per-frame update. Only names the composed bits declare in
   * their `material` bindings exist here.
   *
   * Scalars take a number. Vectors take an array, `uGravity = [0, -9.8, 0]`,
   * and read back as a `Float32Array` view. A point-shaped object is not an
   * `ArrayLike` and is silently ignored, so `{ x, y, z }` leaves the uniform at
   * whatever it was.
   */
  get uniforms(): Record<string, unknown> {
    return this._particleMaterial.data as unknown as Record<string, unknown>;
  }

  /**
   * Always `'none'` — a particle container billboards each of its quads itself, so
   * the mesh-level billboard is refused rather than layered on top
   *
   * Both write the vertex `afterTransform` slot, and the mesh one rebuilds
   * `worldPosition` around the node's origin — which a `space: 'local'` system
   * then expands from, displacing every particle. Use the `billboard` option
   * instead; see {@link ParticleBillboardMode}.
   */
  override get billboardMode(): BillboardMode {
    return 'none';
  }

  /**
   * Refuses the assignment and warns — see the getter
   * @param value - Ignored; anything but `'none'` warns.
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
   * How particles blend over the scene — see {@link ParticleBlendMode}
   *
   * Switching rebuilds pipeline state, so prefer setting it once at
   * construction. Applies under `alphaMode: 'blend'` only.
   */
  get blendMode(): ParticleBlendMode {
    return this._particleMaterial.state.blendMode as ParticleBlendMode;
  }

  /**
   * Switches the blend, rebuilding the pipeline state on the next frame
   *
   * Ignored under `'mask'` and `'opaque'`, which don't blend. `fog` stays as
   * construction decided.
   * @param value - How particles blend over the scene.
   */
  set blendMode(value: ParticleBlendMode) {
    const material = this._particleMaterial;

    if (material.alphaMode !== 'blend' || material.state.blendMode === value) return;
    material.state.blendMode = value;
    this.invalidate();
  }

  /**
   * Writes one particle's record into all four of its vertices and extends the
   * pending upload range
   *
   * Positions are world-space unless the buffer was built with
   * `space: 'local'`. `size` is a world-space diameter, so a particle shrinks
   * with distance like everything else in the scene. Size 0 kills the slot: the
   * quad collapses and costs no fill rate.
   *
   * The colour is packed into the shader's `unorm8x4` attribute on every call. When
   * a tint doesn't vary per particle, hoist that out with `packParticleColor`
   * and write through {@link writePacked}.
   * @param index - Slot to write, in `[0, capacity)`.
   * @param x - Particle centre x.
   * @param y - Particle centre y.
   * @param z - Particle centre z.
   * @param size - World-space diameter.
   * @param rotation - Spin about the view axis, in radians.
   * @param color - Display-space `0xRRGGBB` tint, sRGB-decoded like every other colour in the engine.
   * @param alpha - Opacity in `[0, 1]`.
   * @param frame - Flipbook frame index; ignored by single-sprite systems.
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
   * Writes one particle's record with the colour already packed into the
   * shader's `unorm8x4` attribute
   *
   * The same write as {@link setParticleAt}, minus the colour packing (see
   * `packParticleColor`). Write through this whenever a tint is fixed, or
   * changes more slowly than once per particle per frame, to keep colour
   * packing off the write path — it is how `ParticleSystem3D` from
   * `@pixi/3d/extras` drives its own pool.
   * @param index - Slot to write, in `[0, capacity)`.
   * @param x - Particle centre x.
   * @param y - Particle centre y.
   * @param z - Particle centre z.
   * @param size - World-space diameter.
   * @param rotation - Spin about the view axis, in radians.
   * @param packedColor - Tint and opacity as `packParticleColor` returns them.
   * @param frame - Flipbook frame index; ignored by single-sprite systems.
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
    const uvFrame = this._uvFrameIndex;
    const { f32, u32, u16 } = this.data;
    let o = index * VERTS_PER_PARTICLE * stride;

    if (uvFrame >= 0) {
      const n = this.textures.length;
      const w = (((Math.floor(frame) % n) + n) % n) * 4;
      const packed = this._packedFrames;
      const u0 = packed[w];
      const v0 = packed[w + 1];
      const us = packed[w + 2];
      const vs = packed[w + 3];

      for (let v = 0; v < VERTS_PER_PARTICLE; v++) {
        f32[o] = x;
        f32[o + 1] = y;
        f32[o + 2] = z;
        f32[o + sizeRot] = size;
        f32[o + sizeRot + 1] = rotation;
        u32[o + colorIndex] = packedColor;

        const h = (o + uvFrame) * 2;

        u16[h] = u0;
        u16[h + 1] = v0;
        u16[h + 2] = us;
        u16[h + 3] = vs;

        o += stride;
      }
    } else {
      for (let v = 0; v < VERTS_PER_PARTICLE; v++) {
        f32[o] = x;
        f32[o + 1] = y;
        f32[o + 2] = z;
        f32[o + sizeRot] = size;
        f32[o + sizeRot + 1] = rotation;
        u32[o + colorIndex] = packedColor;
        o += stride;
      }
    }

    if (index < this._dirtyLo) this._dirtyLo = index;
    if (index > this._dirtyHi) this._dirtyHi = index;
    if (index > this._written) this._written = index;
  }

  /**
   * Writes any of a particle's declared attributes by name, into all four of its
   * vertices, and extends the pending upload range
   *
   * Every attribute the composed bits declare is addressable, built-ins included, so
   * a bit that declares `aVel` makes `{ aVel: { x, y, z } }` valid here with no
   * other wiring. Attributes not named are left as they were. Values take the shape
   * their format implies (see {@link ParticleAttributeValue}); the built-in tint
   * takes any `ColorSource` and is sRGB-decoded like {@link setParticleAt}'s
   * `color`.
   *
   * This is the general writer. It reads its keys by name, which costs several
   * times what the positional `setParticleAt` does, so it suits spawning, where
   * a slot is written once, rather than rewriting every particle every frame.
   * @param index - Slot to write, in `[0, capacity)`.
   * @param values - Attribute name to value. An undeclared name throws.
   */
  public setParticle(index: number, values: ParticleValues<B>): void {
    this._checkIndex(index);

    // The mapped type is for callers; inside, it is a record like any other.
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
   * Extends the pending upload range to cover particles `[lo, hi]` inclusive
   *
   * Only needed when writing through {@link data} directly;
   * {@link setParticleAt} does it for you. A range given the wrong way round,
   * or one that wraps the pool, marks the whole pool; the upload is one
   * contiguous range.
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

  /**
   * Uploads the pending range and clears it
   *
   * One contiguous `Buffer.update` covers every attribute, because they share
   * one interleaved buffer. Free to call when nothing is dirty.
   *
   * Call it once per frame, after every write: on WebGL only the last range
   * handed over before a draw is uploaded, so two calls in one frame would drop
   * the first.
   */
  public upload(): void {
    const lo = this._dirtyLo;
    const hi = this._dirtyHi;

    if (hi < lo) return;

    this._vertexBuffer.update((hi - lo + 1) * this._bytesPerParticle, lo * this._bytesPerParticle);

    this._dirtyLo = this.capacity;
    this._dirtyHi = -1;
  }

  /**
   * Zeroes every slot ever written so the whole pool stops drawing
   *
   * Marks the range for the next {@link upload}. The pool's untouched tail is
   * still zero from construction, so the cost scales with slots actually used,
   * not capacity.
   */
  public clear(): void {
    if (this._written < 0) return;

    this.data.f32.fill(0, 0, (this._written + 1) * VERTS_PER_PARTICLE * this._floatStride);
    this.markDirty(0, this._written);
    this._written = -1;
  }

  /**
   * Throws for a slot outside the pool
   *
   * A write there lands nowhere and the upload would ask for bytes past the buffer.
   * @param index - Slot to check.
   */
  private _checkIndex(index: number): void {
    if (!(index >= 0 && index < this.capacity)) {
      throw new Error(`[ParticleContainer3D] particle ${index} is outside the pool of ${this.capacity}`);
    }
  }

  /**
   * Destroys the container and everything it built
   *
   * The geometry, material and vertex buffer are built here and owned here, so
   * they always go — `options` only decides whether the cascade reaches the
   * textures you supplied, and what any destroyed children are told.
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    const geometry = this.geometry;
    const material = this.material;

    // Forwarded unchanged, so destroyed children see exactly what the caller asked for. The
    // geometry is spared by the `_destroyGeometry` no-op — its corner and index buffers are shared —
    // and torn down below. `material` lets the cascade free this container's own material first,
    // which the idempotent call below then skips.
    super.destroy(options);
    geometry.destroy(false);
    releaseQuadBuffers(this._quads);
    this._vertexBuffer.destroy();
    material.destroy(options);
    // The wrapper is this container's own; the sheet under it is the caller's.
    this._sheet?.destroy(false);
  }

  /**
   * No-op: this container releases its own geometry in {@link ParticleContainer3D#destroy}, calling
   * `destroy(false)` to keep the corner and index pair it shares with every other container, where
   * the base cascade would take those buffers with it. The caller's options still reach the children.
   */
  protected override _destroyGeometry(): void {}
}
