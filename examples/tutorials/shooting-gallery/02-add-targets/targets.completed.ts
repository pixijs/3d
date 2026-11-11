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

  const targets = RAILS.flatMap((rail) => {
    // Each rail is a node, with its targets as children
    const track = new Container3D();

    track.position.set(0, rail.y, -0.7);
    view3d.root.addChild(track);

    return Array.from({ length: COUNT }, (_, i) => {
      const face = new Container3D();
      const pole = new Mesh3D({ geometry: stick, material: steel });

      // A cylinder stands along y, so turn the face a quarter turn to look at the camera
      face.position.y = 0.95;
      face.rotation.x = Math.PI / 2;
      face.addChild(
        new Mesh3D({ geometry: outer, material: red }),
        new Mesh3D({ geometry: ring, material: white }),
        new Mesh3D({ geometry: bull, material: red }),
      );
      pole.position.y = 0.35;

      // The target's origin is at its foot, so it falls over around the rail
      const node = new Container3D();

      node.addChild(pole, face);
      node.x = i * SPACING;
      track.addChild(node);

      const target = { node, speed: rail.speed };

      return target;
    });
  });

  const length = COUNT * SPACING;

  app.ticker.add((ticker) => {
    const seconds = ticker.deltaMS / 1000;

    for (const target of targets) {
      const { node } = target;

      // Slide along the rail, and come back in at the other end
      node.x += target.speed * seconds;
      if (node.x > length / 2) node.x -= length;
      if (node.x < -length / 2) node.x += length;
    }
  });
}
