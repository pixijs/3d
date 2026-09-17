import { assignWithIgnore, DEG_TO_RAD, EventEmitter } from 'pixi.js';

import { Matrix4 } from '../math/matrix/Matrix4';
import { ObservableQuaternion } from '../math/rotation/ObservableQuaternion';
import { Quaternion } from '../math/rotation/Quaternion';
import type { QuaternionData } from '../math/rotation/Quaternion';
import { Box } from '../math/shapes/Box';
import { EulerDegrees } from '../math/vector/EulerDegrees';
import { ObservableVector3 } from '../math/vector/ObservableVector3';
import type { PointData3D } from '../math/vector/PointData3D';
import type { PointLike3D } from '../math/vector/PointLike3D';
import { Vector3 } from '../math/vector/Vector3';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import { getLocalBounds3D } from './utils/getLocalBounds3D';
import { updateTransformBackwards3D } from './utils/updateTransformBackwards3D';
import type { View3D } from './View3D';

declare global {
  namespace PixiMixins {
    /**
     * Augmentation hook for members mixed into {@link Container3D}
     *
     * Declare the added members here and merge their implementation onto the class with
     * pixi.js's `extensions.mixin(Container3D, myMixin)` — the same pattern the
     * 2D `Container` uses for its mixins (events, effects, sorting, …).
     */
    interface Container3D {}
    /**
     * Augmentation hook for {@link Container3DOptions}. The events module merges its
     * {@link Federated3DOptions} in here, mirroring how pixi.js's mixins extend `ContainerOptions`.
     */
    interface Container3DOptions {}
    /** Augmentation hook for extra {@link Container3DEvents} event signatures */
    interface Container3DEvents {}
  }
}

let UID = 0;

// lookAt scratch — module-level so calls don't allocate.
const _lookAtParentWorld = new Matrix4();
const _lookAtPos = new Vector3();
const _lookAtMatrix = new Matrix4();
const _lookAtWorldQuat = new Quaternion();
const _lookAtParentQuat = new Quaternion();
const _lookAtDefaultUp: PointData3D = { x: 0, y: 1, z: 0 };

// Origin offset scratch — each call consumes it before the next write.
const _originOffset = new Vector3();

// toGlobal / toLocal scratch — module-level so per-call conversions don't allocate.
const _convertMatrix = new Matrix4();
const _convertVec = new Vector3();
const _convertFromVec = new Vector3();

// reparentChildAt scratch — module-level so calls don't allocate.
const _reparentChildWorld = new Matrix4();
const _reparentParentWorld = new Matrix4();
const _reparentPos = new Vector3();
const _reparentScale = new Vector3();
const _reparentQuat = new Quaternion();

// width / height / depth / getSize / setSize scratch — module-level so measuring doesn't allocate.
const _measureBox = new Box();

/**
 * Scale on one axis that gives `size`, keeping the axis's sign; a zero extent keeps a unit scale
 * @param size - Target size along the axis
 * @param localSize - Local bounds extent along the axis
 * @param currentScale - Current scale on the axis, for its sign
 * @returns The new scale for the axis
 */
function scaleForSize(size: number, localSize: number, currentScale: number): number {
  const sign = Math.sign(currentScale) || 1;

  return localSize !== 0 ? (size / localSize) * sign : sign;
}

/**
 * Whether `value` equals `label`, or matches it when it's a pattern
 *
 * An unlabelled node never matches, so a pattern can't sweep up every node that was left unnamed.
 * @param value - The label being tested, `null` on an unlabelled node
 * @param label - Exact label or pattern
 * @returns Whether it matches
 */
function labelMatches(value: string | null, label: string | RegExp): boolean {
  if (value === null) return false;

  return value === label || (label instanceof RegExp && label.test(value));
}

/**
 * Width, height and depth of a {@link Container3D}, as returned by {@link Container3D.getSize}
 * @category scene
 * @standard
 */
export interface Size3D {
  /** Extent along x */
  width: number;
  /** Extent along y */
  height: number;
  /** Extent along z */
  depth: number;
}

/**
 * Events emitted by a {@link Container3D} as children are added and removed
 *
 * Listen with `container.on('childAdded', ...)` and friends — payloads mirror pixi.js's 2D
 * `Container` events, so the same listener shapes work in both dimensions.
 * @see {@link Container3D.addChild} For the methods that emit these events.
 * @category scene
 * @standard
 */
export interface Container3DEvents extends PixiMixins.Container3DEvents {
  /** Emitted on a child once it has been added to a parent; passes the new parent */
  added: [container: Container3D];
  /** Emitted on a child once it has been removed from a parent; passes the former parent */
  removed: [container: Container3D];
  /** Emitted on a parent once a child is added; passes the child, this parent and the child's index */
  childAdded: [child: Container3D, container: Container3D, index: number];
  /** Emitted on a parent once a child is removed; passes the child, this parent and the removed index */
  childRemoved: [child: Container3D, container: Container3D, index: number];
  /** Emitted once {@link Container3D.destroy} has emptied and detached this container; passes the container */
  destroyed: [container: Container3D];
  /** Emitted when {@link Container3D.visible} changes value; passes the new value */
  visibleChanged: [visible: boolean];
}

/**
 * Constructor options for {@link Container3D}, the 3D counterpart of pixi.js's `ContainerOptions`
 *
 * Every member is optional. Keys are applied in the order they're written, through the same setters
 * as assigning them afterwards, so later keys win: `{ position, x }` ends with `x`, and of
 * `rotation` / `quaternion` the last one written is the rotation used. `children` are added after
 * that, then `hitVolume` resolves and `width` / `height` / `depth` measure the finished subtree, and
 * `parent` adds this node to its parent last.
 *
 * The events module mixes in the interaction surface through `PixiMixins.Container3DOptions`
 * (`eventMode`, `interactive`, `interactiveChildren`, `cursor`, `hitVolume`, the `on*` handlers).
 * Constructor-set event state is safe before the node is attached: registration is derived when the
 * node joins a {@link View3D}'s scene graph.
 * @example
 * ```ts
 * const arm = new Container3D({
 *   label: 'arm',
 *   position: { x: 0, y: 1, z: 0 },
 *   rotation: { x: 0, y: Math.PI / 2, z: 0 },
 *   scale: 2,
 *   children: [hand],
 *   parent: body,
 *   eventMode: 'static',
 * });
 * ```
 * @see {@link Federated3DOptions} For the interaction members and their semantics.
 * @category scene
 * @standard
 */
