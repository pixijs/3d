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
     * Declare the added members here and add their implementation with pixi.js's
     * `extensions.mixin(Container3D, myMixin)`, as pixi's 2D `Container` does.
     */
    interface Container3D {}
    /** Augmentation hook for extra {@link Container3DOptions} members */
    interface Container3DOptions {}
    /** Augmentation hook for extra {@link Container3DEvents} event signatures */
    interface Container3DEvents {}
  }
}

let UID = 0;

const _lookAtParentWorld = new Matrix4();
const _lookAtPos = new Vector3();
const _lookAtMatrix = new Matrix4();
const _lookAtWorldQuat = new Quaternion();
const _lookAtParentQuat = new Quaternion();
const _lookAtDefaultUp: PointData3D = { x: 0, y: 1, z: 0 };

const _originOffset = new Vector3();

const _convertMatrix = new Matrix4();
const _convertVec = new Vector3();
const _convertFromVec = new Vector3();

const _reparentChildWorld = new Matrix4();
const _reparentParentWorld = new Matrix4();
const _reparentPos = new Vector3();
const _reparentScale = new Vector3();
const _reparentQuat = new Quaternion();

const _measureBox = new Box();

function scaleForSize(size: number, localSize: number, currentScale: number): number {
  const sign = Math.sign(currentScale) || 1;

  return localSize !== 0 ? (size / localSize) * sign : sign;
}

/** Returns `false` for an unlabelled node first, since a pattern would test the string `'null'` */
function labelMatches(value: string | null, label: string | RegExp): boolean {
  if (value === null) return false;

  return value === label || (label instanceof RegExp && label.test(value));
}

/**
 * Width, height and depth of a {@link Container3D}, as returned by {@link Container3D.getSize}
 * @example
 * ```ts
 * const { width, height, depth }: Size3D = model.getSize();
 *
 * crate.setSize({ width: 2, height: 1, depth: 1 });
 * ```
 * @category scene
 * @standard
 */
export interface Size3D {
  /** Extent along x */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- result field, read back from getSize
  width: number;
  /** Extent along y */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- result field, read back from getSize
  height: number;
  /** Extent along z */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- result field, read back from getSize
  depth: number;
}

/**
 * Events a {@link Container3D} emits, with the same names and payloads as pixi's 2D `Container`
 *
 * Listen with `on`, `once` and `off`. The pointer events, such as `pointerdown` and `click`, are
 * typed here too.
 * @example
 * ```ts
 * level.on('childAdded', (child) => colliders.add(child));
 * level.on('childRemoved', (child) => colliders.delete(child));
 * ```
 * @category scene
 * @standard
 */
export interface Container3DEvents extends PixiMixins.Container3DEvents {
  /**
   * Emitted on a child after it joins a parent; passes the parent
   * @example
   * ```ts
   * enemy.on('added', () => enemyCount++);
   * ```
   */
  added: [container: Container3D];
  /**
   * Emitted on a child after it leaves its parent; passes the former parent
   * @example
   * ```ts
   * enemy.on('removed', () => enemyCount--);
   * ```
   */
  removed: [container: Container3D];
  /**
   * Emitted on a parent after it gains a child; passes the child, this parent and the child's
   * index
   * @example
   * ```ts
   * level.on('childAdded', (child) => colliders.add(child));
   * ```
   */
  childAdded: [child: Container3D, container: Container3D, index: number];
  /**
   * Emitted on a parent after it loses a child; passes the child, this parent and an index
   *
   * From `removeChild`, the index is where the child was. From `removeChildren`, it is the child's
   * place in the returned array, as in pixi.
   * @example
   * ```ts
   * level.on('childRemoved', (child) => colliders.delete(child));
   * ```
   */
  childRemoved: [child: Container3D, container: Container3D, index: number];
  /**
   * Emitted once {@link Container3D.destroy} has emptied and detached this container; passes the
   * container
   * @example
   * ```ts
   * crate.once('destroyed', () => colliders.delete(crate));
   * ```
   */
  destroyed: [container: Container3D];
  /**
   * Emitted when {@link Container3D.visible} changes value; passes the new value
   * @example
   * ```ts
   * door.on('visibleChanged', (visible) => {
   *   doorCollider.enabled = visible;
   * });
   * ```
   */
  visibleChanged: [visible: boolean];
}

