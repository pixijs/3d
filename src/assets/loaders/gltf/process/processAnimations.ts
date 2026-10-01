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

/**
 * The scale from a normalized integer to its float, per component type: 5120 BYTE, 5121
 * UNSIGNED_BYTE, 5122 SHORT and 5123 UNSIGNED_SHORT
 */
const DEQUANT_NORMALIZED: Record<number, number> = {
  5120: 1 / 127,
  5121: 1 / 255,
  5122: 1 / 32767,
  5123: 1 / 65535,
};

/**
 * Reads keyframe times or values as floats
 *
 * `KHR_mesh_quantization` lets keyframes, rotations above all, be stored as normalized integers.
 * Interpolation runs on the CPU, so they are converted here, once: left as integers, a quaternion
 * slerp would see values far outside -1 to 1 and produce NaN. Signed values clamp at -1, as the
 * glTF formula does.
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers holding the keyframe data
 * @param accessorIndex - Index of the accessor to read
 */
function getBufferAsFloat32(gltfRaw: GltfFormat, buffers: ArrayBuffer[], accessorIndex: number): Float32Array {
  const raw = getBuffer(gltfRaw, buffers, accessorIndex);
  if (raw instanceof Float32Array) return raw;

  const accessor = gltfRaw.accessors![accessorIndex];
  const typedRaw = raw as Int16Array | Uint16Array | Int8Array | Uint8Array;
  const out = new Float32Array(typedRaw.length);

  if (accessor.normalized === true) {
    const scale = DEQUANT_NORMALIZED[accessor.componentType as number] ?? 1;
    const isSigned = accessor.componentType === 5120 || accessor.componentType === 5122;

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
    out.set(typedRaw);
  }
  return out;
}

/**
 * Builds the track for one animation channel
 *
 * A `weights` channel holds one value per morph target per keyframe, or three with `CUBICSPLINE`
 * (in-tangent, value, out-tangent), so its value size is the value count over the keyframe count,
 * divided by three for `CUBICSPLINE`.
 * @param target - The node property the channel drives
 * @param sampler - The channel's keyframes
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers holding the keyframe data
 */
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