export interface Container3DOptions extends PixiMixins.Container3DOptions {
  /**
   * Free-form name for telling nodes apart in `logHierarchy` output and when debugging
   * @default null
   */
  label?: string | null;
  /**
   * Local position
   * @default { x: 0, y: 0, z: 0 }
   */
  position?: PointData3D;
  /** Local position on x; an alias for `position.x` */
  x?: number;
  /** Local position on y; an alias for `position.y` */
  y?: number;
  /** Local position on z; an alias for `position.z` */
  z?: number;
  /**
   * Local scale; a number scales all three axes
   * @default 1
   */
  scale?: PointData3D | number;
  /**
   * Local rotation as Euler angles (radians, XYZ order)
   * @default { x: 0, y: 0, z: 0 }
   */
  rotation?: PointData3D;
  /**
   * Local rotation as Euler angles in degrees; the degree twin of `rotation`. Passing both is
   * last-wins, like pixi.js's `rotation` / `angle`.
   * @default { x: 0, y: 0, z: 0 }
   */
  angle?: PointData3D;
  /**
   * Local rotation as a unit quaternion
   * @default { x: 0, y: 0, z: 0, w: 1 }
   */
  quaternion?: QuaternionData;
  /**
   * Point in local space that rotation and scale happen around, without moving the node. A number
   * sets all three axes.
   * @default { x: 0, y: 0, z: 0 }
   */
  origin?: PointData3D | number;
  /**
   * Whether this node and its descendants draw
   * @default true
   */
  visible?: boolean;
  /** Target width along x; sets `scale.x` against the local bounds of the node and its `children` */
  width?: number;
  /** Target height along y; sets `scale.y` against the local bounds of the node and its `children` */
  height?: number;
  /** Target depth along z; sets `scale.z` against the local bounds of the node and its `children` */
  depth?: number;
  /**
   * Fixed local-space box used in place of this node's subtree when measuring bounds
   * @see {@link Container3D.boundsVolume}
   */
  boundsVolume?: Box;
  /** Children to add, in order */
  children?: Container3D[];
  /** Parent to add this node to, once everything else is applied */
  parent?: Container3D;
}

/** Option keys the constructor applies itself, after the plain assignment */
const OPTIONS_APPLIED_LATER: Record<string, boolean> = {
  children: true,
  hitVolume: true,
  parent: true,
  width: true,
  height: true,
  depth: true,
};

// Merges the PixiMixins hook into the class type — mixed-in members declared
// there (and applied with `extensions.mixin`) surface on every Container3D.
// oxlint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, pixi3d/require-export-jsdoc, pixi3d/require-member-api-doc
export interface Container3D extends PixiMixins.Container3D {}

// Keeps arbitrary custom events typed on the emitter, mirroring pixi's Container. The branded
// `({} & string)` / `({} & symbol)` keys are load-bearing: plain index signatures would swallow
// the literal-key inference of the known events above.
type AnyEvent = {
  [K: ({} & string) | ({} & symbol)]: any;
};

/**
 * `Container3D` is the scene-graph node of a 3D scene — the 3D counterpart of pixi.js's `Container`
 *
 * It carries a local TRS transform ({@link Container3D.position | position},
 * {@link Container3D.scale | scale}, and either {@link Container3D.rotation | rotation} or
 * {@link Container3D.quaternion | quaternion}), tracks its parent and children, and resolves its
 * world transform during the per-frame transform pass owned by the enclosing {@link View3D}.
 *
 * Add lights, meshes, and cameras by parenting them under a Container3D that lives under
 * {@link View3D.root | view.root}; the View indexes them automatically as the graph changes.
 *
 * Transform changes (position/scale/rotation/quaternion mutations) flow through observers, set
 * cascading dirty flags, and enqueue this node into the View's per-depth update bucket — so cost
 * is paid once per frame, not once per write.
 * @example
 * ```ts
 * const root = new Container3D();
 * root.position.set(0, 1, 0);
 *
 * const child = new Container3D();
 * child.scale.set(2);
 * root.addChild(child);
 *
 * root.lookAt({ x: 0, y: 0, z: 0 }); // orient root's +Z toward the origin
 * ```
 * @see {@link View3D} For the scene root that owns the transform pass.
 * @see {@link Container3DEvents} For the events emitted on add/remove.
 * @see {@link Camera3D} For the camera subclass that faces local -Z.
 * @see {@link Light} For the light subclass that faces local -Z.
 * @category scene
 * @standard
 */
export class Container3D extends EventEmitter<Container3DEvents & AnyEvent> {
  /** Process-wide unique id assigned at construction */
  public readonly uid: number = UID++;

  /**
   * Free-form label used by {@link Container3D.logHierarchy} and by user-side debugging
   *
   * `null` until set, as in pixi.js's `Container`, so a label search matches only the nodes that
   * were actually named. Subclasses name themselves (`'Mesh3D'`, `'Sprite3D'`, ...).
   */
  public label: string | null = null;

  /**
   * `true` when {@link Container3D.rotation | rotation} (Euler angles) is the authoritative
   * rotation representation
   *
   * When set, {@link Container3D.quaternion | quaternion} needs to be rebuilt from the Euler
   * angles on the next {@link updateLocalTransform}. Cleared once the quaternion has been
   * synced, or whenever the quaternion is written directly.
   * @internal
   */
  public rotationDirty = false;

  /**
   * Local TRS matrix — rebuilt from {@link position}, {@link scale} and {@link quaternion} during
   * the transform pass
   *
   * Treat as read-only outside the engine; write to the components instead.
   */
  public localTransform: Matrix4 = new Matrix4();
  /**
   * World transform — `parent.worldTransform * this.localTransform`
   *
   * Resolved during the transform pass; reads from this matrix outside the pass may be stale.
   * {@link Container3D.getGlobalTransform | getGlobalTransform} computes a definitely-current one on
   * demand.
   */
  public worldTransform: Matrix4 = new Matrix4();

  private readonly _position = new ObservableVector3(this, 0, 0, 0);
  private readonly _scale = new ObservableVector3(this, 1, 1, 1);
  private readonly _rotation = new ObservableVector3(this, 0, 0, 0);
  private readonly _quaternion = new ObservableQuaternion(this, 0, 0, 0, 1);
  /** Degree view over `_rotation`, created on first use of {@link Container3D.angle} */
  private _angle: EulerDegrees | null = null;
  /** Created on first use of {@link Container3D.origin}, so a node without one pays nothing */
  protected _origin: ObservableVector3 | null = null;

  /** Child containers, in draw order; treat as read-only and mutate via {@link addChild} / {@link removeChild} */
  public children: Container3D[] = [];

  /** Parent container, or `null` when unparented or when this node is the scene root */
  public parent: Container3D | null = null;

  /**
   * Backing field for {@link Container3D.view3d}; written by `View3D._attach` / `_detach`
   * @internal
   */
  public _view3d: View3D | null = null;

  /**
   * A fixed local-space box that stands in for this container and its whole subtree when bounds are
   * measured, or `null` to measure the geometry
   *
   * Setting one skips walking the children, which pays off for a large subtree whose extent you
   * already know (a particle cloud, a level chunk). {@link Container3D.getLocalBounds | getLocalBounds},
   * `width` / `height` / `depth` and `setSize` all use it. This is pixi's `boundsArea`, named like
   * {@link Container3D#hitVolume | hitVolume} because the value is a {@link Box}.
   * @example
   * ```ts
   * swarm.boundsVolume = new Box(new Vector3(-10, 0, -10), new Vector3(10, 5, 10));
   * ```
   */
  public boundsVolume: Box | null = null;

