import { Animation } from '../../../../animation/Animation';
import { QuaternionTrack } from '../../../../animation/tracks/QuaternionTrack';
import { Track } from '../../../../animation/tracks/Track';
import type { InterpolationMode, TrackOptions } from '../../../../animation/tracks/Track';
import { Vector3Track } from '../../../../animation/tracks/Vector3Track';
import type { Scene3DSource } from '../../../Scene3DSource';
import type { AnimationChannelTarget, AnimationSampler, GltfFormat } from '../GltfFormat';
import { getBuffer } from '../utils/getBuffer';

const trackClassMap: Record<string, new (options: TrackOptions) => Track> = {
  translation: Vector3Track,
  rotation: QuaternionTrack,
  scale: Vector3Track,
};

const trackPathMap: Record<string, string> = {
  translation: 'position',
  rotation: 'quaternion',
  scale: 'scale',
  weights: 'weights',
};

/**
 * Converts glTF animations into {@link Animation} clips on the source
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers holding the sampler keyframe data
 * @param source - Receives the converted clips
 * @internal
 */
export function processAnimations(gltfRaw: GltfFormat, buffers: ArrayBuffer[], source: Scene3DSource) {
  if (!gltfRaw.animations) return;

  gltfRaw.animations.forEach((animation, index) => {
    const tracks: Track[] = [];

    animation.channels.forEach((channel) => {
      const sampler = animation.samplers[channel.sampler];
      const target = channel.target;

      const track = createTrack(target, sampler, gltfRaw, buffers);

      if (track) tracks.push(track);
    });

    const label = animation.name || `anim_${index}`;

    source.animations[label] = new Animation({
      label,
      tracks,
    });
  });
}

// Per glTF spec: normalized integer accessors map into [-1, 1] for signed and
// [0, 1] for unsigned. KHR_mesh_quantization animation samplers store keyframes
// (notably rotations) as Int16 normalized; interpolation runs in JS so we
// dequantize once up-front. Without this, SLERP sees Int16-magnitude values
// and `sqrt(1 - cos²)` intermittently returns NaN on specific frame pairs,
// producing brief flashes of exploded geometry.
const DEQUANT_NORMALIZED: Record<number, number> = {
  5120: 1 / 127, // INT8
  5121: 1 / 255, // UINT8
  5122: 1 / 32767, // INT16
  5123: 1 / 65535, // UINT16
};

function getBufferAsFloat32(gltfRaw: GltfFormat, buffers: ArrayBuffer[], accessorIndex: number): Float32Array {
  const raw = getBuffer(gltfRaw, buffers, accessorIndex);
  if (raw instanceof Float32Array) return raw;

  const accessor = gltfRaw.accessors![accessorIndex];
  const typedRaw = raw as Int16Array | Uint16Array | Int8Array | Uint8Array;
  const out = new Float32Array(typedRaw.length);

  if (accessor.normalized === true) {
    const scale = DEQUANT_NORMALIZED[accessor.componentType as number] ?? 1;
    const isSigned = accessor.componentType === 5120 || accessor.componentType === 5122;

    // Branch hoisted out of the per-element loop so V8 doesn't re-evaluate
    // the signedness check on every keyframe component.
    if (isSigned) {
      for (let i = 0; i < typedRaw.length; i++) {
        const v = typedRaw[i] * scale;
        out[i] = v < -1 ? -1 : v;
      }
    } else {
      for (let i = 0; i < typedRaw.length; i++) {
        out[i] = typedRaw[i] * scale;
      }
    }
  } else {
    // Native bulk copy — drops into a memcpy-style routine in V8 and is
    // dramatically faster than a JS for-loop for typed-array widening.
    out.set(typedRaw);
  }
  return out;
}

function createTrack(
  target: AnimationChannelTarget,
  sampler: AnimationSampler,
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
) {
  const times = getBufferAsFloat32(gltfRaw, buffers, sampler.input);
  const values = getBufferAsFloat32(gltfRaw, buffers, sampler.output);

  const targetName = target.node!.toString();

  const path = trackPathMap[target.path] ?? target.path;
  const label = `${targetName}.${path}`;
  const interpolation = (sampler.interpolation as InterpolationMode) ?? 'LINEAR';

  if (target.path === 'weights') {
    // Morph weights pack `targetCount` scalars per keyframe. CUBICSPLINE keyframes
    // additionally store in-/out-tangents (3 values per component), so the divisor
    // grows accordingly — Track applies the tangent stride internally from valueSize.
    const componentsPerKeyframe = times.length > 0 ? values.length / times.length : 1;
    const valueSize = interpolation === 'CUBICSPLINE' ? componentsPerKeyframe / 3 : componentsPerKeyframe;

    return new Track({ label, times, values, interpolation, valueSize });
  }

  const TrackClass = trackClassMap[target.path] ?? Vector3Track;

  return new TrackClass({
    label,
    times,
    values,
    interpolation,
  });
}
