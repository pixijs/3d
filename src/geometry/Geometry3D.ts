import { Buffer, BufferUsage, Geometry } from 'pixi.js';
import type { Attribute, Topology, TypedArray } from 'pixi.js';

import type { GeometryDataStoreBuffer } from '../core/buffers/GeometryDataStoreBuffer';
import type { MorphStoreBuffer } from '../core/buffers/MorphStoreBuffer';
import { Box } from '../math/shapes/Box';
import { Sphere } from '../math/shapes/Sphere';
import type { GeometryAllocation } from './GeometryAtlas';
import {
  computeBoundsFromPositions,
  createIndexBuffer,
  interleaveData,
  resolveAttribute,
  resolveAttributeInput,
  vertexCountFromAttributes,
} from './utils/Geometry3DUtils';

/**
 * Options for {@link Geometry3D}
 * @category geometry
 * @standard
 */
export interface Geometry3DOptions {
  /**
   * Mesh positions
   *
   * Pass a `Float32Array` for raw floats, or a Pixi `Attribute` (with explicit `format`) for
   * quantized/non-float data.
   */
  positions?: Float32Array | Attribute;
  /**
   * Mesh UVs
   *
   * Pass a `Float32Array` for raw floats, or a Pixi `Attribute` (with explicit `format`) for
   * quantized/non-float data.
   */
  uvs?: Float32Array | Attribute;
  /**
   * Mesh normals
   *
   * Pass a `Float32Array` for raw floats, or a Pixi `Attribute` (with explicit `format`) for
   * quantized/non-float data.
   */
  normals?: Float32Array | Attribute;
  /**
   * Mesh tangents
   *
   * Pass a `Float32Array` for raw floats, or a Pixi `Attribute` (with explicit `format`) for
   * quantized/non-float data.
   */
  tangents?: Float32Array | Attribute;
  /**
   * Mesh indices
   *
   * A `Uint16Array` is upgraded to `Uint32Array` when its byte length is not a multiple of 4
   * (WebGPU alignment). An existing `Buffer` is used as-is, so several geometries can share one.
   */
  indices?: Uint16Array | Uint32Array | Buffer;
  /**
   * How many indices to draw, when that is fewer than the index buffer holds
   *
   * `0` draws the whole buffer. Read at draw time only, so changing it never re-uploads anything;
   * see Pixi's `Geometry.indexCount`.
   * @default 0
   */
  indexCount?: number;
  /**
   * Primitive topology used when drawing the mesh
   * @default 'triangle-list'
   */
  topology?: Topology;
  /**
   * Whether the underlying GPU buffers may shrink to fit the data on resize
   * @default false
   */
  shrinkBuffersToFit?: boolean;
  /** The 3D bounding box of the geometry; computed from `positions` when omitted */
  bounds3D?: Box;
  /** Bone indices; an integer typed array (format inferred from array type) or explicit `Attribute` */
  joints?: Uint16Array | Uint8Array | Attribute;
  /** Bone weights; a `Float32Array` for raw floats, integer typed array (normalized), or explicit `Attribute` */
  weights?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * Per-vertex colors, always 4 components
   *
   * A `Float32Array` for raw floats, or an integer typed array (hardware-normalized
   * to [0, 1]). Three-component sources must be widened to RGBA before they get
   * here — the generic VEC3 padding leaves the fourth lane at zero, which is a
   * transparent alpha rather than an opaque one.
   *
   * The channels are handed through untouched; whether they tint is the
   * material's call, see {@link BaseMaterial3D#vertexColors}.
   */
  colors?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * A second set of per-vertex colors, always 4 components
   *
   * Exposed as `aColor1`. Nothing consumes it by default — unlike `colors`,
   * which auto-injects the vertex-color tint — so it is inert until a material
   * bit declares the attribute and reads it.
   */
  colors1?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * Whether to interleave the per-vertex attributes into a single buffer
   *
   * Improves cache locality at upload-time cost.
   * @default false
   */
  interleave?: boolean;
  /**
   * Whether to quantize normals to 16-bit signed integers (snorm16)
   *
   * Halves bandwidth versus raw floats with negligible visual impact.
   * @default true
   */
  quantizeNormals?: boolean;
  /**
   * Whether to quantize tangents to 16-bit signed integers (snorm16)
   *
   * Halves bandwidth versus raw floats with negligible visual impact.
   * @default true
   */
  quantizeTangents?: boolean;
  /**
   * Pre-built attribute map
   *
   * Use to supply your own buffers or interleaved layout; when set,
   * `positions`/`uvs`/`normals`/etc. are ignored.
   */
  attributes?: Record<string, Attribute>;
  /**
   * When `true`, this geometry is never merged into a `GeometryAtlas`
   *
   * The mesh draws directly from this geometry's own buffers — required for
   * streaming geometries where the consumer owns the buffers and mutates
   * them per frame (e.g. ribbon trails, dynamic particle systems).
   *
   * Defaults to `false`; the atlas is the right default for static geometry —
   * different `Geometry3D` instances that share an attribute layout merge into
   * one vertex/index buffer, so successive draws of distinct geometries don't
   * rebind buffer or bind-group state. Cuts state switching from the GPU
   * command stream and lays the foundation for future multi-draw indirect.
   * (Instanced batching of multiple meshes sharing the *same* `Geometry3D` +
   * material is independent of the atlas — the batcher already collapses
   * those into one instanced draw call regardless.)
   * Set to `true` only when you need direct buffer control.
   *
   * Construction-only — {@link Geometry3D#dynamic} is `readonly`. To change a
   * geometry's atlas behaviour, build a new geometry.
   * @example
   * ```ts
   * // A streaming ribbon whose vertex buffers are mutated per frame:
   * const geo = new Geometry3D({
   *   attributes: { aPosition: { buffer, format: 'float32x3', stride: 12, offset: 0 } },
   *   dynamic: true,
   * });
   * ```
   * @default false
   */
  dynamic?: boolean;
  /**
   * Morph-target (blend-shape) vertex deltas
   *
   * Each entry holds one target's per-vertex position deltas as a flat
   * `Float32Array` (3 floats per vertex, same vertex order as `positions`),
   * optionally paired with normal deltas of the same shape — supply normals on
   * every target or none (the packed delta layout is uniform per geometry).
   * Composes with `dynamic` and the `GeometryAtlas` freely: the shader
   * recovers the geometry-local vertex id via the geometry store's
   * `baseVertex`.
   *
   * Deforms on both backends: WebGPU reads the shared morph store as a
   * storage buffer, WebGL as a data texture.
   */
  morphTargets?: {
    /** Per-vertex position deltas — 3 floats per vertex, same vertex order as `positions` */
    positions: Float32Array;
    /** Optional per-vertex normal deltas, same shape as the position deltas */
    normals?: Float32Array;
  }[];
}