  /**
   * Set `true` once {@link Container3D.destroy} has run
   *
   * Guards against double-destroy, mirroring pixi.js's `Container.destroyed`.
   */
  public destroyed = false;

  /** Re-entry guard — prevents double-enqueueing in the same frame @internal */
  public didChange = false;

  /** Cascading dirty flag — world matrix needs rebuild @internal */
  public _worldTransformDirty = true;

  /** Cascading dirty flag — `worldVisible` needs re-resolve @internal */
  public _worldVisibleDirty = true;

  /** Self-only dirty flag — local matrix needs recompute @internal */
  public _localTransformDirty = false;

  /**
   * Local visibility as a 0|1 mask. Stored as a number — not boolean — so the
   * worldVisible cascade and render-side gate can multiply instead of branch,
   * matching the shape GPU culling will use when frustum / occlusion / layer
   * masks land. Toggle via the boolean `visible` getter/setter (public API).
   * @internal
   */
  public _visible = 1;

  /**
   * Backing field for {@link Container3D.worldVisible}; written by the transform pass
   * @internal
   */
  public _worldVisible = 1;

  /**
   * The update tick index, used to avoid duplicate updates
   * @internal
   */
  public _updateTick = -1;

  /**
   * The depth of the container relative to the scene
   * @internal
   */
  public _relativeSceneDepth = 0;

  /**
   * Whether the scene sweep must re-emit this node's whole store row (matrix and u32 lanes)
   *
   * Raised by lane changes — material / geometry swaps, visibility flips, morph slots — and
   * by the transform pass when a mesh has no row yet. A plain move never raises it: the pass
   * publishes the matrix itself through {@link Container3D._storeWorldTransform}.
   * @internal
   */
  public _storeDirty = false;

  /**
   * Monotonic version bumped each time {@link worldTransform} is recomputed in the transform pass
   *
   * Lets derived per-node caches — e.g. {@link Mesh3D.boundingSphere} — invalidate by comparing a
   * stored snapshot, rather than subscribing to transform events or re-reading the whole matrix.
   * @internal
   */
  public _worldTransformId = 0;

  /**
   * Whether this node's visual forward axis is local +Z (true) or local -Z (false)
   *
   * Container3D defaults to +Z (mesh / glTF authoring convention — `mesh.lookAt(target)`
   * orients the mesh's +Z toward target). Camera3D and Light set this to false because
   * cameras and lights face -Z by definition.
   * @internal
   */
  protected _lookAtForwardIsPositiveZ: boolean = true;

  constructor(options: Container3DOptions = {}) {
    super();

    // Skips `undefined` values, so an explicit `undefined` never clobbers a default.
    assignWithIgnore(this as Container3DOptions, options, OPTIONS_APPLIED_LATER);

    const { children, hitVolume, width, height, depth, parent } = options;

    if (children) {
      for (let i = 0; i < children.length; i++) this.addChild(children[i]);
    }

    // Held back until the children are attached: a `'box'` shorthand measures the subtree, so on an
    // empty node it would resolve to a zero box and the node would never be hit.
    if (hitVolume !== undefined) this.hitVolume = hitVolume;

    if (width !== undefined) this.width = width;
    if (height !== undefined) this.height = height;
    if (depth !== undefined) this.depth = depth;

    parent?.addChild(this);
  }

  /**
   * Local position
   *
   * Always the same observable; writing a component marks this node dirty. Assigning copies the
   * values in rather than replacing the object.
   * @example
   * ```ts
   * node.position.set(0, 1, 0);
   * node.position = { x: 0, y: 1, z: 0 };
   * ```
   */
  get position(): ObservableVector3 {
    return this._position;
  }

  /**
   * Copies `value` into the local position
   * @param value - The new position
   */
  set position(value: PointData3D) {
    this._position.copyFrom(value);
  }

  /**
   * Local scale
   *
   * Always the same observable; writing a component marks this node dirty. Assigning copies the
   * values in; a single number scales all three axes.
   * @example
   * ```ts
   * node.scale.set(2, 1, 1);
   * node.scale = 2; // uniform
   * ```
   */
  get scale(): ObservableVector3 {
    return this._scale;
  }

  /**
   * Copies `value` into the local scale; a number sets all three axes
   * @param value - The new scale
   */
  set scale(value: PointData3D | number) {
    if (typeof value === 'number') this._scale.set(value);
    else this._scale.copyFrom(value);
  }

  /**
   * Local rotation as Euler angles (radians, XYZ order)
   *
   * Shares storage with {@link Container3D.quaternion | quaternion}: whichever was written last is
   * authoritative. Always the same observable; assigning copies the values in.
   * @example
   * ```ts
   * node.rotation.y = Math.PI / 2;
   * node.rotation = { x: 0, y: Math.PI / 2, z: 0 };
   * ```
   */
  get rotation(): ObservableVector3 {
    return this._rotation;
  }

  /**
   * Copies `value` (radians) into the Euler rotation, which becomes the authoritative rotation
   * @param value - The new Euler angles, in radians
   */
  set rotation(value: PointData3D) {
    this._rotation.copyFrom(value);

    // `copyFrom` stays silent when every component already matches, and the two representations
    // drift apart — so assigning the angles the node happens to store would otherwise leave the
    // quaternion authoritative and the write would do nothing. Claim authority either way.
    if (!this.rotationDirty) this._onUpdate(this._rotation);
  }

  /**
   * Local rotation as Euler angles in degrees (XYZ order); the degree twin of
   * {@link Container3D.rotation | rotation}, as in pixi.js
   *
   * A live view: it stores nothing, reading and writing `rotation` with a unit conversion, so the
   * two always agree. Assigning copies the values in.
   * @example
   * ```ts
   * node.angle.y = 90; // same as node.rotation.y = Math.PI / 2
   * node.angle = { x: 0, y: 45, z: 0 };
   * ```
   */
  get angle(): PointLike3D {
    return (this._angle ??= new EulerDegrees(this._rotation));
  }

  /**
   * Copies `value` (degrees) into the Euler rotation
   * @param value - The new Euler angles, in degrees
   */
  set angle(value: PointData3D) {
    this._rotation.set(value.x * DEG_TO_RAD, value.y * DEG_TO_RAD, value.z * DEG_TO_RAD);

    // Same guard as the rotation setter: `set` is silent when nothing changed.
    if (!this.rotationDirty) this._onUpdate(this._rotation);
  }

  /**
   * Local rotation as a unit quaternion
   *
   * Shares storage with {@link Container3D.rotation | rotation}: whichever was written last is
   * authoritative. Always the same observable; assigning copies the values in.
   */
  get quaternion(): ObservableQuaternion {
    return this._quaternion;
  }

