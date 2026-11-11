import { definedProps } from 'pixi.js';

import type { BatchInstanceData } from '../core/batcher/BatchInstanceData';
import type { BatchMatrices } from '../core/batcher/BatchMatrices';
import type { InstanceDataOptions } from '../core/batcher/instanceDataLayout';
import { Mesh3DBatch } from '../core/batcher/Mesh3DBatch';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
import type { Matrix4 } from '../math/matrix/Matrix4';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import { Container3D } from './Container3D';
import type { Container3DOptions } from './Container3D';
import type { BillboardMode } from './Mesh3D';
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
 * @category scene
 * @standard
 */
export interface BatchedMesh3DOptions extends Omit<Container3DOptions, 'width' | 'height' | 'depth'> {
  /**
   * Number of slots, fixed for the batch's lifetime; required
   *
   * Every slot takes memory whether it draws or not, so size it to the most you'll draw at once.
   * @example
   * ```ts
   * const forest = new BatchedMesh3D({ size: treePositions.length });
   * ```
   */
  size: number;
  /**
   * Frustum-culling mode for this batch; see {@link BatchedMesh3D#cull | cull}
   * @default 'off'
   * @example
   * ```ts
   * const forest = new BatchedMesh3D({ size: treePositions.length, cull: 'gpu' });
   * ```
   */
  cull?: CullMode;
  /**
   * Fields every slot carries besides its matrix, for shader bits to read as `instance.<name>`
   *
   * Use it for values that differ per slot and change often, where a material per slot would not
   * do: a tint, a fade, the parameters a vertex bit shapes the slot with. Each field is a `vec4`,
   * in the `{ value, type }` shape of a pixi `UniformGroup` entry, and `value` is what every slot
   * starts with. Names are letters, digits and single underscores, starting with a letter. The
   * fields are fixed for the batch's lifetime.
   *
   * A bit declares the fields it reads in `bindings.instance` and reads them in either stage:
   *
   * ```ts
   * const tintBit: ShaderBit = {
   *   name: 'tint',
   *   bindings: { instance: { tint: 'vec4<f32>' } },
   *   gpu: { fragment: { material: 'albedo *= instance.tint.rgb;' } },
   *   gl: { fragment: { material: 'albedo *= instance.tint.rgb;' } },
   * };
   * ```
   *
   * Changing a value uploads only the instance data, not the matrices. Each field read in fragment
   * code takes a varying, so keep those few. Shadows don't run material bits, so a bit that moves
   * vertices from instance data doesn't move the slot's shadow.
   * @example
   * ```ts
   * const boxes = new BatchedMesh3D({
   *   size: 1000,
   *   instanceData: { tint: { value: [1, 1, 1, 1], type: 'vec4<f32>' } },
   * });
   *
   * boxes.setInstanceDataAt(0, 'tint', 1, 0.2, 0.2, 1);
   * ```
   * @see {@link BatchedMesh3D.instanceData} For writing many slots a frame.
   * @advanced
   */
  instanceData?: InstanceDataOptions;
}

/**
 * The settings of one {@link BatchedMesh3D} slot that aren't set through the batch's `set*At`
 * methods, reached through {@link BatchedMesh3D#items | items}
 *
 * A change shows once you call {@link BatchedMesh3D#invalidate | invalidate} for the slot.
 * @example
 * ```ts
 * const slot: BatchedMesh3DSlot = batched.items[0];
 *
 * slot.receiveShadow = false;
 * batched.invalidate(0);
 * ```
 * @category scene
 * @standard
 */
export interface BatchedMesh3DSlot {
  /**
   * How the slot turns to face the camera; see {@link Mesh3D#billboardMode}
   * @default 'none'
   * @example
   * ```ts
   * grass.items[i].billboardMode = 'cylindrical';
   * grass.invalidate(i);
   * ```
   */
  billboardMode: BillboardMode;
  /**
   * Whether the slot is shadowed by lights that cast shadows; see {@link Mesh3D#receiveShadow}
   * @default true
   * @example
   * ```ts
   * water.items[i].receiveShadow = false;
   * water.invalidate(i);
   * ```
   */
  receiveShadow: boolean;
}