/**
 * A subclass of Pixi's `Geometry` that carries the 3D-specific attribute set
 * (`aPosition`, plus optional `aNormal`/`aUV`/`aTangent`/`aJoints`/`aWeights`/`aColor`/`aColor1`)
 * and supports both interleaved and non-interleaved layouts
 *
 * Only `aPosition` is required. A geometry without normals shades with a fixed object-space
 * `(0, 0, 1)` normal, which is what unlit billboards and ribbons want.
 *
 * Position, UV, normal and tangent inputs may be raw `Float32Array` data or
 * pre-built Pixi `Attribute`s, including the quantized integer formats
 * defined by KHR_mesh_quantization. Static geometries are merged into a
 * shared `GeometryAtlas` by default to cut buffer-rebind overhead;
 * set `dynamic: true` to opt out for streaming meshes whose buffers are
 * mutated per frame.
 * @example
 * ```ts
 * const geometry = new Geometry3D({
 *   positions: new Float32Array([
 *     -1, -1, 0,
 *      1, -1, 0,
 *      0,  1, 0,
 *   ]),
 *   indices: new Uint16Array([0, 1, 2]),
 * });
 * ```
 * @see {@link Geometry3DOptions} For the constructor options
 * @category geometry
 * @standard
 */
export class Geometry3D extends Geometry {
  /** Default options applied when constructing a `Geometry3D` */
  public static defaultOptions: Geometry3DOptions = {
    topology: 'triangle-list',
    shrinkBuffersToFit: false,
    interleave: false,
    quantizeNormals: true,
    quantizeTangents: true,
  };

  /** The 3D bounding box of the geometry */
  public bounds3D: Box;

  /**
   * The 3D bounding sphere of the geometry, derived once from {@link Geometry3D#bounds3D} at
   * construction (centre = box centre, radius = half the space diagonal)
   *
   * Read by frustum culling — the CPU cull ({@link Mesh3D#boundingSphere}) and the GPU cull's
   * per-geometry bounds store both source it, so they share one identical local sphere.
   */
  public boundsSphere: Sphere;