  /**
   * Copies `value` into the quaternion, which becomes the authoritative rotation
   * @param value - The new rotation, as a unit quaternion
   */
  set quaternion(value: QuaternionData) {
    this._quaternion.copyFrom(value);

    // As in the rotation setter: a write matching the stored components changes nothing on its own,
    // so take authority back from the Euler angles explicitly.
    if (this.rotationDirty) this._onUpdate(this._quaternion);
  }

  /**
   * Point in local space that rotation and scale happen around, without moving the node, as in pixi.js
   *
   * Setting it leaves the node where it is: the origin stays at `position + origin` in the parent
   * while the node turns and scales around it.
   *
   * Always the same observable; assigning copies the values in, and a single number sets all three
   * axes.
   * @example
   * ```ts
   * // Tip a crate over its bottom-right edge without moving it first.
   * crate.origin = { x: 0.5, y: -0.5, z: 0 };
   * crate.angle.z = -90;
   * ```
   */
  get origin(): ObservableVector3 {
    return (this._origin ??= new ObservableVector3(this, 0, 0, 0));
  }

  /**
   * Copies `value` into the origin; a number sets all three axes
   * @param value - The new origin, in local space
   */
  set origin(value: PointData3D | number) {
    const origin = this.origin;

    if (typeof value === 'number') origin.set(value);
    else origin.copyFrom(value);
  }

  /** Local position on the x axis; an alias for `position.x` */
  get x(): number {
    return this._position._x;
  }

  /**
   * Sets `position.x`
   * @param value - The new x position
   */
  set x(value: number) {
    this._position.x = value;
  }

  /** Local position on the y axis; an alias for `position.y` */
  get y(): number {
    return this._position._y;
  }

  /**
   * Sets `position.y`
   * @param value - The new y position
   */
  set y(value: number) {
    this._position.y = value;
  }

  /** Local position on the z axis; an alias for `position.z` */
  get z(): number {
    return this._position._z;
  }

  /**
   * Sets `position.z`
   * @param value - The new z position
   */
  set z(value: number) {
    this._position.z = value;
  }

  /**
   * Adds one or more children to the end of this container's child list
   *
   * A child already parented elsewhere is removed from its previous parent first. Emits
   * {@link Container3DEvents.childAdded} on this container and {@link Container3DEvents.added}
   * on each newly added child.
   * @param children - The children to add
   * @returns The first added child
   */
  public addChild<U extends Container3D[]>(...children: U): U[0] {
    if (children.length > 1) {
      for (let i = 0; i < children.length; i++) {
        this.addChild(children[i]);
      }

      return children[0];
    }

    const child = children[0];

    if (child.parent === this) {
      this.children.splice(this.children.indexOf(child), 1);
      this.children.push(child);

      return child;
    }

    if (child.parent) {
      child.parent.removeChild(child);
    }

    this.children.push(child);

    child._worldTransformDirty = true;
    child._worldVisibleDirty = true;
    child.didChange = true;
    child.parent = this;

    if (this._view3d) {
      this._view3d._attach(child);
    }

    this.emit('childAdded', child, this, this.children.length - 1);
    child.emit('added', this);

    return child;
  }

  /**
   * Removes one or more children from this container
   *
   * Emits {@link Container3DEvents.childRemoved} on this container and
   * {@link Container3DEvents.removed} on each removed child.
   * @param children - The children to remove
   * @returns The first removed child
   */
  public removeChild<U extends Container3D[]>(...children: U): U[0] {
    if (children.length > 1) {
      for (let i = 0; i < children.length; i++) {
        this.removeChild(children[i]);
      }

      return children[0];
    }

    const child = children[0];

    const index = this.children.indexOf(child);

    if (index > -1) {
      this.children.splice(index, 1);

      if (child._view3d) child._view3d._detach(child);

      child.parent = null;

      this.emit('childRemoved', child, this, index);
      child.emit('removed', this);
    }

    return child;
  }

  /**
   * Removes every child in the index range `[beginIndex, endIndex)`
   *
   * Emits {@link Container3DEvents.childRemoved} / {@link Container3DEvents.removed} for each
   * removed child.
   * @param beginIndex - First index to remove
   * @param endIndex - End of the range, exclusive; defaults to the child count
   * @returns The removed children
   * @throws {RangeError} When the range falls outside the children list.
   */
  public removeChildren(beginIndex = 0, endIndex?: number): Container3D[] {
    const end = endIndex ?? this.children.length;
    const range = end - beginIndex;
    const removed: Container3D[] = [];

    if (range > 0 && range <= end) {
      for (let i = end - 1; i >= beginIndex; i--) {
        const child = this.children[i];

        if (!child) continue;

        removed.push(child);

        if (child._view3d) child._view3d._detach(child);

        child.parent = null;
      }

      this.children.splice(beginIndex, range);

      for (let i = 0; i < removed.length; i++) {
        const child = removed[i];

        this.emit('childRemoved', child, this, i);
        child.emit('removed', this);
      }

      return removed;
    } else if (range === 0 && this.children.length === 0) {
      return removed;
    }

    throw new RangeError('removeChildren: numeric values are outside the acceptable range.');
  }

  /**
   * Removes the child at `index`
   * @param index - Index of the child to remove
   * @returns The removed child
   * @throws {Error} When `index` is out of bounds.
   */
  public removeChildAt<U extends Container3D>(index: number): U {
    const child = this.getChildAt<U>(index);

    return this.removeChild(child);
  }

  /**
   * Gets the child at `index`
   * @param index - Index of the child to fetch
   * @returns The child at `index`
   * @throws {Error} When `index` is out of bounds.
   */
  public getChildAt<U extends Container3D>(index: number): U {
    if (index < 0 || index >= this.children.length) {
      throw new Error(`getChildAt: Index (${index}) does not exist.`);
    }

    return this.children[index] as U;
  }

  /**
   * Gets the index of `child` within this container
   * @param child - The child to look up
   * @returns The child's index
   * @throws {Error} When `child` is not a child of this container.
   */
  public getChildIndex(child: Container3D): number {
    const index = this.children.indexOf(child);

    if (index === -1) {
      throw new Error('getChildIndex: The supplied Container3D must be a child of the caller.');
    }

    return index;
  }

  /**
   * Moves an existing `child` to `index` within this container
   * @param child - The child to move
   * @param index - The destination index
   * @throws {Error} When `index` is out of bounds or `child` is not a child of this container.
   */
  public setChildIndex(child: Container3D, index: number): void {
    if (index < 0 || index >= this.children.length) {
      throw new Error(`setChildIndex: The index ${index} supplied is out of bounds ${this.children.length}.`);
    }

    this.getChildIndex(child); // verifies `child` belongs to this container

    this.addChildAt(child, index);
  }