/**
 * Constructor options for {@link Container3D}, the 3D counterpart of pixi.js's `ContainerOptions`
 *
 * A key set to `undefined` is skipped. The rest apply in the order you write them, as if assigned
 * afterwards, so `{ position, x }` ends with `x`, and of `rotation`, `angle` and `quaternion` the
 * last one wins. `children`, `hitVolume`, `width`, `height` and `depth` wait until after the rest,
 * in that order, so a `'box'` hit volume and the sizes measure the children.
 *
 * The interaction options, such as `eventMode`, `cursor` and the `on*` handlers, are accepted
 * too, and take effect once the node joins a {@link View3D}'s scene.
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
   * Name to find the node by; see {@link Container3D#label}
   * @default null
   * @example
   * ```ts
   * const turret = new Container3D({ label: 'turret' });
   * ```
   */
  label?: string | null;
  /**
   * Local position
   * @default { x: 0, y: 0, z: 0 }
   * @example
   * ```ts
   * const lamp = new Container3D({ position: { x: 0, y: 3, z: 0 } });
   * ```
   */
  position?: PointData3D;
  /**
   * Local position on x; the same as `position.x`
   * @example
   * ```ts
   * const left = new Container3D({ x: -2 });
   * ```
   */
  x?: number;
  /**
   * Local position on y; the same as `position.y`
   * @example
   * ```ts
   * const shelf = new Container3D({ y: 1.2 });
   * ```
   */
  y?: number;
  /**
   * Local position on z; the same as `position.z`
   * @example
   * ```ts
   * const back = new Container3D({ z: -5 });
   * ```
   */
  z?: number;
  /**
   * Local scale; a number scales all three axes
   * @default 1
   * @example
   * ```ts
   * const giant = new Container3D({ scale: 3 });
   * ```
   */
  scale?: PointData3D | number;
  /**
   * Local rotation as Euler angles in radians: turns around Z, then Y, then X, each about the parent's axes
   * @default { x: 0, y: 0, z: 0 }
   * @example
   * ```ts
   * const turned = new Container3D({ rotation: { x: 0, y: Math.PI / 2, z: 0 } });
   * ```
   */
  rotation?: PointData3D;
  /**
   * Local rotation as Euler angles in degrees: turns around Z, then Y, then X, each about the parent's axes
   * @default { x: 0, y: 0, z: 0 }
   * @example
   * ```ts
   * const turned = new Container3D({ angle: { x: 0, y: 90, z: 0 } });
   * ```
   */
  angle?: PointData3D;
  /**
   * Local rotation as a unit quaternion
   * @default { x: 0, y: 0, z: 0, w: 1 }
   * @example
   * ```ts
   * const turned = new Container3D({ quaternion: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } });
   * ```
   */
  quaternion?: QuaternionData;
  /**
   * Point in local space that rotation and scale happen around; see {@link Container3D#origin}
   * @default { x: 0, y: 0, z: 0 }
   * @example
   * ```ts
   * const hinge = new Container3D({ origin: { x: 0.5, y: 0, z: 0 } });
   * ```
   */
  origin?: PointData3D | number;
  /**
   * Whether this node and its descendants draw
   * @default true
   * @example
   * ```ts
   * const hiddenUntilSpawn = new Container3D({ visible: false });
   * ```
   */
  visible?: boolean;
  /**
   * Target width along x; sets `scale.x` from the local bounds of the node and its `children`
   * @example
   * ```ts
   * const crate = new Container3D({ children: [crateMesh], width: 2 });
   * ```
   */
  width?: number;
  /**
   * Target height along y; sets `scale.y` from the local bounds of the node and its `children`
   * @example
   * ```ts
   * const tree = new Container3D({ children: [treeMesh], height: 6 });
   * ```
   */
  height?: number;
  /**
   * Target depth along z; sets `scale.z` from the local bounds of the node and its `children`
   * @example
   * ```ts
   * const bench = new Container3D({ children: [benchMesh], depth: 0.5 });
   * ```
   */
  depth?: number;
  /**
   * Fixed local-space box used in place of this node's subtree when measuring bounds; see
   * {@link Container3D.boundsVolume}
   * @example
   * ```ts
   * const swarm = new Container3D({ boundsVolume: new Box(new Vector3(-10, 0, -10), new Vector3(10, 5, 10)) });
   * ```
   */
  boundsVolume?: Box;
  /**
   * Children to add, in order
   * @example
   * ```ts
   * const car = new Container3D({ children: [body, frontWheels, rearWheels] });
   * ```
   */
  children?: Container3D[];
  /**
   * Parent to add this node to, once everything else is applied
   * @example
   * ```ts
   * const crate = new Container3D({ label: 'crate', parent: view.root });
   * ```
   */
  parent?: Container3D;
}

/**
 * Keys the constructor applies after the rest: `children` and `parent` go through `addChild`, and
 * `hitVolume: 'box'` and the sizes measure the children
 */
