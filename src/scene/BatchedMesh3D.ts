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

/**
 * Constructor options for {@link BatchedMesh3D}
 *
 * Only `size` is required; the slot count is fixed for the lifetime of the batch and cannot be
 * resized after construction. Every {@link Container3DOptions} member (label, position, parent,
 * ...) is accepted too, except `width`, `height` and `depth`: the slots are not children, so the
 * node has no local bounds to size against. `label` defaults to `'BatchedMesh3D'`.
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
   * Number of mesh slots to pre-allocate
   *
   * Required — no default. The slot count is fixed at construction; pick a number that covers
   * the maximum concurrent slot count you'll need.
   */
  size: number;
}

/**
 * `BatchedMesh3D` is a user-facing batched mesh container
 *
 * A single scene node that draws up to `size` instances through one internal batch, cutting
 * per-mesh transform and submission overhead to a handful of O(1) buffer writes per item.
 *
 * It extends {@link Container3D} so it participates in the scene graph
 * (transform hierarchy, `addChild` / `removeChild`) while internally
 * delegating rendering to a `Mesh3DBatch`. The container's world
 * matrix is uploaded to store-buffer slot 0 and applied in the vertex
 * shader, so moving the container is free — no per-item matrix re-upload.
 *
 * The slot count is fixed at construction. Populate slots with
 * {@link BatchedMesh3D.setGeometryAt | setGeometryAt} /
 * {@link BatchedMesh3D.setMaterialAt | setMaterialAt} /
 * {@link BatchedMesh3D.setMatrixAt | setMatrixAt}, then enable rendering with
 * {@link BatchedMesh3D.setItemActive | setItemActive}.
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
 * // Animate slot 0 — a free per-frame uniform-style write:
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
   * The internal `Mesh3DBatch` that owns the store buffer, ID buffers, and per-pass draw lists
   *
   * Exposed for advanced use (custom render passes, direct slot inspection); prefer the
   * wrapper methods on this class for routine updates.
   */
  public readonly batch: Mesh3DBatch;

  /**
   * Creates a new `BatchedMesh3D`
   *
   * Add the returned instance to a {@link View3D}'s scene graph (typically
   * `view.root.addChild(batched)`) to render it.
   * @example
   * ```ts
   * const batched = new BatchedMesh3D({ size: 1000 });
   * view.root.addChild(batched);
   * ```
   * @param options - Construction options; see {@link BatchedMesh3DOptions}.
   */
  constructor(options: BatchedMesh3DOptions) {
    // `parent` waits until the batch exists: attaching to a live View registers `batch`.
    const { size, parent, ...rest } = definedProps(options);

    super({ label: 'BatchedMesh3D', ...rest });

    this.batch = new Mesh3DBatch({ size, renderData: this });
    parent?.addChild(this);
  }

  /**
   * The pre-allocated mesh items managed by the internal batch
   *
   * Read-only — the slot count is fixed at construction; mutate slots through the
   * `set*At` methods rather than the items array directly.
   */
  public get items(): readonly Mesh3DData[] {
    return this.batch.items;
  }

  /** Number of slots in this batched mesh; fixed at construction */
  public get size(): number {
    return this.batch.items.length;
  }

  /**
   * Writes a local world matrix for the item at `index`
   *
   * O(1), zero GC — the 16 floats are written directly into the store buffer. The container's
   * own world matrix is multiplied in by the vertex shader, so moving the parent remains free.
   * @param index - The slot index within this batch
   * @param matrix - The local matrix to apply to the slot
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
   * Swaps the geometry for a slot
   *
   * Triggers a draw-command rebuild on the next frame so the shader is recompiled against the
   * new vertex layout.
   * @param index - The slot index within this batch
   * @param geometry - The new geometry for the slot
   */
  public setGeometryAt(index: number, geometry: Geometry3D): void {
    this.batch.setGeometryAt(index, geometry);
  }

  /**
   * Swaps the material for a slot
   *
   * Triggers a draw-command rebuild on the next frame so the slot's pass assignment and shader
   * are refreshed.
   * @param index - The slot index within this batch
   * @param material - The new material for the slot
   */
  public setMaterialAt(index: number, material: BaseMaterial3D): void {
    this.batch.setMaterialAt(index, material);
  }

  /**
   * Adds or removes a slot from render-pass views
   *
   * Pass `0` to disable a slot entirely; pass a bitwise-OR of `RenderPassBit` values to include
   * it in those passes.
   * @param index - The slot index within this batch
   * @param passMask - Bitmask of `RenderPassBit` flags for this slot
   */
  public setItemActive(index: number, passMask: number): void {
    this.batch.setItemActive(index, passMask);
  }

  /**
   * Flushes a slot's cached pipeline state, forcing its shader, render state and batch
   * assignment to rebuild on the next frame
   *
   * Needed because batch slots are updated from a dirty list rather than a per-frame
   * scan — that's what makes them cheap, but it also means the batch only learns about
   * changes you announce. Swapping a slot's geometry or material announces itself
   * ({@link BatchedMesh3D.setGeometryAt | setGeometryAt} /
   * {@link BatchedMesh3D.setMaterialAt | setMaterialAt}); **mutating a material object
   * that slots already hold does not**. Call this after doing that, once per affected
   * slot:
   *
   * ```ts
   * material.alphaMode = 'blend';               // no slot knows about this
   * for (const i of slotsUsingMaterial) batched.invalidate(i);
   * ```
   *
   * Plain {@link Mesh3D} needs none of this — the scene loop already walks every mesh
   * each frame and picks material changes up on its own. View-wide settings
   * (`toneMapping`, `fog`, `environment`, `shadowFilter`) also propagate to batch slots
   * automatically. This is only for per-material mutation.
   * @param index - The slot index within this batch
   */
  public invalidate(index: number): void {
    this.batch.invalidate(index);
  }

  /**
   * Give back this batch's GPU memory — the geometry buffers and atlas ranges behind every
   * slot, the store buffer's GPU copy, and the recorded draw programs together with the
   * captures they took on the slot textures (which return to pixi's normal collection rules).
   * Each distinct geometry is unloaded once, and the slots are marked dirty so the next render
   * re-packs and re-records them, rendering identically.
   *
   * Slot materials are shared and left alone, matching {@link Mesh3D.unload}. A batch taken out
   * of the scene keeps its build, and the GPU memory behind it, until this is called or it is
   * destroyed; adding it back before then is a replay, not a rebuild.
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
      // The slot's recorded draw args bake the atlas range just vacated; this is what re-packs
      // the geometry and re-keys the slot on the next frame.
      this.batch.invalidate(i);
    }

    this.batch.unload();
  }

  /**
   * Tears down this batched mesh
   *
   * {@link Container3D.destroy | super.destroy} runs first so the {@link View3D} detaches the
   * node and splices the batch out of its mesh batches.
   *
   * The internal {@link BatchedMesh3D.batch | batch} is exclusively owned and fully GPU-backed, so
   * it is always destroyed regardless of flags. Per-slot geometry and material are shared by default
   * and left intact; pass `geometry` / `material` to destroy them (each unique resource once, since
   * slots may reference the same geometry or material). `texture` then frees the destroyed
   * materials' textures, and `textureSource` their sources.
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
