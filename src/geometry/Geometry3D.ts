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
 *
 * Each vertex attribute takes a typed array with its components packed vertex after vertex, or a
 * pixi `Attribute` whose `format` says how to read its buffer. An `Attribute` is how quantized
 * data comes in, and it is used as given.
 * @example
 * ```ts
 * const options: Geometry3DOptions = { positions, normals, uvs, indices };
 * const geometry = new Geometry3D(options);
 * ```
 * @category geometry
 * @standard
 */
export interface Geometry3DOptions {
  /**
   * Vertex positions, three floats per vertex
   * @example
   * ```ts
   * const triangle = new Geometry3D({ positions: new Float32Array([0, 1, 0, -1, -1, 0, 1, -1, 0]) });
   * ```
   */
  positions?: Float32Array | Attribute;
  /**
   * Texture coordinates, two floats per vertex
   * @example
   * ```ts
   * const quad = new Geometry3D({ positions, uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) });
   * ```
   */
  uvs?: Float32Array | Attribute;
  /**
   * Vertex normals, three floats per vertex
   *
   * Without them the geometry shades as if every normal were `(0, 0, 1)`, which suits unlit
   * billboards and ribbons. `quantizeNormals` decides how they are stored.
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, normals });
   * ```
   */
  normals?: Float32Array | Attribute;
  /**
   * Vertex tangents, four floats per vertex: the tangent direction, then `1` or `-1` for which way
   * the bitangent points
   *
   * Normal maps use them when present and otherwise derive a tangent frame per pixel.
   * `quantizeTangents` decides how they are stored.
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, normals, uvs, tangents });
   * ```
   */
  tangents?: Float32Array | Attribute;
  /**
   * Vertex indices, three per triangle for the default `triangle-list` topology
   *
   * Left out, the vertices are drawn in order. A `Uint16Array` whose byte length isn't a multiple
   * of 4 is copied into a `Uint32Array`, which WebGPU needs. A `Buffer` is used as it is, so
   * several geometries can share one.
   * @example
   * ```ts
   * const quad = new Geometry3D({
   *   positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
   *   indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
   * });
   * ```
   */
  indices?: Uint16Array | Uint32Array | Buffer;
  /**
   * How many indices to draw, when that is fewer than the index buffer holds
   *
   * `0` draws the whole buffer. Only a `dynamic` geometry honours it: every other geometry is
   * copied into the shared buffers with its whole index buffer, and draws all of it. Use it to draw
   * a prefix of an index buffer several geometries share.
   * @default 0
   * @example
   * ```ts
   * const firstTen = new Geometry3D({ positions, indices: sharedQuadIndices, indexCount: 10 * 6, dynamic: true });
   * ```
   */
  indexCount?: number;
  /**
   * Primitive topology used when drawing the mesh
   * @default 'triangle-list'
   * @example
   * ```ts
   * const wireframe = new Geometry3D({ positions, indices: edgeIndices, topology: 'line-list' });
   * ```
   */
  topology?: Topology;
  /**
   * Whether the geometry's own GPU buffers may shrink to fit their data when it gets smaller
   * @default false
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, shrinkBuffersToFit: true });
   * ```
   */
  shrinkBuffersToFit?: boolean;
  /**
   * The geometry's local bounding box; computed from `positions` when omitted
   *
   * Pass it when you already know the box, to skip scanning the positions.
   * @example
   * ```ts
   * const geometry = new Geometry3D({
   *   positions,
   *   bounds3D: new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
   * });
   * ```
   */
  bounds3D?: Box;
  /**
   * Four bone indices per vertex, for skinning
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, joints: new Uint8Array(vertexCount * 4), weights });
   * ```
   */
  joints?: Uint16Array | Uint8Array | Attribute;
  /**
   * Four bone weights per vertex, matching `joints`
   *
   * A `Float32Array` is used as floats; an integer array is read as fractions from 0 to 1.
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, joints, weights: new Float32Array(vertexCount * 4) });
   * ```
   */
  weights?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * Vertex colours, four components per vertex (RGBA)
   *
   * A `Float32Array` is used as floats; an integer array is read as fractions from 0 to 1.
   * Three-component colours must be widened to RGBA with an opaque alpha first, because the data
   * is read four components per vertex. Whether the colours tint is the material's call; see
   * {@link BaseMaterial3D#vertexColors}.
   * @example
   * ```ts
   * const red = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
   * const geometry = new Geometry3D({ positions, colors: red });
   * ```
   */
  colors?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * A second set of vertex colours, read as `aColor1`, with the same rules as `colors`
   *
   * Materials never tint with it. It does nothing until a shader bit declares `aColor1` and reads
   * it, which makes it the place for data that isn't really a colour, such as a wind mask.
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, colors1: windMask });
   * ```
   */
  colors1?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * Whether to pack the attributes into one interleaved buffer
   *
   * Only a `dynamic` geometry draws from its own buffers. Every other geometry is copied into a
   * shared, interleaved buffer anyway, so for it this only changes the layout of its own copy.
   * @default false
   * @example
   * ```ts
   * const trail = new Geometry3D({ positions, colors, interleave: true, dynamic: true });
   * ```
   */
  interleave?: boolean;
  /**
   * Whether to store `Float32Array` normals as 16-bit signed integers
   *
   * They then take 8 bytes per vertex instead of 12, with negligible visual difference. An
   * `Attribute` is used as given either way.
   * @default true
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, normals, quantizeNormals: false });
   * ```
   */
  quantizeNormals?: boolean;
  /**
   * Whether to store `Float32Array` tangents as 16-bit signed integers
   *
   * They then take 8 bytes per vertex instead of 16, with negligible visual difference. An
   * `Attribute` is used as given either way.
   * @default true
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, normals, tangents, quantizeTangents: false });
   * ```
   */
  quantizeTangents?: boolean;
  /**
   * A prebuilt attribute map, keyed by shader attribute name
   *
   * Use it to supply your own buffers or interleaved layout. The names the other options fill are
   * `aPosition`, `aUV`, `aNormal`, `aTangent`, `aJoints`, `aWeights`, `aColor` and `aColor1`.
   *
   * With a map, the per-attribute options build nothing and no bounds are computed, so pass
   * `bounds3D` as well: a geometry with empty bounds is never culled, and picking, which tests the
   * bounds first, never hits it.
   * @example
   * ```ts
   * const geometry = new Geometry3D({
   *   attributes: { aPosition: { buffer, format: 'float32x3', stride: 12, offset: 0 } },
   *   bounds3D: new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
   * });
   * ```
   */
  attributes?: Record<string, Attribute>;
  /**
   * Keep the geometry out of the shared buffers and draw it from its own
   *
   * By default, geometries with the same attributes are copied into shared buffers the first
   * time they are drawn, so drawing different geometries doesn't switch buffers. That copy is
   * made once: later writes to a geometry's own buffers don't reach the screen. Set `dynamic` when
   * you rewrite the vertices every frame, as a trail or a particle system does.
   *
   * A dynamic geometry is never frustum-culled, because its vertices can move outside any bounds.
   * Fixed at construction; build a new geometry to change it.
   * @default false
   * @example
   * ```ts
   * const trail = new Geometry3D({ positions: new Float32Array(64 * 3), dynamic: true });
   *
   * app.ticker.add(() => {
   *   writeTrailPoints(trail.positions);
   *   trail.attributes.aPosition.buffer.update();
   * });
   * ```
   */
  dynamic?: boolean;
  /**
   * Morph targets (blend shapes), each a set of per-vertex offsets from `positions`
   *
   * A target holds three floats per vertex, in the same vertex order as `positions`, and can carry
   * normal offsets of the same shape. Normal offsets are used only when every target has them. A
   * {@link Mesh3D} drawing the geometry blends the targets by its {@link Mesh3D#weights}.
   *
   * The culling bounds grow to cover weights from 0 to 1. Weights outside that range can move
   * vertices past them, so pass a larger `bounds3D` if you use such weights.
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, morphTargets: [{ positions: smileOffsets }] });
   * const face = new Mesh3D({ geometry, material, weights: new Float32Array([0.5]) });
   * ```
   */
  morphTargets?: {
    /**
     * Offsets from the base positions, three floats per vertex
     * @example
     * ```ts
     * const raise = new Float32Array(vertexCount * 3);
     * for (let i = 1; i < raise.length; i += 3) raise[i] = 0.5;
     * const geometry = new Geometry3D({ positions, morphTargets: [{ positions: raise }] });
     * ```
     */
    positions: Float32Array;
    /**
     * Offsets from the base normals, three floats per vertex
     * @example
     * ```ts
     * const geometry = new Geometry3D({
     *   positions,
     *   normals,
     *   morphTargets: [{ positions: bulgeOffsets, normals: bulgeNormalOffsets }],
     * });
     * ```
     */
    normals?: Float32Array;
  }[];
}