const OPTIONS_APPLIED_LATER: Record<string, boolean> = {
  children: true,
  hitVolume: true,
  parent: true,
  width: true,
  height: true,
  depth: true,
};

// oxlint-disable-next-line pixijs-3d/require-export-jsdoc, pixijs-3d/require-member-api-doc
export interface Container3D extends PixiMixins.Container3D {}

/** `{} & string` keys rather than `string`, which would swallow the literal keys of the known events */
type AnyEvent = {
  // oxlint-disable-next-line typescript/no-explicit-any -- custom event payloads are untyped, as on pixi's Container
  [K: ({} & string) | ({} & symbol)]: any;
};

/**
 * A node in a 3D scene, the 3D counterpart of pixi.js's `Container`
 *
 * It has a local transform, made of {@link Container3D.position | position},
 * {@link Container3D.scale | scale} and a rotation set through either
 * {@link Container3D.rotation | rotation} or {@link Container3D.quaternion | quaternion}, plus a
 * parent and children. Put it under a view's {@link View3D.root | root}, at any depth, and the
 * view draws the meshes and uses the lights in its subtree.
 *
 * Changing a transform only marks the node. The view works out world transforms once per frame,
 * however many changes you make. The child methods and events match pixi's `Container`.
 * @example
 * ```ts
 * const arm = new Container3D();
 * arm.position.set(0, 1, 0);
 *
 * const hand = new Container3D();
 * hand.scale.set(2);
 * arm.addChild(hand);
 *
 * arm.lookAt({ x: 0, y: 0, z: 0 });
 * ```
 * @see {@link Container3DOptions} For the constructor options.
 * @category scene
 * @standard
 */
export class Container3D extends EventEmitter<Container3DEvents & AnyEvent> {
  /**
   * Unique id, assigned at construction
   * @advanced
   */
  public readonly uid: number = UID++;

  /**
   * Name to find the node by, with {@link Container3D.getChildByLabel | getChildByLabel}
   *
   * Animation tracks find their target by it too. A plain `Container3D` starts with `null`;
   * built-in subclasses such as `Mesh3D` start with their class name.
   * @example
   * ```ts
   * turret.label = 'turret';
   * tank.getChildByLabel('turret', true)?.lookAt(target);
   * ```
   */
  public label: string | null = null;

  /**
   * Whether the next {@link Container3D.updateLocalTransform} rebuilds the quaternion from
   * `rotation`; that call clears it, so copy it first
   * @internal
   */
  public rotationDirty = false;

  /**
   * Local transform matrix, built from the position, rotation, scale and
   * {@link Container3D.origin | origin}
   *
   * It catches up with changes in the view's transform pass, or when you call
   * {@link Container3D.updateLocalTransform | updateLocalTransform}. Read it, but change the
   * components instead: the next rebuild overwrites it.
   */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- rebuilt by the view, never set by hand
  public localTransform: Matrix4 = new Matrix4();
  /**
   * World transform: the parent's world transform times this node's
   * {@link Container3D.localTransform | localTransform}
   *
   * The view updates it once per frame, before drawing, for visible nodes only, and not at all
   * while the view holds no mesh. So it can be out of date after a change this frame or while the
   * node or an ancestor is hidden, and a node outside any view keeps the identity matrix.
   * {@link Container3D.getGlobalTransform | getGlobalTransform} always works out a current one.
   */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- rebuilt by the view, never set by hand
  public worldTransform: Matrix4 = new Matrix4();

  private readonly _position = new ObservableVector3(this, 0, 0, 0);
  private readonly _scale = new ObservableVector3(this, 1, 1, 1);
  private readonly _rotation = new ObservableVector3(this, 0, 0, 0);
  private readonly _quaternion = new ObservableQuaternion(this, 0, 0, 0, 1);
  private _angle: EulerDegrees | null = null;
  /** `null` until {@link Container3D.origin} is first read, so a node without one skips the origin maths */
  protected _origin: ObservableVector3 | null = null;

  /**
   * Child nodes
   *
   * Their order doesn't decide what draws first. Read the array, but change it through
   * {@link Container3D.addChild | addChild} and {@link Container3D.removeChild | removeChild}.
   * To visit the whole subtree, use {@link Container3D.traverse | traverse}.
   * @example
   * ```ts
   * for (const child of group.children) child.visible = false;
   * ```
   */
  public children: Container3D[] = [];

  /** Parent node, or `null` for a node with none, such as a view's root */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- set by addChild and removeChild, never by hand
  public parent: Container3D | null = null;

  /** @internal */
  public _view3d: View3D | null = null;

