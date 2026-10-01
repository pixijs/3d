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
   * Pass an array of frames for a flipbook. The frames must share one `TextureSource`, such as a
   * sprite sheet, because the whole system is one draw call that binds one texture.
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
   * Local-space particles move with the node, so a system on a moving object travels with it,
   * at no extra cost.
   *
   * Particle size is a world-space diameter either way; the node's scale doesn't change it.
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
   * `'blend'` blends particles over the scene. `'mask'` makes hard-edged cutouts that write
   * depth, so they need no sorting and overlap correctly between systems; the pick for leaves,
   * debris and stylised effects. `'opaque'` draws whole quads solid, which is the cheapest and
   * only right for textures with no transparent texels. {@link ParticleContainer3DOptions.blendMode}
   * only applies under `'blend'`.
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
   * container's {@link ParticleContainer3D.uniforms | uniforms}. Declaring what a bit needs is
   * all it takes. The bits run after the base colour is sampled, so they see and can change
   * `albedo` and `alpha`.
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
 * All three views share one `ArrayBuffer`, and every vertex holds every attribute in turn.
 * Vertex `v`'s position starts at `f32[v * floatStride]`, and any other attribute sits
 * `offsets[name] / 4` elements after that. Each particle is 4 consecutive vertices holding the
 * same data. Call {@link ParticleContainer3D.markDirty | markDirty} for what you write.
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
 * The drawing half of a particle system: a fixed pool of camera-facing quads drawn in one call,
 * which you move yourself
 *
 * Build on this when you already have a simulation, such as a physics solver, a replayed
 * recording or a GPU readback, and want it on screen cheaply. To make smoke without writing a
 * simulation, use `ParticleSystem3D` from `@pixi/3d/extras`, which extends this class.
 *
 * Every particle is four vertices in one buffer, so the whole pool is one draw call and one
 * upload. Write a particle with {@link ParticleContainer3D.setParticleAt | setParticleAt}:
 * nothing allocates, and there are no per-particle objects. An empty slot is one with
 * `size = 0`; its quad collapses to a point and draws nothing.
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
 * @typeParam B - The extra bits, which decide what {@link ParticleContainer3D.setParticle} accepts.
 * Inferred from `extraBits`. With none given it defaults to any bits, so a variable typed as the
 * bare `ParticleContainer3D` holds every container; `setParticle` then types only the built-in
 * attributes and leaves other names to the runtime check.
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
   * The textures particles sample, one per flipbook frame
   *
   * A particle's `frame` index picks `textures[frame]`. A plain sprite has one entry. Every
   * entry shares one `TextureSource`.
   */
  public readonly textures: readonly Texture[];

  /**
   * Each frame's sampling window `(u0, v0, uScale, vScale)` in the vertex buffer's `unorm16x4`
   * encoding, so `writePacked` copies it without conversion; empty for a single sprite
   */
  protected readonly _packedFrames: Uint16Array;
  /**
   * The whole-sheet texture a flipbook binds, owned here; `null` for a single sprite
   *
   * A texture's frame doesn't crop on the GPU: binding any frame binds the whole source, and the
   * material derives a UV transform from the frame. A flipbook binds this wrapper over the whole
   * sheet, so that transform is identity and the per-particle frame windows do all the UV
   * mapping. A single sprite binds its own texture, whose frame is its framing.
   */
  private readonly _sheet: Texture | null;

  private readonly _vertexBuffer: Buffer;
  /**
   * The corner and index buffers shared with every other container, released in `destroy`
   *
   * The geometry lists the corner attribute after this container's own attributes, because a
   * geometry reads its vertex count off its first attribute, and the shared corner buffer can be
   * bigger than this container.
   */
  private readonly _quads: SharedQuadBuffers;
  private readonly _floatStride: number = 0;
  private readonly _sizeRotIndex: number = 0;
  private readonly _colorIndex: number = 0;
  /** Float index of the frame window within a vertex, or `-1` when the system has one frame */
  private readonly _uvFrameIndex: number = 0;
  /**
   * Every attribute the container's bits declare, by name, resolved to its place in a vertex
   *
   * Built from the particle bit and the extra bits, the same ones `ParticleMaterial` composes,
   * so the buffer holds exactly the attributes the shader reads. The material's other bits
   * declare none; one that did would need adding to the layout here.
   */
  private readonly _attributes: Record<string, ParticleAttribute>;
  private readonly _bytesPerParticle: number = 0;
  private readonly _particleMaterial: ParticleMaterial;

  /** Inclusive dirty particle range; `_dirtyHi < _dirtyLo` means nothing pending */
  private _dirtyLo = 0;
  private _dirtyHi = -1;

  /** Highest slot written since the last `clear`; every slot past it is still zero */
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
   * Creates a particle container; add it under a {@link View3D}'s root to draw it
   *
   * A `parent` option is applied last, once the container is fully built.
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
   * The container's uniforms, by the names the bits read them under
   *
   * Only the names the composed bits declare in their `material` bindings exist here. Assigning
   * one queues it for upload, so `particles.uniforms.uParticleTime = t` is the whole of a
   * per-frame update.
   *
   * Scalars take a number. Vectors take an array, `uGravity = [0, -9.8, 0]`, and read back as a
   * `Float32Array` view. A point-shaped object isn't an array and is silently ignored, so
   * `{ x, y, z }` leaves the uniform as it was. Writing one element of that view doesn't queue
   * an upload; call `particles.material.update()` after.
   */
  get uniforms(): Record<string, unknown> {
    return this._particleMaterial.data as unknown as Record<string, unknown>;
  }

  /**
   * Always `'none'`: a particle container turns each quad to the camera itself, so it refuses
   * the mesh-wide billboard rather than stacking the two
   *
   * The mesh billboard would turn the whole system about the node's origin, which moves every
   * particle of a `space: 'local'` system. Use the `billboard` option instead; see
   * {@link ParticleBillboardMode}.
   */
  override get billboardMode(): BillboardMode {
    return 'none';
  }

  /**
   * Refuses the assignment and warns; see the getter
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
   * How particles blend over the scene; see {@link ParticleBlendMode}
   *
   * Switching rebuilds the draw state, so prefer setting it once at construction. Applies under
   * `alphaMode: 'blend'` only.
   */
  get blendMode(): ParticleBlendMode {
    return this._particleMaterial.state.blendMode as ParticleBlendMode;
  }

  /**
   * Switches the blend, rebuilding the draw state on the next frame
   *
   * Ignored under `'mask'` and `'opaque'`, which don't blend. Whether fog reaches the particles
   * stays as the blend mode at construction decided; see `ParticleMaterialOptions.fog`.
   * @param value - How particles blend over the scene.
   */
  set blendMode(value: ParticleBlendMode) {
    const material = this._particleMaterial;

    if (material.alphaMode !== 'blend' || material.state.blendMode === value) return;
    material.state.blendMode = value;
    this.invalidate();
  }

  /**
   * Writes one particle into all four of its vertices and adds it to the pending upload
   *
   * Positions are in world space unless the container was built with `space: 'local'`. `size`
   * is a world-space diameter, so a particle shrinks with distance like everything else. Size 0
   * empties the slot: the quad collapses and costs no fill rate.
   *
   * The colour is packed on every call. When a tint doesn't vary per particle, pack it once with
   * `packParticleColor` and write through {@link writePacked}.
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
   * Writes one particle with its colour already packed by `packParticleColor`
   *
   * The same write as {@link setParticleAt}, minus the colour packing. Use it whenever a tint is
   * fixed, or changes more slowly than once per particle per frame. Its body is kept small
   * enough for V8 to inline into your per-particle loop.
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

  /**
   * Writes a particle's flipbook frame window into all four of its vertices
   *
   * Split out of `writePacked` so that stays small enough for V8 to inline into a caller's
   * per-particle loop. Past V8's inlining limit, every float argument is boxed on each call.
   * @param index - Slot to write, in `[0, capacity)`.
   * @param frame - Flipbook frame index, wrapped into `[0, textures.length)`.
   */
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
   * Writes any of a particle's attributes by name into all four of its vertices, and adds it to
   * the pending upload
   *
   * Every attribute the composed bits declare can be written, built-ins included, so a bit that
   * declares `aVel` makes `{ aVel: { x, y, z } }` valid here with no other wiring. Attributes not
   * named keep their values. Each value takes the shape its format implies (see
   * {@link ParticleAttributeValue}); the built-in tint takes any `ColorSource`, decoded like
   * {@link setParticleAt}'s `color`.
   *
   * Looking keys up by name costs several times what the positional `setParticleAt` does, so
   * this suits spawning, where a slot is written once, rather than rewriting every particle
   * every frame.
   * @param index - Slot to write, in `[0, capacity)`.
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
   * Adds particles `lo` to `hi`, inclusive, to the pending upload
   *
   * Only needed after writing through {@link data} directly; the setters do it for you. The
   * upload is one contiguous range covering everything marked. A range given the wrong way
   * round marks the whole pool, and one past either end is clamped to it.
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
   * One range covers every attribute, because they share one buffer. Free when nothing is
   * pending.
   *
   * Call it once per frame, after every write. On WebGL, pixi uploads only the last range it was
   * handed before a draw, so a second call in the same frame would drop the first range.
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
   * Empties every slot, so the whole pool stops drawing
   *
   * Adds the emptied range to the next {@link upload}. Slots never written are still zero, so
   * the cost follows the slots used, not the capacity.
   */
  public clear(): void {
    if (this._written < 0) return;

    this.data.f32.fill(0, 0, (this._written + 1) * VERTS_PER_PARTICLE * this._floatStride);
    this.markDirty(0, this._written);
    this._written = -1;
  }

  /**
   * Throws for a slot outside the pool, where a write would land nowhere and the upload would ask
   * for bytes past the buffer
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
   * Its geometry, material and vertex buffer, and a flipbook's whole-sheet texture, always go.
   * `options` reaches any children unchanged, and decides whether the textures you passed in go
   * too. The corner and index buffers it shares with other containers stay until the last
   * container using them is destroyed.
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

  /**
   * Does nothing, so the base `destroy` leaves the geometry alone and `destroy` frees it itself
   *
   * The geometry draws from the corner and index buffers every container shares, and the base
   * cascade would destroy them with it under `geometry: true`. `destroy` calls
   * `geometry.destroy(false)` instead, which keeps them.
   */
  protected override _destroyGeometry(): void {}
}