  /**
   * Adds `child` at `index`, or moves it there when it is already a child of this container
   *
   * Emits {@link Container3DEvents.childAdded} / {@link Container3DEvents.added} for an add — not
   * for a move within this same container.
   * @param child - The child to add or move
   * @param index - The destination index
   * @returns The added child
   * @throws {Error} When `index` is out of bounds.
   */
  public addChildAt<U extends Container3D>(child: U, index: number): U {
    const { children } = this;

    if (index < 0 || index > children.length) {
      throw new Error(`addChildAt: The index ${index} supplied is out of bounds ${children.length}.`);
    }

    const sameParent = child.parent === this;

    if (child.parent) {
      if (sameParent) {
        const currentIndex = children.indexOf(child);

        if (currentIndex === index) return child;

        children.splice(currentIndex, 1);
      } else {
        child.parent.removeChild(child);
      }
    }

    if (index === children.length) {
      children.push(child);
    } else {
      children.splice(index, 0, child);
    }

    // A move within the same parent leaves parentage and transforms untouched.
    if (sameParent) return child;

    child._worldTransformDirty = true;
    child._worldVisibleDirty = true;
    child.didChange = true;
    child.parent = this;

    if (this._view3d) {
      this._view3d._attach(child);
    }

    this.emit('childAdded', child, this, index);
    child.emit('added', this);

    return child;
  }

  /**
   * Swaps the positions of two children within this container
   * @param child - The first child
   * @param child2 - The second child
   * @throws {Error} When either argument is not a child of this container.
   */
  public swapChildren<U extends Container3D>(child: U, child2: U): void {
    if (child === child2) return;

    const index1 = this.getChildIndex(child);
    const index2 = this.getChildIndex(child2);

    this.children[index1] = child2;
    this.children[index2] = child;
  }

