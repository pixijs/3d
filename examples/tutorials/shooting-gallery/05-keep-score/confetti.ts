import type { PointData3D, View3D } from '@pixi/3d';
import { ParticleSystem3D, SphereShape } from '@pixi/3d/extras';

const COLORS = [0xff2e63, 0xffc93c, 0x3ec1d3, 0x8b5cf6, 0xffffff];

export function createConfetti(view3d: View3D) {
  // Square flakes that burst out from a point, tumble, slow down and fall
  const confetti = new ParticleSystem3D({
    capacity: 600,
    emitRate: 0,
    shape: new SphereShape({ radius: 0.1 }),
    life: [1, 1.6],
    speed: [2.5, 5],
    size: [0.07, 0.13],
    startRotation: [0, Math.PI * 2],
    spin: [-10, 10],
    gravity: 7,
    drag: 1.2,
    alphaEnd: 0,
  });

  view3d.root.addChild(confetti);

  return {
    burst(position: PointData3D) {
      // A spawn takes one colour, so burst once per colour
      for (const color of COLORS) confetti.spawn(12, { position, color });
    },
  };
}
