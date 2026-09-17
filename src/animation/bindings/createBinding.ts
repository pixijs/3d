import { ObservableQuaternion } from '../../math/rotation/ObservableQuaternion';
import { Quaternion } from '../../math/rotation/Quaternion';
import { ObservableVector3 } from '../../math/vector/ObservableVector3';
import { Vector3 } from '../../math/vector/Vector3';
import type { Container3D } from '../../scene/Container3D';
import type { Skeleton } from '../../scene/Skeleton';
import { Binding } from './Binding';
import { FloatArrayBinding } from './FloatArrayBinding';
import { NumberBinding } from './NumberBinding';
import { QuaternionBinding } from './QuaternionBinding';
import { SkeletonPositionBinding } from './SkeletonPositionBinding';
import { SkeletonRotationBinding } from './SkeletonRotationBinding';
import { SkeletonScaleBinding } from './SkeletonScaleBinding';
import { Vector3Binding } from './Vector3Binding';

/**
 * Describes the target property that should receive sampled animation values
 * @internal
 */
interface BindingOptions {
  target?: Container3D;
  channel: string;
  skeleton?: Skeleton;
  boneIndex?: number;
}

/**
 * Ignores animation samples when no supported target property can be resolved
 * @internal
 */
class DummyBinding extends Binding {
  public apply(): void {
    // No-op
  }
}

/**
 * Creates the most direct binding available for a target animation channel
 * @param options - Target, channel, and optional skeleton context to bind
 * @returns A binding that can apply sampled track values to the target
 * @internal
 */
export function createBinding(options: BindingOptions): Binding {
  if (options.skeleton && options.boneIndex !== undefined && options.boneIndex !== -1) {
    const i = options.boneIndex;
    switch (options.channel) {
      case 'position':
        return new SkeletonPositionBinding(options.skeleton, i * 3);
      case 'quaternion':
        return new SkeletonRotationBinding(options.skeleton, i * 4);
      case 'scale':
        return new SkeletonScaleBinding(options.skeleton, i * 3);
    }
  }

  const target = options.target;
  if (!target) return new DummyBinding();

  const channel = options.channel as keyof Container3D;
  const prop = target[channel];

  if (prop instanceof Vector3 || prop instanceof ObservableVector3) {
    return new Vector3Binding(prop);
  } else if (prop instanceof Quaternion || prop instanceof ObservableQuaternion) {
    return new QuaternionBinding(prop);
  } else if (typeof prop === 'number') {
    return new NumberBinding(target, channel);
  } else if (isNumericArray(prop)) {
    return new FloatArrayBinding(prop);
  }

  return new DummyBinding();
}

function isNumericArray(value: unknown): value is Float32Array | Float64Array | number[] {
  return Array.isArray(value) || value instanceof Float32Array || value instanceof Float64Array;
}