  /**
   * A fixed local-space box measured in place of this container and its subtree, or `null` to
   * measure the geometry
   *
   * Set one on a large subtree whose extent you already know, such as a level chunk, to skip walking
   * it. {@link Container3D.getLocalBounds | getLocalBounds} and the size members read it. It's pixi's
   * `boundsArea`; it doesn't change culling.
   * @example
   * ```ts
   * swarm.boundsVolume = new Box(new Vector3(-10, 0, -10), new Vector3(10, 5, 10));
   * ```
   */
  public boundsVolume: Box | null = null;

  /** Whether {@link Container3D.destroy | destroy} has run, as in pixi's `Container` */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only state
  public destroyed = false;

  /** Set while this node waits for a transform pass, so it's queued once @internal */
  public didChange = false;

  /** @internal */
  public _worldTransformDirty = true;

  /** @internal */
  public _worldVisibleDirty = true;

  /** @internal */
  public _localTransformDirty = false;

  /** 0 or 1 rather than a boolean, so the visibility pass multiplies instead of branching @internal */
  public _visible = 1;

  /** @internal */
  public _worldVisible = 1;

  /** @internal */
  public _updateTick = -1;

  /** @internal */
  public _relativeSceneDepth = 0;

  /**
   * Whether the scene update rewrites this node's whole store row; a move or a visibility flip
   * doesn't need it, since the transform pass writes those lanes
   * @internal
   */
  public _storeDirty = false;

  /** Bumped each time {@link Container3D.worldTransform} is recomputed @internal */
  public _worldTransformId = 0;

  /** @internal */
  protected _lookAtForwardIsPositiveZ: boolean = true;

  constructor(options: Container3DOptions = {}) {
    super();

    assignWithIgnore(this as Container3DOptions, options, OPTIONS_APPLIED_LATER);

    const { children, hitVolume, width, height, depth, parent } = options;

    if (children) {
      for (let i = 0; i < children.length; i++) this.addChild(children[i]);
    }

    if (hitVolume !== undefined) this.hitVolume = hitVolume;

    if (width !== undefined) this.width = width;
    if (height !== undefined) this.height = height;
    if (depth !== undefined) this.depth = depth;

    parent?.addChild(this);
  }

  /**
   * Local position
   *
   * Assigning copies the values in; the object itself never changes.
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
   * Sets the local position
   * @param value - The new position
   */
  set position(value: PointData3D) {
    this._position.copyFrom(value);
  }

  /**
   * Local scale
   *
   * Assigning copies the values in, and a single number scales all three axes; the object itself
   * never changes.
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
   * Sets the local scale; a number sets all three axes
   * @param value - The new scale
   */
  set scale(value: PointData3D | number) {
    if (typeof value === 'number') this._scale.set(value);
    else this._scale.copyFrom(value);
  }

  /**
   * Local rotation as Euler angles in radians: turns around Z, then Y, then X, each about the parent's axes
   *
   * The node keeps both this and {@link Container3D.quaternion | quaternion}, and whichever you
   * set last is the rotation in use. Assigning copies the values in. Writing unchanged values to
   * either through a component, `set` or `copyFrom` doesn't switch which one is in use; assign it
   * whole.
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
   * Sets the Euler rotation and makes it the rotation in use, even when the values are unchanged
   * @param value - The new Euler angles, in radians
   */
  set rotation(value: PointData3D) {
    this._rotation.copyFrom(value);

    if (!this.rotationDirty) this._onUpdate(this._rotation);
  }

  /**
   * {@link Container3D.rotation | rotation} in degrees, as in pixi.js
   *
   * It reads and writes `rotation`, so the two always agree. Reading converts back from radians, so
   * a value can come back a hair off, such as 30 as 29.999999999999996; compare with a tolerance.
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
   * Sets the Euler rotation and makes it the rotation in use, even when the values are unchanged
   * @param value - The new Euler angles, in degrees
   */
  set angle(value: PointData3D) {
    this._rotation.set(value.x * DEG_TO_RAD, value.y * DEG_TO_RAD, value.z * DEG_TO_RAD);

    if (!this.rotationDirty) this._onUpdate(this._rotation);
  }

  /**
   * Local rotation as a unit quaternion; see {@link Container3D.rotation | rotation} for which of
   * the two is in use
   *
   * Assigning copies the values in, so `node.quaternion = other.quaternion` doesn't link the two.
   * @example
   * ```ts
   * node.quaternion = other.quaternion;
   * node.quaternion = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
   * ```
   */
  get quaternion(): ObservableQuaternion {
    return this._quaternion;
  }

