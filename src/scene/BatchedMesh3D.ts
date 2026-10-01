import { definedProps } from 'pixi.js';

import type { BatchMatrices } from '../core/batcher/BatchMatrices';
import { Mesh3DBatch } from '../core/batcher/Mesh3DBatch';
import type { Mesh3DData } from '../core/batcher/Mesh3DData';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
import type { Matrix4 } from '../math/matrix/Matrix4';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import { Container3D } from './Container3D';
import type { Container3DOptions } from './Container3D';
import type { CullMode } from './View3D';

/**
 * Constructor options for {@link BatchedMesh3D}
 *
 * The {@link Container3DOptions} apply too, except `width`, `height` and `depth`: the slots aren't
 * children, so the node has no bounds to size against. `label` defaults to `'BatchedMesh3D'`.
 * @example
 * ```ts
 * const batched = new BatchedMesh3D({ size: 1000, label: 'crowd', parent: view.root });
 * ```
 * @see {@link BatchedMesh3D} For the constructed scene node and runtime API.
 * @category scene
 * @standard
 */
export interface BatchedMesh3DOptions extends Omit<Container3DOptions, 'width' | 'height' | 'depth'> {
  /**
   * Number of slots, fixed for the batch's lifetime; required
   *
   * Every slot holds a row in the batch's buffers whether it draws or not, so size it to the most
   * you'll draw at once.
   * @example
   * ```ts
   * const forest = new BatchedMesh3D({ size: treePositions.length });
   * ```
   */
  size: number;
  /**
   * Frustum-culling mode for this batch's instances, set per batch rather than taken from the view
   *
   * Off by default: a batch's instances usually move every frame and sit mostly in view, where
   * testing each one costs more than drawing the few off screen. Turn it on (`'auto'`, `'cpu'`
   * or `'gpu'`) for a large batch spread well beyond the view, such as scattered scenery.
   * @default 'off'
   * @example
   * ```ts
   * const forest = new BatchedMesh3D({ size: treePositions.length, cull: 'auto' });
   * ```
   * @see {@link BatchedMesh3D.cull} For changing it later.
   * @see {@link CullMode} For the modes.
   */
  cull?: CullMode;
}

/**
 * A scene node that draws many meshes as slots of one batch, with no scene node per mesh
 *
 * Reach for it for crowds, foliage, debris and other large counts. Each slot is a geometry, a
 * material and a matrix, written straight into the batch's buffers, so updating a slot costs a
 * few array writes. The node's own world matrix is applied on the GPU, so moving the
 * `BatchedMesh3D` moves every slot at no extra cost.
 *
 * The slot count is fixed at construction. Fill slots with
 * {@link BatchedMesh3D#setGeometryAt | setGeometryAt},
 * {@link BatchedMesh3D#setMaterialAt | setMaterialAt} and
 * {@link BatchedMesh3D#setMatrixAt | setMatrixAt}, then turn each one on with
 * {@link BatchedMesh3D#setItemActive | setItemActive}. Give every slot a geometry and a material
 * before the batch first renders, including slots you leave off.
 *
 * Unlike a {@link Mesh3D}, a slot doesn't notice when its material changes; see
 * {@link BatchedMesh3D#invalidate | invalidate}.
 * @example
 * ```ts
 * import { BatchedMesh3D, RenderPassBit } from '@pixi/3d';
 *
 * const batched = new BatchedMesh3D({ size: 1000 });
 *
 * for (let i = 0; i < 1000; i++) {
 *   batched.setGeometryAt(i, cubeGeometry);
 *   batched.setMaterialAt(i, material);
 *   batched.setMatrixAt(i, matrix);
 *   batched.setItemActive(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
 * }
 *
 * view.root.addChild(batched);
 *
 * // Moving one slot is a matrix write, cheap enough for every frame.
 * batched.setMatrixAt(0, nextMatrix);
 * ```
 * @see {@link BatchedMesh3DOptions} For the constructor options.
 * @see {@link Container3D} For the scene-graph base class.
 * @see {@link View3D} For the scene root that hosts the batch.
 * @category scene
 * @standard
 */
export class BatchedMesh3D extends Container3D {
  /**
   * The engine's batch behind this node, which owns its buffers and draw lists
   * @internal
   */
  public readonly batch: Mesh3DBatch;

