import { Container3D, CylinderGeometry, Material3D, Mesh3D } from '@pixi/3d';
import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

// Targets on each rail, and the space between them
const COUNT = 5;
const SPACING = 1.9;

// The two rails: how high each runs, and how fast its targets slide and which way
const RAILS = [
  { y: 1.64, speed: 1.1 },
  { y: 3.09, speed: -1.5 },
];

export function createTargets(app: Application, view3d: View3D) {
  // A target's face is three discs, each a little thicker so it shows in front of the one behind
  const disc = (radius: number, height: number) =>
    new CylinderGeometry({ radiusTop: radius, radiusBottom: radius, height, radialSegments: 40 });
  const outer = disc(0.38, 0.06);
  const ring = disc(0.26, 0.07);
  const bull = disc(0.13, 0.08);
  const stick = new CylinderGeometry({ radiusTop: 0.035, radiusBottom: 0.035, height: 0.7, radialSegments: 12 });
  const white = new Material3D({ baseColor: 0xf6efe2, roughness: 0.5 });
  const steel = new Material3D({ baseColor: 0x9aa0ad, metallic: 1, roughness: 0.4 });
  const red = new Material3D({ baseColor: 0xe0213f, roughness: 0.4 });

  /** -- INSERT CODE HERE -- */
}