  /**
   * Sets the quaternion and makes it the rotation in use, even when the values are unchanged
   * @param value - The new rotation, as a unit quaternion
   */
  set quaternion(value: QuaternionData) {
    this._quaternion.copyFrom(value);

    if (this.rotationDirty) this._onUpdate(this._quaternion);
  }

  /**
   * Point in local space that rotation and scale happen around, as in pixi.js
   *
   * Unlike a pivot, it leaves an unrotated, unscaled node where it is: the origin sits at
   * `position + origin` in the parent. Assigning copies the values in, and a single number sets
   * all three axes.
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
   * Sets the origin; a number sets all three axes
   * @param value - The new origin, in local space
   */
  set origin(value: PointData3D | number) {
    const origin = this.origin;

    if (typeof value === 'number') origin.set(value);
    else origin.copyFrom(value);
  }

  /**
   * Local position on the x axis; the same as `position.x`
   * @example
   * ```ts
   * player.x += speed * dt;
   * ```
   */
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

  /**
   * Local position on the y axis; the same as `position.y`
   * @example
   * ```ts
   * ball.y = Math.abs(Math.sin(time)) * 2;
   * ```
   */
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

  /**
   * Local position on the z axis; the same as `position.z`
   * @example
   * ```ts
   * if (car.z > finishLine) finish();
   * ```
   */
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
   * A child with another parent leaves it first. A child that is already here moves to the end,
   * without events.
   * @example
   * ```ts
   * view.root.addChild(crate, lamp);
   * ```
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
   * Removes one or more children from this container; a node that isn't a child is ignored
   * @example
   * ```ts
   * view.root.removeChild(crate);
   * ```
   * @param children - The children to remove
   * @returns The first child passed in
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
   * Removes the children from `beginIndex` up to, but not including, `endIndex`
   * @example
   * ```ts
   * const debris = level.removeChildren();
   * ```
   * @param beginIndex - First index to remove
   * @param endIndex - End of the range, exclusive; defaults to the child count
   * @returns The removed children, last child first
   * @throws {RangeError} When `beginIndex` is negative or past `endIndex`, or equal to it while
   * this container has children.
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
   * @example
   * ```ts
   * const newest = queue.removeChildAt(queue.children.length - 1);
   * ```
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
   * @example
   * ```ts
   * const first = group.getChildAt(0);
   * ```
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
   * @example
   * ```ts
   * const slot = rack.getChildIndex(sword);
   * ```
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
   * @example
   * ```ts
   * rack.setChildIndex(sword, 0);
   * ```
   * @param child - The child to move
   * @param index - The destination index
   * @throws {Error} When `index` is out of bounds or `child` is not a child of this container.
   */
  public setChildIndex(child: Container3D, index: number): void {
    if (index < 0 || index >= this.children.length) {
      throw new Error(`setChildIndex: The index ${index} supplied is out of bounds ${this.children.length}.`);
    }

    this.getChildIndex(child);

    this.addChildAt(child, index);
  }

  /**
   * Adds `child` at `index`, or moves it there when it is already a child of this container
   *
   * A move within this container emits no events.
   * @example
   * ```ts
   * rack.addChildAt(sword, 0);
   * ```
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
   * Swaps the places of two children in this container's list
   * @example
   * ```ts
   * rack.swapChildren(sword, shield);
   * ```
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
   * Each container checks its direct children before searching inside them. An unlabelled node
   * never matches, even a pattern.
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
   * Collects every child whose label matches, in the order {@link Container3D.getChildByLabel}
   * visits them
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

  /**
   * Calls `callback` with this container, then with every container under it, depth first
   *
   * Each container comes before its children, and hidden ones are visited too. A {@link Skeleton}'s
   * bones and a {@link BatchedMesh3D}'s {@link BatchedMesh3D.items | items} aren't containers, so
   * the walk doesn't reach them. It can't stop early or skip a subtree.
   *
   * The callback may remove, destroy or {@link Container3D.replaceChild | replace} the container
   * it's given. A container it adds with {@link Container3D.addChild | addChild} is visited only if
   * its new parent hasn't been visited yet. Other changes to the tree during the walk can skip a
   * container or visit one twice.
   * @example
   * ```ts
   * const robot = new Model3D(source);
   *
   * robot.traverse((container) => {
   *   if (container instanceof Mesh3D) container.enablePass('outline');
   * });
   * ```
   * @param callback - Called once with each container, this one first
   */
  public traverse(callback: (container: Container3D) => void): void {
    const children = this.children;
    let count = children.length;

    callback(this);

    for (let i = 0; i < count && i < children.length;) {
      const child = children[i];
      const next = children[i + 1];

      child.traverse(callback);

      if (children[i] === next) count--;
      else i++;
    }
  }