  /**
   * Creates a new `BatchedMesh3D`; add it under {@link View3D.root | view.root} to draw it
   *
   * A `parent` option is applied last, once the batch exists, since attaching to a view registers
   * the batch with it.
   * @example
   * ```ts
   * const batched = new BatchedMesh3D({ size: 1000 });
   * view.root.addChild(batched);
   * ```
   * @param options - Construction options; see {@link BatchedMesh3DOptions}.
   */
  constructor(options: BatchedMesh3DOptions) {
    const { size, parent, cull, ...rest } = definedProps(options);

    super({ label: 'BatchedMesh3D', ...rest });

    this.batch = new Mesh3DBatch({ size, renderData: this });
    this.batch.cull = cull ?? 'off';
    parent?.addChild(this);
  }

  /**
   * The slots, one per index
   *
   * Set a slot's geometry, material and matrix through the `set*At` methods. A slot's
   * `billboardMode` and `receiveShadow` are set here, followed by
   * {@link BatchedMesh3D#invalidate | invalidate}.
   * @example
   * ```ts
   * batched.items[0].billboardMode = 'spherical';
   * batched.invalidate(0);
   * ```
   */
  public get items(): readonly Mesh3DData[] {
    return this.batch.items;
  }

  /**
   * Frustum-culling mode for this batch's instances, set per batch rather than taken from the view
   *
   * Off by default. Takes effect on the next render.
   * @example
   * ```ts
   * // ten thousand trees across the map, most of them off screen: test each one
   * forest.cull = 'auto';
   * ```
   * @see {@link CullMode} For the modes.
   */
  public get cull(): CullMode {
    return this.batch.cull;
  }

  /**
   * Sets this batch's frustum-culling mode
   * @param value - The culling mode.
   */
  public set cull(value: CullMode) {
    this.batch.cull = value;
  }

  /**
   * Number of slots, fixed at construction
   * @example
   * ```ts
   * for (let i = 0; i < batched.size; i++) batched.setMatrixAt(i, matrices[i]);
   * ```
   */
  public get size(): number {
    return this.batch.items.length;
  }

  /**
   * Sets a slot's matrix, relative to this node
   *
   * It's copied straight into the batch's buffer and allocates nothing, so it's fine to call for
   * every slot every frame. The matrix must be affine, with a bottom row of `0, 0, 0, 1`; the batch
   * doesn't keep a projective one. To rewrite many slots a frame without the copy, write into
   * {@link BatchedMesh3D#matrices | matrices}.
   * @example
   * ```ts
   * batched.setMatrixAt(i, matrix.makeTranslation(x, 0, z));
   * ```
   * @param index - The slot index within this batch
   * @param matrix - The slot's matrix
   */
  public setMatrixAt(index: number, matrix: Matrix4): void {
    this.batch.setMatrixAt(index, matrix);
  }

  /**
   * The slot matrices as interleaved data, for rewriting many slots a frame
   *
   * Compute transforms straight into the batch's own data without copying them. See
   * {@link BatchMatrices} for the rules:
   *
   * ```ts
   * const { data, stride, offset } = batched.matrices;
   *
   * for (let i = 0, o = offset; i < batched.size; i++, o += stride) {
   *   data[o + 13] = heights[i]; // translation Y
   * }
   *
   * batched.matrices.update();
   * ```
   *
   * The first read creates the object. Later reads return the same object.
   * @advanced
   */
  public get matrices(): BatchMatrices {
    return this.batch.matrices;
  }

  /**
   * Sets a slot's geometry; the slot rebuilds its shader on the next frame, for the new vertex layout
   * @example
   * ```ts
   * forest.setGeometryAt(i, i % 3 === 0 ? pineGeometry : oakGeometry);
   * ```
   * @param index - The slot index within this batch
   * @param geometry - The slot's geometry
   */
  public setGeometryAt(index: number, geometry: Geometry3D): void {
    this.batch.setGeometryAt(index, geometry);
  }

  /**
   * Sets a slot's material; the slot rebuilds its shader on the next frame
   *
   * The slot stays in the passes {@link BatchedMesh3D#setItemActive | setItemActive} gave it, so
   * move it there when the new material blends and the old one didn't, or the other way round.
   * @example
   * ```ts
   * crowd.setMaterialAt(i, team === 'red' ? redShirt : blueShirt);
   * ```
   * @param index - The slot index within this batch
   * @param material - The slot's material
   */
  public setMaterialAt(index: number, material: BaseMaterial3D): void {
    this.batch.setMaterialAt(index, material);
  }