/**
 * A mesh's vertex and index data: positions plus optional normals, UVs, tangents, colours and
 * skinning data, in separate buffers or interleaved in one
 *
 * Only positions are required. Inputs can be raw `Float32Array` data or pixi `Attribute`s,
 * including the quantized integer formats glTF files use (KHR_mesh_quantization).
 *
 * The first time a geometry is drawn it is copied into buffers shared with other geometries, so
 * later edits to its data don't show. Build a new geometry for a new shape, or make it
 * {@link Geometry3DOptions#dynamic} if you rewrite it every frame.
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
  /**
   * Defaults applied when constructing a `Geometry3D`
   *
   * Each primitive, such as {@link SphereGeometry}, copies these into its own `defaultOptions` when
   * its module loads, so a later change here reaches only plain `Geometry3D`s.
   * @example
   * ```ts
   * Geometry3D.defaultOptions.quantizeNormals = false;
   * ```
   */
  public static defaultOptions: Geometry3DOptions = {
    topology: 'triangle-list',
    shrinkBuffersToFit: false,
    interleave: false,
    quantizeNormals: true,
    quantizeTangents: true,
  };

  /**
   * The geometry's local bounding box, used for picking and for a mesh's local bounds
   *
   * Culling tests {@link Geometry3D#boundsSphere} instead.
   * @example
   * ```ts
   * const size = geometry.bounds3D.getSize();
   * ```
   */
  public bounds3D: Box;

  /**
   * The sphere around {@link Geometry3D#bounds3D}, which frustum culling tests
   *
   * Computed once, at construction, so later edits to the positions or to `bounds3D` don't reach
   * culling.
   * @example
   * ```ts
   * const radius = geometry.boundsSphere.radius;
   * ```
   */
  public boundsSphere: Sphere;

  /**
   * Number of vertices
   * @example
   * ```ts
   * const colors = new Float32Array(geometry.vertexCount * 4);
   * ```
   */
  get vertexCount(): number {
    return vertexCountFromAttributes(this.attributes);
  }

  /**
   * Where the geometry sits in a `GeometryAtlas`; `null` while it isn't packed
   * @internal
   */
  public _geometryAtlasAllocation: GeometryAllocation | null = null;

  /**
   * Row in the renderer's `GeometryDataStoreBuffer`; -1 until the store assigns one
   * @internal
   */
  public _geometryDataIndex = -1;

  /**
   * The store that assigned `_geometryDataIndex`, so `destroy` can free the row without a renderer
   * @internal
   */
  public _geometryDataStore: GeometryDataStoreBuffer | null = null;

  /**
   * Whether the geometry stays out of the shared buffers; see {@link Geometry3DOptions#dynamic}
   * @advanced
   */
  public readonly dynamic: boolean;

  /**
   * Number of morph targets; `0` when there are none
   *
   * A mesh drawing the geometry takes one weight per target.
   * @example
   * ```ts
   * const weights = new Float32Array(geometry.morphTargetCount);
   * ```
   */
  public readonly morphTargetCount: number = 0;

  /**
   * Float offset of this geometry's packed offsets in the morph store; `-1` until the first render
   * packs them
   * @internal
   */
  public _morphDeltaBase = -1;

  /**
   * Float length of the packed block, recorded at packing because the raw targets are released
   * then, so `destroy` can hand the block back
   * @internal
   */
  public _morphDeltaFloats = 0;

  /**
   * The morph store holding the packed block, so `destroy` can hand it back without a renderer
   * @internal
   */
  public _morphStore: MorphStoreBuffer | null = null;

  /**
   * Whether every morph target carries normal offsets
   *
   * Only then do the targets bend the normals as well as the positions.
   * @advanced
   */
  public readonly hasMorphNormals: boolean;

  /**
   * How far morphing can move a vertex: the sum over targets of each target's largest position
   * offset, computed at packing
   *
   * Culling adds it to the bounding sphere's radius, which covers weights from 0 to 1.
   * @internal
   */
  public _morphBoundsExpansion = 0;

  /**
   * The raw morph targets, kept until the first render packs them into the morph store
   * @internal
   */
  public _morphTargets: { positions: Float32Array; normals?: Float32Array }[] | null = null;

  private _attributeKey: string | null = null;
  /**
   * Whether `destroy` has run
   *
   * `destroy` sets it before calling pixi's `destroy`, which calls `unload()`, so that call does
   * nothing: this class's `unload` would free the geometry's own buffers, which `destroy(false)`
   * must leave loaded for the geometries that share them. `destroy` drops the GPU layout through
   * pixi's base `unload` instead.
   */
  private _destroyed = false;

  /**
   * The attribute names and formats, ignoring strides, offsets and buffers
   *
   * Geometries with the same key are packed into the same shared buffers. A geometry with
   * positions, normals and UVs has the key `aNormal:snorm16x4|aPosition:float32x3|aUV:float32x2|`.
   * @advanced
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
      indexBuffer:
        options.indices instanceof Buffer
          ? options.indices
          : createIndexBuffer(options.indices, attributes, shrinkToFit),
      indexCount: options.indexCount,
      topology: options.topology,
    });

    this._morphTargets = options.morphTargets ?? null;
    this.morphTargetCount = options.morphTargets?.length ?? 0;
    this.hasMorphNormals = this.morphTargetCount > 0 && options.morphTargets!.every((target) => !!target.normals);
    this.dynamic = options.dynamic ?? false;

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
   * Frees the geometry for good: its place in the shared buffers, the renderer data kept for it,
   * and its GPU layout
   *
   * Its own buffers are destroyed only with `destroyBuffers`, since other geometries may share
   * them. Calling it again does nothing, so every owner of a shared geometry can call it.
   * @param destroyBuffers - Whether to destroy the geometry's own buffers as well
   * @example
   * ```ts
   * view.root.removeChild(mesh);
   * mesh.geometry.destroy(true);
   * ```
   * @see {@link Geometry3D.unload} To free the GPU memory but keep the geometry usable.
   */
  public override destroy(destroyBuffers?: boolean): void {
    if (this._destroyed) return;

    this._geometryAtlasAllocation?.atlas.remove(this);

    this._geometryDataStore?.remove(this);
    this._geometryDataStore = null;
    this._morphStore?.freeDeltas(this);

    super.unload();
    this._destroyed = true;

    super.destroy(destroyBuffers);
  }

  /**
   * Give this geometry's GPU memory back now, keeping everything needed to rebuild it
   *
   * Leaves its place in the shared buffers, frees the GPU copies of its own vertex and index
   * buffers, and drops the GPU layout (WebGL VAO) recorded for it. The CPU-side attribute data is
   * untouched.
   *
   * The space it leaves stays unused until the shared buffers next compact, so unloading a run of
   * geometries never repacks them. Nothing rebuilds on the unload itself either. The next frame
   * that draws a mesh using this geometry packs it again, wherever there is room, and re-records
   * that mesh's draws; the image comes out the same. So a geometry that is out of the scene comes
   * back when its mesh does, and one that is still drawn is back a frame later.
   *
   * Safe to call more than once, and does nothing after {@link Geometry3D.destroy}.
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

    const buffers = this.buffers;
    for (let i = 0; i < buffers.length; i++) buffers[i].unload();

    super.unload();
  }

  /**
   * The position data
   *
   * A `Float32Array`, unless the geometry was built from quantized positions. For an interleaved
   * geometry it is the whole shared buffer, every attribute included.
   * @example
   * ```ts
   * const positions = geometry.positions as Float32Array;
   * const firstVertexY = positions[1];
   * ```
   */
  get positions(): TypedArray {
    return this.attributes.aPosition.buffer.data as TypedArray;
  }

  /**
   * Replaces the position data, which must cover at least as many vertices as before
   * @param value - New position data, at least as long as the original
   */
  set positions(value: TypedArray) {
    this.attributes.aPosition.buffer.data = value;
  }

  /** The UV data, or `undefined` when the geometry has no UVs */
  // oxlint-disable-next-line pixi3d/require-standard-example -- raw stored data; see the positions example
  get uvs(): TypedArray | undefined {
    return this.attributes.aUV?.buffer.data as TypedArray | undefined;
  }

  /**
   * Replaces the UV data, which must cover at least as many vertices as the positions
   * @param value - New UV data; ignored when the geometry has no UV attribute
   */
  set uvs(value: TypedArray) {
    if (!this.attributes.aUV) return;
    this.attributes.aUV.buffer.data = value;
  }

  /**
   * The normal data, or `undefined` when the geometry has no normals
   *
   * As stored, so with {@link Geometry3DOptions#quantizeNormals} (the default) it is an
   * `Int16Array` with four values per vertex, `32767` standing for `1`.
   * @example
   * ```ts
   * const normals = geometry.normals as Int16Array;
   * const firstNormalX = normals[0] / 32767;
   * ```
   */
  get normals(): TypedArray | undefined {
    return this.attributes.aNormal?.buffer.data as TypedArray | undefined;
  }

  /**
   * Replaces the normal data, which has to be in the format the normals are stored in
   * @param value - New normal data; ignored when the geometry has no normal attribute
   */
  set normals(value: TypedArray) {
    if (!this.attributes.aNormal) return;
    this.attributes.aNormal.buffer.data = value;
  }

  /**
   * The tangent data, or `undefined` when the geometry has no tangents
   *
   * As stored, so with {@link Geometry3DOptions#quantizeTangents} (the default) it is an
   * `Int16Array`, `32767` standing for `1`.
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- raw stored data; see the positions example
  get tangents(): TypedArray | undefined {
    return this.attributes.aTangent?.buffer.data as TypedArray | undefined;
  }

  /**
   * Replaces the tangent data, which has to be in the format the tangents are stored in
   * @param value - New tangent data; ignored when the geometry has no tangent attribute
   */
  set tangents(value: TypedArray) {
    if (!this.attributes.aTangent) return;
    this.attributes.aTangent.buffer.data = value;
  }

  /**
   * The index data
   * @example
   * ```ts
   * const triangleCount = geometry.indices.length / 3;
   * ```
   */
  get indices(): Uint32Array | Uint16Array {
    return this.indexBuffer.data as Uint32Array | Uint16Array;
  }

  /**
   * Replaces the index data
   * @param value - New vertex indices, three per triangle for `triangle-list`
   */
  set indices(value: Uint32Array | Uint16Array) {
    this.indexBuffer.data = value;
  }
}
