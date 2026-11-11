import { Animation } from '../../../../animation/Animation';
import { QuaternionTrack } from '../../../../animation/tracks/QuaternionTrack';
import { Track } from '../../../../animation/tracks/Track';
import type { InterpolationMode, TrackOptions } from '../../../../animation/tracks/Track';
import { Vector3Track } from '../../../../animation/tracks/Vector3Track';
import type { Scene3DSource } from '../../../Scene3DSource';
import type { GltfFormat } from '../GltfFormat';
import { NORMALIZED_SCALE } from '../utils/accessorToVertexFormat';
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

/** @internal */
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

/** Signed normalized values clamp at -1, as glTF's decode formula does */
function getBufferAsFloat32(gltfRaw: GltfFormat, buffers: ArrayBuffer[], accessorIndex: number): Float32Array {
  const raw = getBuffer(gltfRaw, buffers, accessorIndex);
  if (raw instanceof Float32Array) return raw;

  const accessor = gltfRaw.accessors![accessorIndex];
  const typedRaw = raw as Int16Array | Uint16Array | Int8Array | Uint8Array;
  const out = new Float32Array(typedRaw.length);

  if (accessor.normalized === true) {
    const scale = NORMALIZED_SCALE[accessor.componentType] ?? 1;
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

function createTrack(
  target: GltfFormat.AnimationChannelTarget,
  sampler: GltfFormat.AnimationSampler,
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