/**
 * A scene node that draws many meshes as slots of one batch, with no scene node per mesh
 *
 * Reach for it for crowds, foliage, debris and other large counts. Each slot is a geometry, a
 * material and a matrix, and updating a slot costs a few array writes. Moving the `BatchedMesh3D`
 * moves every slot at no extra cost.
 *
 * The slot count is fixed at construction. Fill slots with
 * {@link BatchedMesh3D#setGeometryAt | setGeometryAt},
 * {@link BatchedMesh3D#setMaterialAt | setMaterialAt} and
 * {@link BatchedMesh3D#setMatrixAt | setMatrixAt}, then put each one in its passes with
 * {@link BatchedMesh3D#setPassesAt | setPassesAt}. A slot needs a geometry and a material only
 * while it's in a pass, so spare slots can stay empty. To spawn and despawn, show and hide slots
 * with {@link BatchedMesh3D#setVisibleAt | setVisibleAt}.
 *
 * Unlike a {@link Mesh3D}, a slot doesn't notice when its material's shader changes; see
 * {@link BatchedMesh3D#invalidate | invalidate}. For per-slot values a shader reads, such as a
 * tint, see {@link BatchedMesh3DOptions#instanceData | instanceData}.
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
 *   batched.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
 * }
 *
 * view.root.addChild(batched);
 *
 * // Moving one slot is a matrix write, cheap enough for every frame.
 * batched.setMatrixAt(0, nextMatrix);
 *
 * // Hide a slot to despawn it; show it again to respawn.
 * batched.setVisibleAt(1, false);
 * ```
 * @see {@link BatchedMesh3DOptions} For the constructor options.
 * @category scene
 * @standard
 */
export class BatchedMesh3D extends Container3D {
  /**
   * The view registers it, so it's built before `parent` attaches and freed after the node leaves its view
   * @internal
   */
  public readonly batch: Mesh3DBatch;