  /**
   * Removes this container from its parent, if it has one
   * @example
   * ```ts
   * pickup.removeFromParent();
   * ```
   */
  public removeFromParent(): void {
    this.parent?.removeChild(this);
  }

  /**
   * Moves one or more nodes under this container without moving them in the world; see
   * {@link Container3D.reparentChildAt | reparentChildAt}
   * @example
   * ```ts
   * hand.reparentChild(sword);
   * ```
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
   * Moves `child` under this container at `index` without moving it in the world
   *
   * Its local position, rotation and scale change so that it renders where it did, and it keeps
   * its {@link Container3D.origin | origin}. Unlike pixi, it uses current world transforms, so a
   * move earlier in the frame counts. A child that is already here only changes index.
   * @example
   * ```ts
   * rack.reparentChildAt(sword, 0);
   * ```
   * @param child - The child to reparent
   * @param index - The destination index
   * @returns The reparented child
   */
  public reparentChildAt<U extends Container3D>(child: U, index: number): U {
    if (child.parent === this) {
      this.setChildIndex(child, index);

      return child;
    }

    updateTransformBackwards3D(child, _reparentChildWorld);
    if (child._localTransformDirty) {
      child.updateLocalTransform();
      child._localTransformDirty = false;
    }
    _reparentChildWorld.multiply(child.localTransform);

    child.removeFromParent();
    this.addChildAt(child, index);

    updateTransformBackwards3D(this, _reparentParentWorld);
    if (this._localTransformDirty) {
      this.updateLocalTransform();
      this._localTransformDirty = false;
    }
    _reparentParentWorld.multiply(this.localTransform);

    _reparentParentWorld.getInverse(_reparentParentWorld);
    _reparentChildWorld.premultiply(_reparentParentWorld);
    _reparentChildWorld.decompose(_reparentPos, _reparentQuat, _reparentScale);

    child.scale.copyFrom(_reparentScale);
    child.quaternion.copyFrom(_reparentQuat);

    if (child._origin !== null) {
      child.updateLocalTransform();
      _reparentPos.subtract(child._getOriginOffset(_originOffset));
    }

    child.position.copyFrom(_reparentPos);

    return child;
  }