  /**
   * Sets which passes draw a slot; `0` turns it off
   *
   * Pass a bitwise OR of {@link RenderPassBit} flags. A slot doesn't pick its passes from its
   * material the way a {@link Mesh3D} does, so match them yourself: `OPAQUE` for an opaque or
   * `'mask'` material, `TRANSPARENT` for a `'blend'` one, plus `SHADOW` to cast shadows.
   *
   * Each change rebuilds the draw lists of the passes it touches on the next frame, so avoid
   * switching slots on and off every frame.
   * @example
   * ```ts
   * batched.setItemActive(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
   * batched.setItemActive(j, 0);
   * ```
   * @param index - The slot index within this batch
   * @param passMask - Bitmask of `RenderPassBit` flags for this slot
   */
  public setItemActive(index: number, passMask: number): void {
    this.batch.setItemActive(index, passMask);
  }

  /**
   * Makes a slot rebuild its shader and draw state on the next frame
   *
   * A batch only revisits the slots it's told about, which is what keeps it cheap. Swapping a
   * slot's geometry or material tells it. Changing a material that slots already use doesn't, so
   * call this for each of those slots afterwards; {@link BaseMaterial3D} lists the changes that
   * need it. A slot's `billboardMode` or `receiveShadow` needs it too. The view-wide
   * `toneMapping`, `fog`, `environment` and `shadowFilter` reach every slot on their own.
   *
   * A {@link Mesh3D} needs none of this: the view checks every mesh each frame.
   * @example
   * ```ts
   * leafMaterial.textures.baseColor = autumnLeaves;
   * for (const i of leafSlots) trees.invalidate(i);
   * ```
   * @param index - The slot index within this batch
   */
  public invalidate(index: number): void {
    this.batch.invalidate(index);
  }

  /**
   * Frees this batch's GPU memory, keeping what it needs to rebuild
   *
   * That's the GPU buffers of every slot's geometry, each geometry once, plus the batch's own
   * buffers and recorded draws, which also stop holding the slot textures back from pixi's texture
   * garbage collection. Every slot is invalidated, since its recorded draw points at where its
   * geometry sat in the shared geometry buffer. The next render uploads and records it all again
   * and draws the same image.
   *
   * Slot materials are shared, so they're left alone, as {@link Mesh3D.unload} does. A batch taken
   * out of the scene keeps its GPU memory until this is called or it's destroyed, which makes
   * adding it back before then cheap.
   * @example
   * ```ts
   * view.root.removeChild(crowd);
   * crowd.unload(); // hand back the crowd's GPU memory until it is shown again
   * ```
   * @see {@link BatchedMesh3D.destroy} For permanent teardown.
   */
  public override unload(): void {
    if (this.destroyed) return;

    super.unload();

    const seenGeometry = new Set<Geometry3D>();
    const items = this.batch.items;
    for (let i = 0; i < items.length; i++) {
      const geometry = items[i].geometry;
      if (!geometry) continue;
      if (!seenGeometry.has(geometry)) {
        seenGeometry.add(geometry);
        geometry.unload();
      }
      this.batch.invalidate(i);
    }

    this.batch.unload();
  }

  /**
   * Destroys this node and its batch
   *
   * The batch is always destroyed. Slot geometries and materials are often shared, so they stay
   * unless you pass `geometry` or `material`; each is destroyed once, however many slots use it.
   * `texture` then frees the destroyed materials' textures, and `textureSource` their sources.
   *
   * The base `destroy` runs first, so the view lets go of the batch before it's freed.
   * @example
   * ```ts
   * crowd.destroy({ geometry: true, material: true });
   * ```
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    super.destroy(options);

    const destroyGeometry = resolveDestroy3DFlag(options, 'geometry');
    const destroyMaterial = resolveDestroy3DFlag(options, 'material');

    if (destroyGeometry || destroyMaterial) {
      const seenGeometry = new Set<Geometry3D>();
      const seenMaterial = new Set<BaseMaterial3D>();

      for (const item of this.batch.items) {
        if (destroyGeometry && item.geometry && !seenGeometry.has(item.geometry)) {
          seenGeometry.add(item.geometry);
          item.geometry.destroy(true);
        }
        if (destroyMaterial && item.material && !seenMaterial.has(item.material)) {
          seenMaterial.add(item.material);
          item.material.destroy(options);
        }
      }
    }

    this.batch.destroy();
  }
}