  /**
   * Creates a new `BatchedMesh3D`; add it under {@link View3D.root | view.root} to draw it
   * @example
   * ```ts
   * const batched = new BatchedMesh3D({ size: 1000 });
   * view.root.addChild(batched);
   * ```
   * @param options - Construction options; see {@link BatchedMesh3DOptions}.
   */
  constructor(options: BatchedMesh3DOptions) {
    const { size, parent, cull, instanceData, ...rest } = definedProps(options);

    super({ label: 'BatchedMesh3D', ...rest });

    this.batch = new Mesh3DBatch({ size, renderData: this, instanceData });
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
  public get items(): readonly BatchedMesh3DSlot[] {
    return this.batch.items;
  }

  /**
   * Frustum-culling mode for this batch, which ignores the view's own `cull`
   *
   * Off by default, since a batch usually sits mostly in view. Turn it on for a large batch spread
   * well beyond the view, such as scattered scenery. Once on, it tests every slot each frame, and
   * again for each shadow map that redraws, even with the whole batch in view; where the test runs
   * on the CPU, as under WebGL2, that cost grows with the slot count. A change takes effect on the
   * next render.
   * @example
   * ```ts
   * // ten thousand trees across the map, most of them off screen: test each one
   * forest.cull = 'gpu';
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
   * It copies the matrix and allocates nothing, so it's fine for every slot every frame. The matrix
   * must be affine, with a bottom row of `0, 0, 0, 1`. To skip the copy when rewriting many slots a
   * frame, write into {@link BatchedMesh3D#matrices | matrices}.
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
   * The slot matrices as interleaved data, for rewriting many slots a frame without a copy each
   *
   * {@link BatchMatrices} has the layout and the rules:
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
   * @advanced
   */
  public get matrices(): BatchMatrices {
    return this.batch.matrices;
  }

  /**
   * Writes one instance-data field of the item at `index`
   *
   * Allocates nothing, and the next render uploads it. Throws when the batch declares no field of
   * that name.
   * @example
   * ```ts
   * boxes.setInstanceDataAt(i, 'tint', 1, 0.2, 0.2, 1);
   * ```
   * @param index - The slot index within this batch
   * @param name - The field, as declared in the `instanceData` option
   * @param x - The field's first number
   * @param y - The field's second number
   * @param z - The field's third number
   * @param w - The field's fourth number
   * @see {@link BatchedMesh3D.instanceData} For rewriting many slots a frame.
   * @advanced
   */
  public setInstanceDataAt(index: number, name: string, x: number, y: number, z: number, w: number): void {
    this.batch.setInstanceDataAt(index, name, x, y, z, w);
  }

  /**
   * The slots' instance data as interleaved data, for rewriting many slots a frame
   *
   * {@link BatchInstanceData} has the layout and the rules:
   *
   * ```ts
   * const { data, stride, offset, fields } = boxes.instanceData;
   *
   * for (let i = 0, o = offset + fields.tint; i < boxes.size; i++, o += stride) {
   *   data[o + 3] = fade[i];
   * }
   *
   * boxes.instanceData.update();
   * ```
   *
   * Throws when the batch was built without the `instanceData` option.
   * @advanced
   */
  public get instanceData(): BatchInstanceData {
    return this.batch.instanceData;
  }

  /**
   * Sets a slot's geometry; the slot rebuilds its shader on the next frame
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
   * The slot stays in the passes {@link BatchedMesh3D#setPassesAt | setPassesAt} gave it, so
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
   * Shows or hides a slot, the way {@link Container3D#visible} does for a mesh
   *
   * A hidden slot keeps its geometry, material, matrix and passes, and draws nothing, shadows
   * included. Every slot starts visible. A flip rebuilds nothing, which makes this the way to spawn
   * and despawn: size the batch for the most slots you'll use and hide the spare ones. With `cull`
   * off, the next frame after a flip filters the whole batch, at a cost set by the batch's size, not
   * the number of flips.
   *
   * Blended slots are the exception: the `TRANSPARENT` pass sorts hidden slots too, every frame.
   * Take a blended slot that stays spare for a while out of the pass with
   * {@link BatchedMesh3D#setPassesAt | setPassesAt}, which costs one rebuild, and keep hiding one
   * that flips often.
   * @example
   * ```ts
   * bullets.setVisibleAt(i, false); // despawn
   * bullets.setVisibleAt(j, true); // spawn
   * ```
   * @param index - The slot index within this batch
   * @param visible - Whether the slot draws
   */
  public setVisibleAt(index: number, visible: boolean): void {
    this.batch.setVisibleAt(index, visible);
  }

  /**
   * Whether a slot is shown, as {@link BatchedMesh3D#setVisibleAt | setVisibleAt} left it
   *
   * A slot in no pass can still read `true`.
   * @example
   * ```ts
   * for (let i = 0; i < bullets.size; i++) {
   *   if (bullets.getVisibleAt(i)) continue;
   *   bullets.setMatrixAt(i, muzzleMatrix);
   *   bullets.setVisibleAt(i, true);
   *   break;
   * }
   * ```
   * @param index - The slot index within this batch
   * @returns `false` while the slot is hidden
   */
  public getVisibleAt(index: number): boolean {
    return this.batch.getVisibleAt(index);
  }

  /**
   * Sets which passes draw a slot; `0` takes it out of every pass
   *
   * Pass a bitwise OR of {@link RenderPassBit} flags. A slot doesn't pick its passes from its
   * material the way a {@link Mesh3D} does, so match them yourself: `OPAQUE` for an opaque or
   * `'mask'` material, `TRANSPARENT` for a `'blend'` one, `TRANSMISSION` in place of `OPAQUE` for
   * a {@link Material3D} with `transmission`, plus `SHADOW` to cast shadows. No flag joins a custom
   * {@link MeshPass}, such as an outline.
   *
   * A change costs some work on the next frame in each pass it touches, and a slot that joins a
   * pass rebuilds its shader. To hide and show slots, use
   * {@link BatchedMesh3D#setVisibleAt | setVisibleAt}, which rebuilds nothing.
   * @example
   * ```ts
   * batched.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
   * batched.setPassesAt(j, 0);
   * ```
   * @param index - The slot index within this batch
   * @param passMask - Bitmask of `RenderPassBit` flags for this slot
   */
  public setPassesAt(index: number, passMask: number): void {
    this.batch.setPassesAt(index, passMask);
  }

  /**
   * Makes a slot rebuild its shader and draw state on the next frame
   *
   * Swapping a slot's geometry or material does this for you. A change to the shader or render
   * state of a material slots already use doesn't, such as a texture swap, a new `alphaMode` or a
   * `state` field ({@link BaseMaterial3D} lists them), so call this for each of those slots
   * afterwards, after changing a slot's `billboardMode` or `receiveShadow`, and after
   * {@link Geometry3D.unload | unloading} a slot's geometry to apply an edit. A slot's passes
   * don't follow its material, so when `alphaMode` switches to or from `'blend'`, also move the
   * slot with {@link BatchedMesh3D#setPassesAt | setPassesAt}: `RenderPassBit.TRANSPARENT` to
   * blend, `RenderPassBit.OPAQUE` to stop. Values such as
   * `baseColor`, and the view-wide `toneMapping`, `fog`, `environment` and `shadowFilter`, reach
   * every slot on their own.
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
   * Frees this batch's GPU memory and unloads its slots' geometries with
   * {@link Geometry3D.unload}; the next render rebuilds them and draws the same image
   *
   * Slot materials are left alone, as {@link Mesh3D.unload} leaves them; call
   * {@link BaseMaterial3D.unload} to free their textures. A batch taken out of the scene keeps its
   * GPU memory until this is called or it's destroyed, so adding it back before then is cheap.
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
