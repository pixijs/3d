import { Buffer, BufferUsage, Geometry, NOOP } from 'pixi.js';
import type { Attribute, Topology, TypedArray } from 'pixi.js';

import type { GeometryDataStoreBuffer } from '../core/buffers/GeometryDataStoreBuffer';
import type { MorphStoreBuffer } from '../core/buffers/MorphStoreBuffer';
import { Box } from '../math/shapes/Box';
import { Sphere } from '../math/shapes/Sphere';
import type { Mesh3D } from '../scene/Mesh3D';
import { UnstableList } from '../utils/UnstableList';
import type { GeometryAllocation } from './GeometryAtlas';
import {
  computeBoundsFromPositions,
  createIndexBuffer,
  interleaveData,
  resolveAttribute,
  resolveAttributeInput,
  vertexCountFromAttributes,
} from './utils/Geometry3DUtils';
import type { IntegerFormat } from './utils/Geometry3DUtils';

/**
 * Options for {@link Geometry3D}
 *
 * Each vertex attribute takes a typed array with its components packed vertex after vertex, or a
 * pixi `Attribute` whose `format` says how to read it, which is how quantized data comes in. An
 * `Attribute` is read by its format alone, not its `stride` or `offset`, so pack its data vertex
 * after vertex too, in a typed array with the format's bit width, such as an `Int16Array` for
 * `snorm16x4`. Pass an interleaved layout through `attributes`.
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
   *
   * Integer positions come in as an `Attribute`, since only its format says how to read them:
   * `snorm` as -1 to 1, `unorm` as 0 to 1, and `sint` or `uint` as the stored integers. An integer
   * typed array throws. Pad 8- and 16-bit xyz to four components per vertex, and pass `bounds3D`.
   * @example
   * ```ts
   * const triangle = new Geometry3D({ positions: new Float32Array([0, 1, 0, -1, -1, 0, 1, -1, 0]) });
   * ```
   */
  positions?: Float32Array | Attribute;
  /**
   * Texture coordinates, two floats per vertex
   *
   * Integer coordinates come in as an `Attribute`, read as integer positions are: `unorm16x2` as
   * 0 to 1, `uint16x2` as the stored integers, which the material's
   * {@link BaseMaterial3D#uvTransform} has to scale back down.
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
   * Left out, the vertices are drawn in order. A `Uint16Array` of odd length is copied into a
   * `Uint32Array`. A `Buffer` is used as it is, so several geometries can share one.
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
   * `0` draws the whole buffer. Only a `dynamic` geometry honours it; any other draws its whole
   * index buffer. Use it to draw a prefix of an index buffer several geometries share.
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
   * The geometry's local bounding box; computed from float `positions` when omitted
   *
   * Pass it when you already know the box, to skip scanning the positions. Integer positions throw
   * without it, and need it in the values their format reads as: within -1 to 1 for `snorm16x4`,
   * the stored integers for `sint16x4`.
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
   * A `Float32Array` is used as floats; an integer array is read as normalized, 0 to 1.
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, joints, weights: new Float32Array(vertexCount * 4) });
   * ```
   */
  weights?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * Vertex colours, four components per vertex (RGBA)
   *
   * A `Float32Array` is used as floats; an integer array is read as normalized, 0 to 1. Widen RGB
   * colours to RGBA with an opaque alpha first. {@link BaseMaterial3D#vertexColors} decides whether
   * they tint.
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
   * Materials never tint with it; only a custom shader bit that declares `aColor1` reads it, which
   * makes it the place for data that isn't really a colour, such as a wind mask.
   * @example
   * ```ts
   * const geometry = new Geometry3D({ positions, colors1: windMask });
   * ```
   */
  colors1?: Float32Array | Uint16Array | Uint8Array | Attribute;
  /**
   * Whether to pack the attributes into one interleaved buffer
   *
   * Only a `dynamic` geometry draws from its own buffers; for any other, this changes how its own
   * data is laid out, not how it draws. Per-triangle picking, a
   * {@link Container3D#hitVolume | hitVolume} of `'geometry'`, never hits an interleaved geometry.
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
   * They then take 8 bytes per vertex instead of 12, with negligible visual difference. Read them
   * back as floats with {@link getAttributeData}.
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
   * They then take 8 bytes per vertex instead of 16, with negligible visual difference. Read them
   * back as floats with {@link getAttributeData}.
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
   * With a map, the per-attribute options build nothing, so pass `bounds3D` too: a geometry with
   * empty bounds is never culled, and picking never hits it.
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
   * Draw the geometry from its own buffers, so later writes to them reach the screen
   *
   * Set it when you rewrite the vertices every frame, as a trail or a particle system does. A
   * dynamic geometry is never frustum-culled. Fixed at construction.
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
   * A {@link Mesh3D} drawing the geometry blends the targets by its {@link Mesh3D#weights}.
   * Normal offsets are used only when every target has them. A geometry morphs in one renderer
   * only: once a second renderer draws it, even a new `Application` made after the first is
   * destroyed, it draws unmorphed from then on and warns once.
   *
   * Culling allows for weights from 0 to 1. For weights outside that range, pass a larger
   * `bounds3D`.
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
 * {@link getAttributeData} reads any attribute back as floats, however it is stored.
 *
 * The first time a geometry is drawn it's copied into buffers shared with other geometries, so
 * later edits to its data don't show. Build a new geometry for a new shape, call
 * {@link Geometry3D#unload | unload} after an occasional edit, or make it
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
   * Defaults for every new `Geometry3D`
   *
   * Each primitive, such as {@link SphereGeometry}, copies these into its own `defaultOptions` when
   * its module loads, so changing one of them here later doesn't reach the primitives; set theirs
   * instead.
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

  /** Built on first read, so importing the module builds nothing */
  private static _empty: Geometry3D | null = null;

  /**
   * A shared geometry with no vertices, which a {@link Mesh3D} holds until it's given a geometry
   *
   * A mesh on it draws nothing and compiles no shader. Assign it to a mesh's `geometry` to stop the
   * mesh drawing; to hide a mesh for a while, `visible = false` is cheaper to toggle. Only `Mesh3D`
   * takes it: a {@link BatchedMesh3D} slot in a pass needs a real geometry.
   *
   * Its `destroy` does nothing, as with pixi's `Texture.EMPTY`, so destroying a mesh with
   * `geometry: true` can't free it from under other meshes.
   * @example
   * ```ts
   * if (mesh.geometry === Geometry3D.EMPTY) mesh.geometry = new SphereGeometry();
   * ```
   * @advanced
   */
  public static get EMPTY(): Geometry3D {
    return (Geometry3D._empty ??= (() => {
      const empty = new Geometry3D({ attributes: {} });
      empty.destroy = NOOP;
      return empty;
    })());
  }

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
   * Whether the geometry left an atlas range since it was last packed; draw commands may still read
   * that range, so a repack rebuilds them and a first pack doesn't
   * @internal
   */
  public _atlasVacated = false;

  /**
   * The meshes in a scene that draw this geometry; batch slots aren't listed
   * @internal
   */
  public readonly _meshes = new UnstableList<Mesh3D>('_geometryMeshIndex');

  /**
   * Row in the renderer's `GeometryDataStoreBuffer`; -1 until the store assigns one
   * @internal
   */
  public _geometryDataIndex = -1;

  /**
   * The `DrawCommandList.captureTick` of the build that last captured this geometry's buffers, so a
   * build captures them once
   * @internal
   */
  public _captureTick = -1;

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
   * Count of morph targets; a mesh drawing the geometry takes one weight per target
   * @example
   * ```ts
   * const weights = new Float32Array(geometry.morphTargetCount);
   * ```
   */
  public readonly morphTargetCount: number = 0;

  /**
   * Float offset of the packed morph offsets in the morph store; -1 while unpacked
   * @internal
   */
  public _morphDeltaBase = -1;

  /**
   * Float length of the packed block, kept because packing drops the raw targets
   * @internal
   */
  public _morphDeltaFloats = 0;

  /**
   * The morph store holding the packed block, so `destroy` can hand it back without a renderer
   * @internal
   */
  public _morphStore: MorphStoreBuffer | null = null;

  /**
   * Whether the morph targets bend the normals as well as the positions; see
   * {@link Geometry3DOptions#morphTargets}
   * @advanced
   */
  public readonly hasMorphNormals: boolean;

  /**
   * How far weights from 0 to 1 can move a vertex, which culling adds to the bounding sphere's radius
   * @internal
   */
  public _morphBoundsExpansion = 0;

  /**
   * The raw morph targets; `null` once packed into the morph store
   * @internal
   */
  public _morphTargets: { positions: Float32Array; normals?: Float32Array }[] | null = null;

  private _attributeKey: string | null = null;
  /**
   * Set before pixi's `destroy` runs `unload`, so this class's `unload` can't free buffers that
   * `destroy(false)` leaves to the geometries sharing them
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
        integerFormat?: IntegerFormat,
        quantize?: boolean,
      ) => {
        const r = resolveAttribute(input, name, size, integerFormat, quantize);
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

      addAttribute(positions, 'aPosition', 3);
      addAttribute(uvs, 'aUV', 2);
      addAttribute(normals, 'aNormal', 3, 'norm', options.quantizeNormals ?? true);
      addAttribute(tangents, 'aTangent', 4, 'norm', options.quantizeTangents ?? true);
      addAttribute(joints, 'aJoints', 4, 'int');
      addAttribute(weights, 'aWeights', 4, 'norm');
      addAttribute(colors, 'aColor', 4, 'norm');
      addAttribute(colors1, 'aColor1', 4, 'norm');
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
      const { data, format } = resolveAttributeInput(positions)!;
      if (format && !format.startsWith('float32')) {
        throw new Error(`[Geometry3D] ${format} positions need bounds3D: only float positions are scanned for it.`);
      }
      this.bounds3D = computeBoundsFromPositions(data);
    } else {
      this.bounds3D = new Box();
    }

    this.boundsSphere = new Sphere().setFromBox(this.bounds3D);
  }

  /**
   * Frees the geometry for good
   *
   * Its own buffers are destroyed only with `destroyBuffers`, since other geometries may share
   * them. Calling it again does nothing.
   * @param destroyBuffers - Whether to destroy the geometry's own buffers as well
   * @example
   * ```ts
   * view.root.removeChild(mesh);
   * mesh.geometry.destroy(true);
   * ```
   * @see {@link Geometry3D.unload} To hand back the GPU memory but keep the geometry usable.
   */
  public override destroy(destroyBuffers?: boolean): void {
    if (this._destroyed) return;

    this._geometryAtlasAllocation?.atlas.remove(this);

    this._geometryDataStore?.remove(this);
    this._geometryDataStore = null;
    this._morphStore?.freeDeltas(this);

    super.unload();
    // oxlint-disable-next-line pixijs-3d/destroy-release -- a mesh still using the destroyed geometry removes itself from this list when it detaches or swaps geometry, and clear() resets its index so that remove is a no-op
    this._meshes.clear();
    this._destroyed = true;

    super.destroy(destroyBuffers);
  }

  /**
   * Unloads this geometry from the GPU, keeping its CPU data so it can be rebuilt
   *
   * A {@link Geometry3DOptions#dynamic | dynamic} geometry frees its own GPU buffers; any other
   * leaves its place in the shared buffers, which never shrink, for later geometries. The next
   * render that draws it uploads it again, and the image comes out the same: a geometry out of the
   * scene comes back when its mesh does, one still drawn on the next frame. A
   * {@link BatchedMesh3D} slot that draws it also needs {@link BatchedMesh3D#invalidate | invalidate}.
   * Safe to call more than once, and does nothing after {@link Geometry3D.destroy}.
   * @example
   * ```ts
   * view.root.removeChild(mesh);
   * mesh.geometry.unload(); // adding the mesh again uploads it again
   * ```
   * @see {@link Geometry3D.destroy} To free the geometry for good.
   */
  public override unload(): void {
    if (this._destroyed) return;

    const allocation = this._geometryAtlasAllocation;
    allocation?.atlas.remove(this);

    const buffers = this.buffers;
    for (let i = 0; i < buffers.length; i++) buffers[i].unload();

    super.unload();

    if (allocation === null && !this.dynamic) return;

    const meshes = this._meshes.items;
    for (let i = 0; i < meshes.length; i++) meshes[i]._markBatchDirty();
  }

  /**
   * The position data as stored
   *
   * A `Float32Array`, unless the geometry was built from quantized positions; on an interleaved
   * geometry, the whole interleaved buffer as a `Uint8Array`. On a
   * {@link Geometry3DOptions#dynamic | dynamic} geometry that isn't interleaved, write through it
   * and update its buffer. To read positions as floats, three per vertex, use
   * {@link getAttributeData}.
   * @example
   * ```ts
   * const trail = new Geometry3D({ positions: new Float32Array(64 * 3), dynamic: true });
   *
   * trail.positions.set(points);
   * trail.attributes.aPosition.buffer.update();
   * ```
   */
  get positions(): TypedArray {
    return this.attributes.aPosition.buffer.data;
  }

  /**
   * Sets the position data
   * @param value - New data, covering at least as many vertices as before
   */
  set positions(value: TypedArray) {
    this.attributes.aPosition.buffer.data = value;
  }

  /**
   * The UV data as stored, or `undefined` when the geometry has no UVs
   *
   * Read them as floats, two per vertex, with {@link getAttributeData}.
   */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- raw stored data; getAttributeData has the read example
  get uvs(): TypedArray | undefined {
    return this.attributes.aUV?.buffer.data;
  }

  /**
   * Sets the UV data; ignored when the geometry has no UVs
   * @param value - New data, covering every vertex
   */
  set uvs(value: TypedArray) {
    if (!this.attributes.aUV) return;
    this.attributes.aUV.buffer.data = value;
  }

  /**
   * The normal data as stored, or `undefined` when the geometry has no normals
   *
   * With {@link Geometry3DOptions#quantizeNormals} (the default) it's an `Int16Array` with four
   * values per vertex; on an interleaved geometry, the whole interleaved buffer as a `Uint8Array`.
   * To read normals as floats, three per vertex, use {@link getAttributeData}.
   * @example
   * ```ts
   * const normals = getAttributeData(geometry, 'aNormal', 3);
   * const normal = new Vector3().fromArray(normals, vertexIndex * 3);
   * ```
   */
  get normals(): TypedArray | undefined {
    return this.attributes.aNormal?.buffer.data;
  }

  /**
   * Sets the normal data; ignored when the geometry has no normals
   * @param value - New data, in the format the normals are stored in
   */
  set normals(value: TypedArray) {
    if (!this.attributes.aNormal) return;
    this.attributes.aNormal.buffer.data = value;
  }

  /**
   * The tangent data as stored, or `undefined` when the geometry has no tangents
   *
   * With {@link Geometry3DOptions#quantizeTangents} (the default) it is an `Int16Array` with four
   * values per vertex. Read tangents as floats, four per vertex, with {@link getAttributeData}.
   */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- raw stored data; getAttributeData has the read example
  get tangents(): TypedArray | undefined {
    return this.attributes.aTangent?.buffer.data;
  }

  /**
   * Sets the tangent data; ignored when the geometry has no tangents
   * @param value - New data, in the format the tangents are stored in
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
   * Sets the index data
   * @param value - New indices, three per triangle for `triangle-list`
   */
  set indices(value: Uint32Array | Uint16Array) {
    this.indexBuffer.data = value;
  }
}
