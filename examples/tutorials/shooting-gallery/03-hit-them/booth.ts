import { CubeGeometry, CylinderGeometry, Material3D, Mesh3D, SphereGeometry, SpotLight } from '@pixi/3d';
import type { Geometry3D, View3D } from '@pixi/3d';

export function buildBooth(view3d: View3D) {
  // Painted wood, cream trim, a red gloss with a clear coat, a dark back wall and brass
  const wood = new Material3D({ baseColor: 0x9a5b34, roughness: 0.7 });
  const cream = new Material3D({ baseColor: 0xf2e6cf, roughness: 0.5 });
  const red = new Material3D({ baseColor: 0xd81b3c, roughness: 0.45, clearcoat: { factor: 0.6, roughness: 0.2 } });
  const wall = new Material3D({ baseColor: 0x3a2c6e, roughness: 0.9 });
  const brass = new Material3D({ baseColor: 0xe0b060, metallic: 1, roughness: 0.35 });

  // Bulbs glow in their own colour, so they show even where no light reaches them
  const bulb = new Material3D({ baseColor: 0xffffff, emissive: { color: 0xffc46b, strength: 2 } });

  // One cube scaled into every box, and one cylinder for every post
  const cube = new CubeGeometry();
  const post = new CylinderGeometry({ radiusTop: 0.14, radiusBottom: 0.14, height: 5.2, radialSegments: 24 });
  const add = (geometry: Geometry3D, material: Material3D, x: number, y: number, z: number) => {
    const mesh = new Mesh3D({ geometry, material });

    mesh.position.set(x, y, z);
    view3d.root.addChild(mesh);

    return mesh;
  };

  // Back and side walls, a counter in front with a wooden top, and a post at each front corner
  add(cube, wall, 0, 2.5, -1.3).scale.set(9, 5, 0.2);
  add(cube, wall, -4.3, 2.5, 0.1).scale.set(0.2, 5, 2.8);
  add(cube, wall, 4.3, 2.5, 0.1).scale.set(0.2, 5, 2.8);
  add(cube, red, 0, 0.6, 1.5).scale.set(8.8, 1.2, 0.7);
  add(cube, wood, 0, 1.26, 1.45).scale.set(9.2, 0.12, 1);
  add(post, cream, -4.5, 2.6, 1.6);
  add(post, cream, 4.5, 2.6, 1.6);

  // Two rails for the targets to run along
  add(cube, brass, 0, 1.6, -0.7).scale.set(8.6, 0.08, 0.08);
  add(cube, brass, 0, 3.05, -0.7).scale.set(8.6, 0.08, 0.08);

  // A striped awning, tipped forward at the bottom, with a row of bulbs along its edge
  for (let i = 0; i < 8; i++) {
    const stripe = add(cube, i % 2 ? cream : red, (i - 3.5) * 1.15, 5.45, 1.75);

    stripe.scale.set(1.15, 0.9, 0.06);
    stripe.rotation.x = -0.4;
  }

  const bulbGeometry = new SphereGeometry({ radius: 0.07, widthSegments: 12, heightSegments: 8 });

  for (let i = 0; i < 9; i++) add(bulbGeometry, bulb, (i - 4) * 1.15, 5.03, 1.95);

  // Two spotlights high on either side, aimed down across the targets. Each casts its own shadow.
  for (const side of [-1, 1]) {
    const spot = new SpotLight({
      color: 0xffe2b8,
      intensity: 50,
      range: 18,
      coneAngle: 32,
      penumbra: 0.5,
      castShadow: true,
    });

    spot.position.set(side * 3.6, 4.8, 7);
    spot.lookAt({ x: -side * 0.6, y: 2.4, z: -1.2 });
    view3d.root.addChild(spot);
  }
}