  /**
   * Returns the first child whose label matches, or `null`
   *
   * Direct children are checked first; with `deep`, the search then recurses into each child in
   * order (pre-order), as pixi.js's `Container.getChildByLabel` does.
   * @param label - Exact label, or a pattern to test labels against
   * @param deep - Whether to search the whole subtree, not only direct children
   * @returns The first match, or `null` when nothing matches
   * @example
   * ```ts
   * const wheel = car.getChildByLabel('wheel_front_left', true);
   * const anyWheel = car.getChildByLabel(/^wheel_/, true);
   * ```
   */
  public getChildByLabel(label: string | RegExp, deep = false): Container3D | null {
    const children = this.children;

    for (let i = 0; i < children.length; i++) {
      if (labelMatches(children[i].label, label)) return children[i];
    }

    if (deep) {
      for (let i = 0; i < children.length; i++) {
        const found = children[i].getChildByLabel(label, true);

        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Collects every child whose label matches
   *
   * Matches are appended to `out` in the same order {@link Container3D.getChildByLabel} visits
   * them.
   * @param label - Exact label, or a pattern to test labels against
   * @param deep - Whether to search the whole subtree, not only direct children
   * @param out - Array the matches are appended to; a new one when omitted
   * @returns `out`
   * @example
   * ```ts
   * const wheels = car.getChildrenByLabel(/^wheel_/, true);
   * ```
   */
  public getChildrenByLabel(label: string | RegExp, deep = false, out: Container3D[] = []): Container3D[] {
    const children = this.children;

    for (let i = 0; i < children.length; i++) {
      if (labelMatches(children[i].label, label)) out.push(children[i]);
    }

    if (deep) {
      for (let i = 0; i < children.length; i++) {
        children[i].getChildrenByLabel(label, true, out);
      }
    }

    return out;
  }

  /** Removes this container from its parent; does nothing when it has no parent */
  public removeFromParent(): void {
    this.parent?.removeChild(this);
  }

  /**
   * Reparents one or more children under this container, preserving each child's world transform
   * so its rendered position and orientation are unchanged
   * @param child - The children to reparent
   * @returns The first reparented child
   */
  public reparentChild<U extends Container3D[]>(...child: U): U[0] {
    if (child.length === 1) {
      return this.reparentChildAt(child[0], this.children.length);
    }

    for (let i = 0; i < child.length; i++) {
      this.reparentChildAt(child[i], this.children.length);
    }

    return child[0];
  }

  /**
   * Reparents `child` under this container at `index`, preserving its world transform so its
   * rendered position and orientation are unchanged
   *
   * World transforms are resolved on demand, so the result is correct even before the scene's
   * transform pass has run this frame.
   * @param child - The child to reparent
   * @param index - The destination index
   * @returns The reparented child
   */
  public reparentChildAt<U extends Container3D>(child: U, index: number): U {
    if (child.parent === this) {
      this.setChildIndex(child, index);

      return child;
    }

    // World transform of `child` = (its parent's world) * (its local).
    updateTransformBackwards3D(child, _reparentChildWorld);
    if (child._localTransformDirty) {
      child.updateLocalTransform();
      child._localTransformDirty = false;
    }
    _reparentChildWorld.multiply(child.localTransform);

    child.removeFromParent();
    this.addChildAt(child, index);

    // World transform of the new parent = (its parent's world) * (its local).
    updateTransformBackwards3D(this, _reparentParentWorld);
    if (this._localTransformDirty) {
      this.updateLocalTransform();
      this._localTransformDirty = false;
    }
    _reparentParentWorld.multiply(this.localTransform);

    // New local = inverse(new parent world) * (child world); decompose it back onto the child.
    _reparentParentWorld.getInverse(_reparentParentWorld);
    _reparentChildWorld.premultiply(_reparentParentWorld);
    _reparentChildWorld.decompose(_reparentPos, _reparentQuat, _reparentScale);

    child.scale.copyFrom(_reparentScale);
    child.quaternion.copyFrom(_reparentQuat);

    // The decomposed translation is `position + offset`: rebuild the basis for the new rotation and
    // scale, then solve for position.
    if (child._origin !== null) {
      child.updateLocalTransform();
      _reparentPos.subtract(child._getOriginOffset(_originOffset));
    }

    child.position.copyFrom(_reparentPos);

    return child;
  }

  /**
   * Replaces `oldChild` with `newChild` at the same index, copying `oldChild`'s local position,
   * rotation, and scale onto `newChild`
   *
   * `newChild` keeps its own {@link Container3D.origin | origin}; its position is solved so it sits
   * exactly where `oldChild` did.
   * @param oldChild - The child to replace
   * @param newChild - The child that takes its place
   * @throws {Error} When `oldChild` is not a child of this container.
   */
  public replaceChild<U extends Container3D, T extends Container3D>(oldChild: U, newChild: T): void {
    const index = this.getChildIndex(oldChild);

    this.addChildAt(newChild, index);

    // Copy `oldChild`'s local transform onto `newChild`, preserving whichever rotation
    // representation — euler `rotation` or `quaternion` — is the authoritative one.
    newChild.scale.copyFrom(oldChild.scale);
    newChild.rotation.copyFrom(oldChild.rotation);
    newChild.quaternion.copyFrom(oldChild.quaternion);
    // Copied before the rebuilds below clear `oldChild`'s.
    newChild.rotationDirty = oldChild.rotationDirty;

    // Match translations: newPosition + newOffset = oldPosition + oldOffset, each offset on its own basis.
    const position = newChild.position.copyFrom(oldChild.position);

    if (oldChild._origin !== null) {
      oldChild.updateLocalTransform();
      position.add(oldChild._getOriginOffset(_originOffset));
    }

    if (newChild._origin !== null) {
      newChild.updateLocalTransform();
      position.subtract(newChild._getOriginOffset(_originOffset));
    }

    this.removeChild(oldChild);
  }

  /**
   * Rebuilds {@link localTransform} from {@link position}, {@link scale} and {@link quaternion}
   *
   * When `rotationDirty` is set, {@link rotation} (Euler XYZ, radians) is converted to a
   * quaternion first. Runs in the transform pass; rarely needs to be called by user code.
   */
  public updateLocalTransform(): void {
    const quat = this._quaternion;

    if (this.rotationDirty) {
      this.rotationDirty = false;

      // Direct field access — we already own this update, observer fires would re-enqueue this node.
      const rx = this._rotation._x;
      const ry = this._rotation._y;
      const rz = this._rotation._z;

      const c1 = Math.cos(rx / 2);
      const c2 = Math.cos(ry / 2);
      const c3 = Math.cos(rz / 2);

      const s1 = Math.sin(rx / 2);
      const s2 = Math.sin(ry / 2);
      const s3 = Math.sin(rz / 2);

      // Direct write — batch all four components, skip the four observer dispatches the setters would fire.
      quat._x = s1 * c2 * c3 + c1 * s2 * s3;
      quat._y = c1 * s2 * c3 - s1 * c2 * s3;
      quat._z = c1 * c2 * s3 + s1 * s2 * c3;
      quat._w = c1 * c2 * c3 - s1 * s2 * s3;
    }

    // Direct field access — getter dispatch would inflate this hot path.
    const x = quat._x;
    const y = quat._y;
    const z = quat._z;
    const w = quat._w;

    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;

    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    const out = this.localTransform.elements;

    const sx = this._scale._x;
    const sy = this._scale._y;
    const sz = this._scale._z;

    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;

    out[12] = this._position._x;
    out[13] = this._position._y;
    out[14] = this._position._z;

    if (this._origin !== null) this._addOriginOffset();
  }

  /**
   * Adds the {@link Container3D.origin | origin} offset to the local matrix's translation; only call
   * when `_origin` is set
   */
  protected _addOriginOffset(): void {
    const offset = this._getOriginOffset(_originOffset);
    const out = this.localTransform.elements;

    out[12] += offset.x;
    out[13] += offset.y;
    out[14] += offset.z;
  }

  /**
   * Writes into `out` the translation that {@link Container3D.origin | origin} adds to the local
   * matrix: `origin - M·origin`
   *
   * M is the rotation-and-scale basis read from {@link Container3D.localTransform | localTransform},
   * so call this once that basis is current. The offset keeps the local `origin` still under rotation
   * and scale, landing on `position + origin`, as pixi.js's 2D `Container` does. Subclasses whose
   * local matrix carries more than rotation and scale override it. Only call when `_origin` is set.
   * @param out - Receives the offset
   * @returns `out`
   */
  protected _getOriginOffset(out: Vector3): Vector3 {
    const e = this.localTransform.elements;
    const origin = this._origin!;

    const ox = origin._x;
    const oy = origin._y;
    const oz = origin._z;

    out.x = ox - (e[0] * ox + e[4] * oy + e[8] * oz);
    out.y = oy - (e[1] * ox + e[5] * oy + e[9] * oz);
    out.z = oz - (e[2] * ox + e[6] * oy + e[10] * oz);

    return out;
  }

  /**
   * Measures the local-space bounding box of this container and its descendants
   *
   * Uses {@link Container3D.boundsVolume | boundsVolume} in place of any subtree that has one; otherwise
   * each mesh's geometry bounds, transformed into this container's space. This container's own
   * transform isn't applied. An empty subtree measures as a zero box at the origin.
   *
   * Hidden descendants and their subtrees are left out, so an invisible collider or LOD mesh doesn't
   * inflate the box. This container is measured whether or not it is visible.
   *
   * The subtree is walked on every call, so pass an `out` and cache the result if you need it
   * each frame.
   * @param out - Box to write into; a new one when omitted
   * @returns `out`
   * @example
   * ```ts
   * const bounds = model.getLocalBounds();
   * const center = bounds.getCenter();
   * ```
   */
  public getLocalBounds(out: Box = new Box()): Box {
    return getLocalBounds3D(this, out);
  }

  /**
   * Width along local x: `|scale.x| × local bounds width`
   *
   * Assigning writes `scale.x` only. To set several axes, {@link Container3D.setSize | setSize}
   * measures the bounds once instead of once per axis.
   * @example
   * ```ts
   * crate.width = 2;
   * ```
   */
  get width(): number {
    return Math.abs(this._scale._x * this.getLocalBounds(_measureBox).width);
  }

  /**
   * Scales along x so the width becomes `value`
   * @param value - Target width along x
   */
  set width(value: number) {
    this._scale.x = scaleForSize(value, this.getLocalBounds(_measureBox).width, this._scale._x);
  }

  /**
   * Height along local y: `|scale.y| × local bounds height`
   *
   * Assigning writes `scale.y` only; see {@link Container3D.width | width}.
   */
  get height(): number {
    return Math.abs(this._scale._y * this.getLocalBounds(_measureBox).height);
  }

  /**
   * Scales along y so the height becomes `value`
   * @param value - Target height along y
   */
  set height(value: number) {
    this._scale.y = scaleForSize(value, this.getLocalBounds(_measureBox).height, this._scale._y);
  }

  /**
   * Depth along local z: `|scale.z| × local bounds depth`
   *
   * Assigning writes `scale.z` only; see {@link Container3D.width | width}.
   */
  get depth(): number {
    return Math.abs(this._scale._z * this.getLocalBounds(_measureBox).depth);
  }

  /**
   * Scales along z so the depth becomes `value`
   * @param value - Target depth along z
   */
  set depth(value: number) {
    this._scale.z = scaleForSize(value, this.getLocalBounds(_measureBox).depth, this._scale._z);
  }

  /**
   * Returns the scaled size of this container, measuring the local bounds once
   * @param out - Object to write into; a new one when omitted
   * @returns The size, written into `out`
   * @example
   * ```ts
   * const { width, height, depth } = model.getSize();
   * ```
   */
  public getSize(out: Size3D = { width: 0, height: 0, depth: 0 }): Size3D {
    const bounds = this.getLocalBounds(_measureBox);

    out.width = Math.abs(this._scale._x * bounds.width);
    out.height = Math.abs(this._scale._y * bounds.height);
    out.depth = Math.abs(this._scale._z * bounds.depth);

    return out;
  }

  /**
   * Rescales this container so its size matches the given width, height and depth
   *
   * Measures the local bounds once and writes all three scale axes in one update. A single number
   * sizes every axis; in either form a missing `height` or `depth` takes the width. An axis whose
   * local extent is zero (a flat plane's depth, say) keeps a unit scale. The sign of each scale
   * axis is kept, so a mirrored node stays mirrored.
   * @param value - Target width, or an object with `width` and optional `height` / `depth`
   * @param height - Target height; defaults to the width
   * @param depth - Target depth; defaults to the width
   * @example
   * ```ts
   * model.setSize(2); // fit a 2×2×2 box
   * model.setSize(4, 2, 1);
   * model.setSize({ width: 4, height: 2 }); // depth follows width: 4
   * ```
   */
  public setSize(value: number | (Pick<Size3D, 'width'> & Partial<Size3D>), height?: number, depth?: number): void {
    let width: number;

    if (typeof value === 'object') {
      width = value.width;
      height = value.height ?? width;
      depth = value.depth ?? width;
    } else {
      width = value;
      height ??= width;
      depth ??= width;
    }

    const bounds = this.getLocalBounds(_measureBox);
    const scale = this._scale;

    scale.set(
      scaleForSize(width, bounds.width, scale._x),
      scaleForSize(height, bounds.height, scale._y),
      scaleForSize(depth, bounds.depth, scale._z),
    );
  }

  /**
   * Orients this node so its forward axis points at `target`
   *
   * Container3D's forward is local +Z (mesh / glTF convention) — `mesh.lookAt(target)`
   * orients the mesh's +Z toward the target. Camera3D and Light face local -Z and
   * override this convention internally.
   *
   * Aims from `position + origin`, the point the rotation turns around, so a node with an
   * {@link Container3D.origin | origin} faces the target from where it stands.
   *
   * Computes parent's current world transform on demand (walks up the parent chain
   * via `updateTransformBackwards3D`), so the result is correct even if an ancestor's
   * transform changed this frame and the cascade hasn't run yet.
   * @param target - World-space point to face
   * @param up - World-space up reference; defaults to `(0, 1, 0)`
   */
  public lookAt(target: PointData3D, up: PointData3D = _lookAtDefaultUp): void {
    // Compute parent's current world transform without mutating any stored worldTransform.
    updateTransformBackwards3D(this, _lookAtParentWorld.identity());

    // Local rotation and scale don't move the eye, so we skip `updateLocalTransform()` and the 4x4
    // multiplyMatrices entirely.
    _lookAtPos.copyFrom(this.position);
    if (this._origin !== null) _lookAtPos.add(this._origin);
    _lookAtPos.applyAffineMatrix4(_lookAtParentWorld);

    // Build a world-space rotation matrix and extract its quaternion. The Matrix4.lookAt
    // convention places target along the local -Z axis; swapping eye/target flips that to +Z.
    if (this._lookAtForwardIsPositiveZ) {
      _lookAtMatrix.lookAt(target, _lookAtPos, up);
    } else {
      _lookAtMatrix.lookAt(_lookAtPos, target, up);
    }
    _lookAtWorldQuat.setFromRotationMatrix(_lookAtMatrix);

    // Convert world→local by undoing parent's world rotation. The combined
    // `setFromScaledRotationMatrix` strips scale and extracts the quaternion
    // in one pass — no intermediate "rotation only" matrix needed.
    if (this.parent) {
      _lookAtParentQuat.setFromScaledRotationMatrix(_lookAtParentWorld);
      _lookAtParentQuat.inverse();
      _lookAtWorldQuat.premultiply(_lookAtParentQuat);
    }

    // ObservableQuaternion.copyFrom auto-fires _onUpdate → marks dirty + queues for cascade.
    this.quaternion.copyFrom(_lookAtWorldQuat);
  }

  /**
   * Computes this container's current world transform into `out` and returns it — the 3D
   * counterpart of pixi.js's `Container.getGlobalTransform`.
   *
   * With `skipUpdate = false` (default) the transform is resolved on demand by walking the
   * parent chain, so the result is correct even mid-frame, before the View's transform pass
   * has run. With `skipUpdate = true` the cached {@link Container3D.worldTransform} from the
   * last transform pass is copied instead — cheaper, but stale for anything moved this frame.
   * @param out - matrix the result is written into. Defaults to a new `Matrix4`.
   * @param skipUpdate - `true` to copy the cached world transform instead of recomputing.
   * @example
   * ```ts
   * const world = mesh.getGlobalTransform();
   * ray.applyMatrix4(world.getInverse(world)); // world-space ray → mesh-local space
   * ```
   * @see {@link Container3D.toGlobal} / {@link Container3D.toLocal} For point conversions.
   */
  public getGlobalTransform(out: Matrix4 = new Matrix4(), skipUpdate = false): Matrix4 {
    if (skipUpdate) return out.copyFrom(this.worldTransform);

    updateTransformBackwards3D(this, out);

    if (this._localTransformDirty) {
      this.updateLocalTransform();
      this._localTransformDirty = false;
    }

    return out.multiply(this.localTransform);
  }

  /**
   * Converts a point from this container's local space into the 3D world space of the
   * enclosing scene (the space of {@link View3D.root}) — the 3D counterpart of pixi.js's
   * `Container.toGlobal`.
   *
   * To go all the way to 2D screen coordinates, feed the result through
   * {@link View3D.worldToScreen}.
   * @param position - the local-space point to convert.
   * @param out - point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use the cached world transform (see {@link Container3D.getGlobalTransform}).
   * @example
   * ```ts
   * // World-space position of a point 1 unit above a mesh's origin:
   * const worldPos = mesh.toGlobal({ x: 0, y: 1, z: 0 });
   * ```
   * @see {@link Container3D.toLocal} For the reverse conversion.
   * @see {@link Container3D.getGlobalPosition} For this container's own world position.
   */
  public toGlobal<T extends PointLike3D = Vector3>(position: PointData3D, out?: T, skipUpdate = false): T {
    out ??= new Vector3() as unknown as T;

    this.getGlobalTransform(_convertMatrix, skipUpdate);
    _convertVec.copyFrom(position).applyAffineMatrix4(_convertMatrix, out);

    return out;
  }

  /**
   * Converts a point into this container's local space — the 3D counterpart of pixi.js's
   * `Container.toLocal`. `position` is interpreted in `from`'s local space when `from` is
   * given, otherwise in 3D world space (the space of {@link View3D.root}).
   * @param position - the point to convert.
   * @param from - container whose local space `position` is in. Defaults to world space.
   * @param out - point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached world transforms (see {@link Container3D.getGlobalTransform}).
   * @example
   * ```ts
   * // Where is the target mesh, seen from the turret's local space?
   * const aim = turret.toLocal({ x: 0, y: 0, z: 0 }, targetMesh);
   * ```
   * @see {@link Container3D.toGlobal} For the reverse conversion.
   */
  public toLocal<T extends PointLike3D = Vector3>(
    position: PointData3D,
    from?: Container3D,
    out?: T,
    skipUpdate = false,
  ): T {
    out ??= new Vector3() as unknown as T;

    if (from) position = from.toGlobal(position, _convertFromVec, skipUpdate);

    this.getGlobalTransform(_convertMatrix, skipUpdate);
    _convertMatrix.getInverse(_convertMatrix);
    _convertVec.copyFrom(position).applyAffineMatrix4(_convertMatrix, out);

    return out;
  }

  /**
   * Returns this container's own position in 3D world space (the space of {@link View3D.root})
   * — the 3D counterpart of pixi.js's `Container.getGlobalPosition`. Equivalent to
   * `parent.toGlobal(this.position)`; an unparented container returns a copy of its local
   * {@link Container3D.position}.
   * @param out - point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use the cached world transform (see {@link Container3D.getGlobalTransform}).
   * @example
   * ```ts
   * const screenPos = view3d.worldToScreen(mesh.getGlobalPosition());
   * ```
   */
  public getGlobalPosition(out: Vector3 = new Vector3(), skipUpdate = false): Vector3 {
    if (this.parent) return this.parent.toGlobal(this.position, out, skipUpdate);

    return out.copyFrom(this.position);
  }

  /**
   * Prints this container's subtree to the console as an indented tree of `ConstructorName "label"`
   * lines
   *
   * Intended for debugging.
   * @param depth - Indentation level to start at; used by the recursion
   */
  public logHierarchy(depth: number = 0): void {
    const indent = '  '.repeat(depth);
    const type = this.constructor.name;
    const label = this.label ? ` "${this.label}"` : '';
    // oxlint-disable-next-line no-console
    console.log(`${indent}${type}${label}`);

    for (const child of this.children) {
      child.logHierarchy(depth + 1);
    }
  }

  /**
   * Local visibility; setting `false` hides this container and its descendants on the next frame
   *
   * Visibility is temporary and cheap by design: it never changes pass membership —
   * hidden meshes are skipped by the compaction that fills the draw counts, so no draw
   * commands or render bundles rebuild (use `removeChild` to actually leave the scene).
   * Toggling enqueues this node for the next transform pass.
   */
  public get visible(): boolean {
    return !!this._visible;
  }

  /**
   * Sets local visibility and enqueues this node for the next transform pass
   * @param value - Whether this container and its descendants draw
   */
  public set visible(value: boolean) {
    const num = value ? 1 : 0;
    if (this._visible === num) return;
    this._visible = num;
    this._worldVisibleDirty = true;

    if (!this.didChange) {
      this.didChange = true;
      this._view3d?._onChildUpdate(this);
    }

    this.emit('visibleChanged', value);
  }

  /**
   * Effective visibility as a 0|1 mask: 1 only when this node and every ancestor are visible
   *
   * Resolved by the transform pass, so it lags a `visible` change until the next frame. Kept as a
   * number so the render side can multiply it into cull masks instead of branching.
   */
  get worldVisible(): number {
    return this._worldVisible;
  }

  /** The {@link View3D} this node is attached to, or `null` when it isn't in a scene */
  get view3d(): View3D | null {
    return this._view3d;
  }

  /**
   * Observer callback fired by {@link position}, {@link scale}, {@link rotation}, and
   * {@link quaternion} when any component changes
   *
   * Resolves which rotation representation is now authoritative, sets the cascading dirty flags,
   * and enqueues this node into the View's update bucket once per frame.
   * @param pointOrQuat - The observable that changed; identifies the rotation representation
   * @internal
   */
  public _onUpdate(pointOrQuat?: ObservableVector3 | ObservableQuaternion): void {
    if (pointOrQuat) {
      if (pointOrQuat === this._rotation) {
        this.rotationDirty = true;
      } else if (pointOrQuat === this._quaternion) {
        this.rotationDirty = false;
      }

      // position and scale just mark dirty, no special handling needed
    }

    // Local matrix is stale (self-only); world matrix needs rebuild (cascades).
    this._localTransformDirty = true;
    this._worldTransformDirty = true;

    if (this.didChange) return;
    this.didChange = true;

    if (this._view3d) {
      this._view3d._onChildUpdate(this);
    }
  }

  /**
   * Give the GPU memory of this subtree's geometry back now — for a branch of the scene that is
   * out of rotation for a while. Recurses depth-first through each child's own `unload`: every
   * {@link Mesh3D} it reaches gives back its geometry and keeps its CPU-side vertex data, so
   * re-adding the subtree (or simply rendering it again) rebuilds everything, pixel for pixel.
   *
   * Materials are shared far beyond a subtree, so a mesh's unload leaves its material alone. A
   * {@link Model3D} met on the way runs its own override, which does unload the materials its
   * meshes carry. Unload any other material yourself.
   *
   * Idempotent, and free on a container with no meshes under it.
   * @example
   * ```ts
   * view.root.removeChild(level);
   * level.unload(); // hand back the whole level's geometry until it is needed again
   * ```
   * @see {@link Mesh3D.unload} For the per-mesh unload this recurses into.
   * @see {@link Model3D.unload} For the variant that also gives back the textures.
   */
  public unload(): void {
    const children = this.children;
    for (let i = 0; i < children.length; i++) children[i].unload();
  }

  /**
   * Transform-pass hook, fired right after {@link worldTransform} is recomputed
   *
   * A plain container has nowhere to publish its matrix, so this is a no-op. {@link Mesh3D}
   * overrides it to write its store row while the matrix is still in cache.
   * @internal
   */
  public _storeWorldTransform(): void {}

  /**
   * Tears this container down, mirroring pixi.js's `Container.destroy`
   *
   * Detaches it from the scene graph (releasing any {@link View3D} indices), emits
   * {@link Container3DEvents.destroyed}, and drops references. Idempotent — guarded by
   * {@link Container3D.destroyed}.
   *
   * Shared resources are preserved by default: children, and any geometry / materials / textures
   * owned by mesh subclasses, are only destroyed when the matching {@link Destroy3DOptions} flag is
   * set. The same options object is forwarded unchanged to every destroyed child.
   * @param options - `true` destroys everything reachable; an object gates each resource; omitted /
   * `false` releases only this node and its exclusively-owned GPU resources.
   */
  public destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Snapshot children before removal only when we'll recurse — removeChildren empties the live list.
    const destroyChildren = resolveDestroy3DFlag(options, 'children');
    const oldChildren = destroyChildren ? this.children.slice() : null;

    // Detaches each child (firing childRemoved/removed and releasing its View3D
    // indices) before we recurse.
    this.removeChildren(0, this.children.length);

    // Detach this node via its parent's removeChild, running this node's own View3D._detach.
    this.removeFromParent();

    // Listeners observe an already-emptied, already-detached container, matching pixi's order.
    this.emit('destroyed', this);
    this.removeAllListeners();

    if (destroyChildren && oldChildren) {
      for (let i = 0; i < oldChildren.length; i++) {
        oldChildren[i].destroy(options);
      }
    }

    this.parent = null;
    this._view3d = null;

    // Transform components (the origin included) and localTransform/worldTransform are non-nullable
    // CPU-only fields left intact: once detached they are inert (no View3D enqueues this node, no
    // transform pass touches it) and are released with the node.
  }
}