  /**
   * Replaces `oldChild` with `newChild` at the same index, copying `oldChild`'s local position,
   * rotation and scale onto `newChild`
   *
   * `newChild` keeps its own {@link Container3D.origin | origin}, and its position is solved so it
   * sits exactly where `oldChild` did.
   * @example
   * ```ts
   * car.replaceChild(flatTyre, spareWheel);
   * ```
   * @param oldChild - The child to replace
   * @param newChild - The child that takes its place
   * @throws {Error} When `oldChild` is not a child of this container.
   */
  public replaceChild<U extends Container3D, T extends Container3D>(oldChild: U, newChild: T): void {
    const index = this.getChildIndex(oldChild);

    this.addChildAt(newChild, index);

    newChild.scale.copyFrom(oldChild.scale);
    newChild.rotation.copyFrom(oldChild.rotation);
    newChild.quaternion.copyFrom(oldChild.quaternion);
    newChild.rotationDirty = oldChild.rotationDirty;

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
   * Rebuilds {@link Container3D.localTransform | localTransform} from the position, rotation,
   * scale and {@link Container3D.origin | origin}
   *
   * The view calls it for each node that changed, so you only need it to read a current
   * `localTransform` before the next frame. When {@link Container3D.rotation | rotation} is the
   * rotation in use, it updates the quaternion to match.
   * @example
   * ```ts
   * crate.rotation.y = Math.PI / 4;
   * crate.updateLocalTransform();
   * const local = crate.localTransform.clone();
   * ```
   * @advanced
   */
  public updateLocalTransform(): void {
    const quat = this._quaternion;

    if (this.rotationDirty) {
      this.rotationDirty = false;

      const rx = this._rotation._x;
      const ry = this._rotation._y;
      const rz = this._rotation._z;

      const c1 = Math.cos(rx / 2);
      const c2 = Math.cos(ry / 2);
      const c3 = Math.cos(rz / 2);

      const s1 = Math.sin(rx / 2);
      const s2 = Math.sin(ry / 2);
      const s3 = Math.sin(rz / 2);

      quat._x = s1 * c2 * c3 + c1 * s2 * s3;
      quat._y = c1 * s2 * c3 - s1 * c2 * s3;
      quat._z = c1 * c2 * s3 + s1 * s2 * c3;
      quat._w = c1 * c2 * c3 - s1 * s2 * s3;
    }

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

  /** Adds the {@link Container3D.origin | origin} offset to the local matrix; only call when `_origin` is set */
  protected _addOriginOffset(): void {
    const offset = this._getOriginOffset(_originOffset);
    const out = this.localTransform.elements;

    out[12] += offset.x;
    out[13] += offset.y;
    out[14] += offset.z;
  }

  /**
   * Writes `origin - M·origin` into `out`, M being `localTransform`'s basis, so rebuild that first;
   * only call when `_origin` is set. `Sprite3D` overrides it, since its basis also carries its size
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
   * Measures the bounding box of this container and its descendants, in this container's local
   * space
   *
   * A subtree with a {@link Container3D.boundsVolume | boundsVolume} counts as that box. Hidden
   * descendants are left out; this container counts whether or not it is visible. An empty subtree
   * measures as a zero box at the origin. Each call walks the subtree, so cache the result if you
   * need it every frame.
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
   * @example
   * ```ts
   * tree.height = 6;
   * ```
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
   * @example
   * ```ts
   * bench.depth = 0.5;
   * ```
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
   * A missing `height` or `depth` takes the width. An axis whose local extent is zero, such as a
   * flat plane's depth, keeps a unit scale. The sign of each scale axis is kept, so a mirrored node
   * stays mirrored.
   * @param value - Target width, or an object with `width` and optional `height` / `depth`
   * @param height - Target height; defaults to the width
   * @param depth - Target depth; defaults to the width
   * @example
   * ```ts
   * model.setSize(2); // stretch each axis to 2
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
   * Turns this node so its forward axis, local +Z, points at a world-space `target`
   *
   * Cameras and lights aim local -Z instead. The node aims from `position + origin`, and uses the
   * parent's current world transform, so a move earlier in the frame counts.
   * @example
   * ```ts
   * turret.lookAt(enemy.getGlobalPosition());
   * ```
   * @param target - World-space point to face
   * @param up - World-space up reference; defaults to `(0, 1, 0)`
   */
  public lookAt(target: PointData3D, up: PointData3D = _lookAtDefaultUp): void {
    updateTransformBackwards3D(this, _lookAtParentWorld.identity());

    _lookAtPos.copyFrom(this.position);
    if (this._origin !== null) _lookAtPos.add(this._origin);
    _lookAtPos.applyAffineMatrix4(_lookAtParentWorld);

    if (this._lookAtForwardIsPositiveZ) {
      _lookAtMatrix.lookAt(target, _lookAtPos, up);
    } else {
      _lookAtMatrix.lookAt(_lookAtPos, target, up);
    }
    _lookAtWorldQuat.setFromRotationMatrix(_lookAtMatrix);

    if (this.parent) {
      _lookAtParentQuat.setFromScaledRotationMatrix(_lookAtParentWorld);
      _lookAtParentQuat.inverse();
      _lookAtWorldQuat.premultiply(_lookAtParentQuat);
    }

    this.quaternion.copyFrom(_lookAtWorldQuat);
  }

  /**
   * Works out this container's current world transform into `out`
   *
   * It walks up the parent chain, so the result is right even before the view's transform pass
   * has run this frame. With `skipUpdate` it copies the cached
   * {@link Container3D.worldTransform | worldTransform} instead, which is cheaper but can be stale.
   * @param out - Matrix the result is written into. Defaults to a new `Matrix4`.
   * @param skipUpdate - `true` to copy the cached world transform instead of recomputing.
   * @example
   * ```ts
   * const world = mesh.getGlobalTransform();
   * const localRay = ray.applyMatrix4(world.getInverse(world), new Ray());
   * ```
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
   * Converts a point from this container's local space to world space
   *
   * Pass the result to {@link View3D.worldToScreen} to go on to 2D screen coordinates.
   * @param position - The local-space point to convert.
   * @param out - Point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use the cached world transform (see {@link Container3D.getGlobalTransform}).
   * @example
   * ```ts
   * const aboveHead = player.toGlobal({ x: 0, y: 2, z: 0 });
   * ```
   * @see {@link Container3D.getGlobalPosition} For this container's own world position.
   */
  public toGlobal<T extends PointLike3D = Vector3>(position: PointData3D, out?: T, skipUpdate = false): T {
    out ??= new Vector3() as unknown as T;

    this.getGlobalTransform(_convertMatrix, skipUpdate);
    _convertVec.copyFrom(position).applyAffineMatrix4(_convertMatrix, out);

    return out;
  }

  /**
   * Converts a point into this container's local space
   * @param position - The point to convert.
   * @param from - Container whose local space `position` is in. Defaults to world space.
   * @param out - Point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached world transforms (see {@link Container3D.getGlobalTransform}).
   * @example
   * ```ts
   * const targetFromTurret = turret.toLocal({ x: 0, y: 0, z: 0 }, target);
   * ```
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
   * Returns this container's position in world space: `parent.toGlobal(this.position)`, or a copy
   * of `position` with no parent
   * @param out - Point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use the parent's cached world transform (see
   *   {@link Container3D.getGlobalTransform}); this node's own `position` is always read as it stands.
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
   * lines, for debugging
   * @example
   * ```ts
   * model.logHierarchy();
   * ```
   * @param depth - Indentation level to start at; used by the recursion
   * @advanced
   */
  public logHierarchy(depth: number = 0): void {
    const indent = '  '.repeat(depth);
    const type = this.constructor.name;
    const label = this.label ? ` "${this.label}"` : '';
    // oxlint-disable-next-line no-restricted-globals -- logHierarchy prints by design
    console.log(`${indent}${type}${label}`);

    for (const child of this.children) {
      child.logHierarchy(depth + 1);
    }
  }

  /**
   * Whether this container and its descendants draw
   *
   * Hiding is cheap, and a hidden node stays in the scene; to take it out, remove it with
   * {@link Container3D.removeChild | removeChild}. Emits
   * {@link Container3DEvents.visibleChanged | visibleChanged} when the value changes.
   * @example
   * ```ts
   * door.visible = false;
   * ```
   */
  public get visible(): boolean {
    return !!this._visible;
  }

  /**
   * Shows or hides this container and its descendants
   * @param value - Whether they draw
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
   * `1` when this node and every ancestor are visible, otherwise `0`
   *
   * The view works it out once per frame, so it lags a `visible` change until the next render.
   */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only state
  get worldVisible(): number {
    return this._worldVisible;
  }

  /** The {@link View3D} this node is in, or `null` when it isn't in a scene */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only state
  get view3d(): View3D | null {
    return this._view3d;
  }

  /** @internal */
  public _onUpdate(pointOrQuat?: ObservableVector3 | ObservableQuaternion): void {
    if (pointOrQuat) {
      if (pointOrQuat === this._rotation) {
        this.rotationDirty = true;
      } else if (pointOrQuat === this._quaternion) {
        this.rotationDirty = false;
      }
    }

    this._localTransformDirty = true;
    this._worldTransformDirty = true;

    if (this.didChange) return;
    this.didChange = true;

    if (this._view3d) {
      this._view3d._onChildUpdate(this);
    }
  }

  /**
   * Unloads the geometry of every mesh in this subtree, for a part of the scene you'll show again
   * later
   *
   * Each {@link Mesh3D.unload | mesh} keeps its vertex data, so the next render that draws it
   * uploads it again; remove the subtree from the scene first. {@link Geometry3D.unload} says what
   * GPU memory that frees. Materials are left alone, since
   * they're usually shared, except under a {@link Model3D}, which unloads its own; unload any other
   * material yourself.
   * @example
   * ```ts
   * view.root.removeChild(level);
   * level.unload();
   * ```
   */
  public unload(): void {
    const children = this.children;
    for (let i = 0; i < children.length; i++) children[i].unload();
  }

  /** Called by the transform pass right after {@link Container3D.worldTransform} is recomputed @internal */
  public _storeWorldTransform(): void {}

  /** Called by the transform pass right after {@link Container3D.worldVisible} is recomputed @internal */
  public _storeWorldVisible(): void {}

  /**
   * Destroys this container: it removes its children, leaves its parent and its view, emits
   * {@link Container3DEvents.destroyed | destroyed}, and drops its listeners
   *
   * Children, and the geometry, materials and textures a mesh uses, are destroyed only when the
   * matching {@link Destroy3DOptions} flag is set, and destroyed children get the same `options`.
   * Unlike pixi, `position`, `scale` and the transform matrices stay readable afterwards. Calling
   * it again does nothing.
   * @example
   * ```ts
   * crate.destroy({ children: true });
   * ```
   * @param options - `true` destroys everything reachable; an object picks each resource; left
   * out or `false`, only this node and the GPU resources it alone owns go.
   */
  public destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const destroyChildren = resolveDestroy3DFlag(options, 'children');
    const oldChildren = destroyChildren ? this.children.slice() : null;

    this.removeChildren(0, this.children.length);

    this.removeFromParent();

    this.emit('destroyed', this);
    this.removeAllListeners();

    if (destroyChildren && oldChildren) {
      for (let i = 0; i < oldChildren.length; i++) {
        oldChildren[i].destroy(options);
      }
    }

    this.parent = null;
    this._view3d = null;
  }
}
