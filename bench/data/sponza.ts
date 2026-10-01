/**
 * The Sponza fly-through. The camera runs along the hall and back, looking a little off axis, which keeps
 * most of the model in frame and the working set moving: a still camera in a textured scene measures one
 * framebuffer's worth of texels forever.
 *
 * The path is derived from the model's world-space extent rather than hard-coded, so the manifest is the only
 * thing that has to know how big Sponza is.
 */

import { sun } from './look.ts';
import type { CameraSpec, SceneLook, Vec3 } from './look.ts';

/** A model's extent in world space, as `benchy assets` records it. */
export interface Extent {
  min: number[];
  max: number[];
}

/** A loaded glTF scene with a camera path: textured PBR as an artist authored it. */
export interface FlyThroughScene {
  look: SceneLook;
  url: string;
  /** Moves `look.camera` along the path to `t` seconds. */
  update(seconds: number): void;
}

export function flyThrough(url: string, extent: Extent): FlyThroughScene {
  const min = extent.min;
  const max = extent.max;
  const size = (axis: number): number => (max[axis] ?? 0) - (min[axis] ?? 0);
  const centre: Vec3 = [((min[0] ?? 0) + (max[0] ?? 0)) / 2, min[1] ?? 0, ((min[2] ?? 0) + (max[2] ?? 0)) / 2];
  const alongX = size(0) >= size(2);
  const length = alongX ? size(0) : size(2);
  const height = size(1);
  const camera: CameraSpec = {
    position: [centre[0], centre[1] + 0.15 * height, centre[2]],
    target: [centre[0] + 1, centre[1] + 0.15 * height, centre[2]],
    fovY: 60,
    near: length / 2000,
    far: length * 1.5,
  };
  const update = (seconds: number): void => {
    const along = Math.sin((seconds * Math.PI * 2) / 16) * 0.35 * length;
    const yaw = 0.6 * Math.sin((seconds * Math.PI * 2) / 10);
    const y = centre[1] + 0.15 * height;
    const x = alongX ? centre[0] + along : centre[0];
    const z = alongX ? centre[2] : centre[2] + along;
    const forwardX = alongX ? Math.cos(yaw) : Math.sin(yaw);
    const forwardZ = alongX ? Math.sin(yaw) : Math.cos(yaw);
    camera.position = [x, y, z];
    camera.target = [x + forwardX, y + 0.08, z + forwardZ];
  };
  update(0);
  return {
    look: {
      camera,
      clearColor: [0.35, 0.45, 0.6],
      ambient: { color: [0.7, 0.75, 0.85], intensity: 0.5 },
      sun: sun([0.2, -1, 0.15], 3),
    },
    url,
    update,
  };
}