  /** Number of vertices in this geometry */
  get vertexCount(): number {
    return vertexCountFromAttributes(this.attributes);
  }

  /**
   * The atlas allocation for this geometry, if it belongs to a `GeometryAtlas`
   *
   * A geometry can only belong to one atlas at a time.
   * @internal
   */
  public _geometryAtlasAllocation: GeometryAllocation | null = null;

  /**
   * Slot in the per-renderer GeometryDataStoreBuffer (bounding sphere); -1 until minted
   * @internal
   */
  public _geometryDataIndex = -1;

  /**
   * The store that minted `_geometryDataIndex`, so `destroy` can release the
   * slot without renderer context (same ownership pattern as `Morph._store`)
   * @internal
   */
  public _geometryDataStore: GeometryDataStoreBuffer | null = null;

  /**
   * When `true`, this geometry is never merged into a `GeometryAtlas`
   *
   * The mesh draws directly from this geometry's own buffers — required for
   * streaming geometries where the consumer owns the buffers and mutates
   * them per frame (e.g. ribbon trails, dynamic particle systems).
   *
   * Set via the {@link Geometry3DOptions#dynamic} constructor option.
   * `readonly` after construction — to change atlas behaviour, build a
   * new geometry.
   */
  public readonly dynamic: boolean;

  /**
   * Number of morph targets on this geometry (0 when none)
   *
   * Read by the renderer to compose the morph shader bit and size the mesh's
   * weight slot in the shared morph store.
   */
  public readonly morphTargetCount: number;

  /**
   * Base float offset of this geometry's deltas in the shared `MorphStoreBuffer`'s delta arena
   *
   * `-1` until uploaded on first render.
   * @internal
   */
  public _morphDeltaBase = -1;

  /**
   * Float extent of the packed delta block, recorded at pack time (the raw
   * targets are released then), so `destroy` can return the block to the
   * arena's free list
   * @internal
   */
  public _morphDeltaFloats = 0;

  /**
   * The store holding this geometry's packed delta block (see `Morph._store`)
   * @internal
   */
  public _morphStore: MorphStoreBuffer | null = null;

  /**
   * Whether every morph target carries NORMAL deltas
   *
   * Selects the `|morphN` shader variant and the two-texel delta stride in the
   * shared morph store — the single fact the packer and the shader compose
   * both read.
   */
  public readonly hasMorphNormals: boolean;

  /**
   * Conservative bounds expansion for morphing: Σ over targets of the largest
   * position-delta length, computed while the deltas are packed
   *
   * Added to the bounds-sphere radius (geometry store row + the mesh's world
   * sphere) so a deformed surface can't escape its cull bounds for weights in
   * [0, 1] — the glTF default range; out-of-range weights need a user bounds
   * override.
   * @internal
   */
  public _morphBoundsExpansion = 0;

  /**
   * Raw morph-target deltas (positions, and normals when {@link Geometry3D#hasMorphNormals}),
   * retained until packed into the shared delta arena on first render, then released
   * @internal
   */
  public _morphTargets: { positions: Float32Array; normals?: Float32Array }[] | null = null;

  private _attributeKey: string | null = null;
  private _destroyed = false;

  /**
   * A key that identifies the attribute structure (names and formats) of this geometry
   *
   * Unlike layoutKey, this ignores strides, offsets, and buffer identities.
   * Geometries with the same attributeKey can be packed into the same GeometryAtlas.
   */
  get attributeKey(): string {
    if (this._attributeKey) return this._attributeKey;

    const attributes = this.attributes;
    const keys = Object.keys(attributes).sort();
    let key = '';

    for (let i = 0; i < keys.length; i++) {
      const name = keys[i];
      const attr = attributes[name];

      if (attr.instance) continue;

      // e.g. "aPosition:float32x3|aNormal:float32x3|aUV:float32x2|"
      key += `${name}:${attr.format}|`;
    }

    this._attributeKey = key;
    return key;
  }

  /**
   * Creates a new `Geometry3D`
   * @param options - See {@link Geometry3DOptions} for available options
   */
  constructor(options: Geometry3DOptions) {
    options = { ...Geometry3D.defaultOptions, ...options };
    const { positions, uvs, normals, tangents, joints, weights, colors, colors1 } = options;

    const shrinkToFit = options.shrinkBuffersToFit;

    let attributes: Record<string, Attribute> = {};

    if (options.attributes) {
      attributes = options.attributes;
    } else if (options.interleave) {
      attributes = interleaveData(options, shrinkToFit);
    } else {
      const addAttribute = (
        input: TypedArray | Attribute | undefined,
        name: string,
        size: number,
        normalized: boolean,
        quantize = false,
      ) => {
        const r = resolveAttribute(input, size, normalized, quantize);
        if (!r) return;

        const buffer = new Buffer({
          data: r.data,
          label: `attribute-mesh-${name.toLowerCase().substring(1)}`,
          shrinkToFit,
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        });

        attributes[name] = {
          buffer,
          format: r.format,
          stride: r.size * r.data.BYTES_PER_ELEMENT,
          offset: 0,
        };
      };

      // Non-float positions/UVs come from KHR_mesh_quantization and must be
      // hardware-normalized so the GPU produces f32 in [-1, 1] / [0, 1].
      addAttribute(positions, 'aPosition', 3, !!positions && !(positions instanceof Float32Array));
      addAttribute(uvs, 'aUV', 2, !!uvs && !(uvs instanceof Float32Array));
      addAttribute(normals, 'aNormal', 3, true, options.quantizeNormals ?? true);
      addAttribute(tangents, 'aTangent', 4, true, options.quantizeTangents ?? true);
      addAttribute(joints, 'aJoints', 4, false);
      addAttribute(weights, 'aWeights', 4, true);
      addAttribute(colors, 'aColor', 4, !!colors && !(colors instanceof Float32Array));
      addAttribute(colors1, 'aColor1', 4, !!colors1 && !(colors1 instanceof Float32Array));
    }

    super({
      attributes,
      // Every geometry is indexed — the batched draw path is index-based, so a
      // sequential [0..vertexCount) buffer is synthesized when none is supplied.
      indexBuffer:
        options.indices instanceof Buffer
          ? options.indices
          : createIndexBuffer(options.indices, attributes, shrinkToFit),
      indexCount: options.indexCount,
      topology: options.topology,
    });

    // Morph deltas index by a geometry-local vertex id; the morph bits recover
    // it from the atlas-global one by subtracting the geometry-store row's
    // baseVertex, so morphed geometry atlases (and culls) like any other.
    this._morphTargets = options.morphTargets ?? null;
    this.morphTargetCount = options.morphTargets?.length ?? 0;
    this.hasMorphNormals = this.morphTargetCount > 0 && options.morphTargets!.every((target) => !!target.normals);
    this.dynamic = options.dynamic ?? false;

    // Use provided bounds or compute from positions. The fallback reads raw
    // min/max so bounds live in the same space the vertex shader's `position`
    // output lives in (integer-space Q for quantized meshes, raw world units
    // for float meshes). The glTF loader still supplies accessor.min/max
    // explicitly; this fallback is for programmatically-constructed geometries.
    if (options.bounds3D) {
      this.bounds3D = options.bounds3D;
    } else if (positions) {
      const posData = resolveAttributeInput(positions)?.data;
      this.bounds3D = posData ? computeBoundsFromPositions(posData) : new Box();
    } else {
      this.bounds3D = new Box();
    }

    this.boundsSphere = new Sphere().setFromBox(this.bounds3D);
  }

  /**
   * Removes this geometry from its atlas (if any) and then destroys the underlying Pixi geometry
   *
   * Idempotent: a second call is a no-op. pixi's `Geometry.destroy` is not idempotent (it nulls
   * `buffers` then re-iterates it on a second call), so this guard makes shared geometry safe to
   * tear down through multiple owners (several {@link Mesh3D} / {@link BatchedMesh3D} slots, or a
   * repeated user `destroy`).
   * @param destroyBuffers - Whether to destroy the underlying GPU buffers as well
   */
  public override destroy(destroyBuffers?: boolean): void {
    if (this._destroyed) return;

    this._geometryAtlasAllocation?.atlas.remove(this);

    // Release the per-renderer store rows this geometry occupies — nothing else
    // frees them: slots live inside one always-resident store buffer that GC can
    // never reclaim piecemeal, so churned geometries would otherwise grow both
    // stores for the renderer's lifetime.
    this._geometryDataStore?.remove(this);
    this._geometryDataStore = null;
    this._morphStore?.freeDeltas(this);

    // Release the recorded GPU layout with the base unload only: `destroyBuffers = false` must
    // leave buffers other geometries may share loaded, so the full `unload()` override must not
    // run here. The flag below turns the `unload()` call pixi's own destroy makes into a no-op.
    super.unload();
    this._destroyed = true;

    super.destroy(destroyBuffers);
  }

  /**
   * Give this geometry's GPU memory back now, keeping everything needed to rebuild it
   *
   * Vacates the range it holds in a `GeometryAtlas`, frees the GPU copies of its own vertex /
   * index buffers, and drops the GPU layout (WebGL VAO) recorded for it. The CPU-side attribute
   * data is untouched.
   *
   * The vacated range is dead space until the atlas's own compaction reclaims it: unload never
   * repacks, so unloading a run of geometries can't thrash the shared buffer. Nothing rebuilds on
   * the unload itself either. The next frame that walks a mesh drawing this geometry re-packs it
   * and re-records that mesh's draw commands — pixel-identically, at whatever offset the atlas
   * hands out then — so a geometry that is out of the scene comes back when its mesh does, and one
   * that is still drawn is back in the atlas a frame later.
   *
   * Idempotent, and a no-op after {@link Geometry3D.destroy}.
   * @example
   * ```ts
   * view.root.removeChild(mesh);
   * mesh.geometry.unload(); // hand the GPU memory back; adding the mesh again rebuilds it
   * ```
   * @see {@link Mesh3D.unload} For the mesh-level entry point.
   * @see {@link Geometry3D.destroy} For permanent teardown.
   */
  public override unload(): void {
    if (this._destroyed) return;

    this._geometryAtlasAllocation?.atlas.remove(this);

    // Self-owned buffers only. An atlased geometry's data lives in the atlas's shared buffers,
    // which stay — they hold every other geometry packed alongside it.
    const buffers = this.buffers;
    for (let i = 0; i < buffers.length; i++) buffers[i].unload();

    super.unload();
  }

  /**
   * The positions of the mesh
   *
   * Typed as `TypedArray` because KHR_mesh_quantization meshes store positions
   * as Int8/Uint8/Int16/Uint16; use the `Float32Array` branch of the union for
   * vanilla float meshes.
   */
  get positions(): TypedArray {
    return this.attributes.aPosition.buffer.data as TypedArray;
  }

  /**
   * Replaces the position buffer data
   *
   * The replacement must be at least as long as the original positions array,
   * otherwise the geometry will not be valid.
   * @param value - New position data, at least as long as the original
   */
  set positions(value: TypedArray) {
    this.attributes.aPosition.buffer.data = value;
  }

  /** The UVs of the mesh, or `undefined` when no UV attribute is present */
  get uvs(): TypedArray | undefined {
    return this.attributes.aUV?.buffer.data as TypedArray | undefined;
  }

  /**
   * Replaces the UV buffer data
   *
   * The replacement must be at least as long as the positions array, otherwise
   * the geometry will not be valid.
   * @param value - New UV data; ignored when the geometry has no UV attribute
   */
  set uvs(value: TypedArray) {
    if (!this.attributes.aUV) return;
    this.attributes.aUV.buffer.data = value;
  }

  /** The normals of the mesh, or `undefined` when no normal attribute is present */
  get normals(): TypedArray | undefined {
    return this.attributes.aNormal?.buffer.data as TypedArray | undefined;
  }

  /**
   * Replaces the normal buffer data
   * @param value - New normal data; ignored when the geometry has no normal attribute
   */
  set normals(value: TypedArray) {
    if (!this.attributes.aNormal) return;
    this.attributes.aNormal.buffer.data = value;
  }

  /** The tangents of the mesh, or `undefined` when no tangent attribute is present */
  get tangents(): TypedArray | undefined {
    return this.attributes.aTangent?.buffer.data as TypedArray | undefined;
  }

  /**
   * Replaces the tangent buffer data
   * @param value - New tangent data; ignored when the geometry has no tangent attribute
   */
  set tangents(value: TypedArray) {
    if (!this.attributes.aTangent) return;
    this.attributes.aTangent.buffer.data = value;
  }

  /** The indices of the mesh */
  get indices(): Uint32Array | Uint16Array {
    return this.indexBuffer.data as Uint32Array | Uint16Array;
  }

  /**
   * Replaces the index buffer data
   * @param value - New vertex indices, three per triangle for `triangle-list`
   */
  set indices(value: Uint32Array | Uint16Array) {
    this.indexBuffer.data = value;
  }
}
