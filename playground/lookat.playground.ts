import {
  Container3D,
  CubeGeometry,
  CylinderGeometry,
  ConeGeometry,
  DirectionalLight,
  Material3D,
  Mesh3D,
  View3D,
} from '@pixi/3d';
import { Application } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/**
 * Build an "arrow" Container3D pointing along its local +Z axis.
 * Cylinder shaft + cone tip, both rotated so the visual front aligns with +Z.
 * That way `arrow.lookAt(target)` (which uses Container3D's default +Z forward)
 * makes the tip point at the target.
 * @param color - Base color of the shaft and tip
 */
function makeArrow(color: number): Container3D {
  const arrow = new Container3D();

  const material = new Material3D({ baseColor: color, metallic: 0, roughness: 0.4 });

  const shaft = new Mesh3D({
    geometry: new CylinderGeometry({ radiusTop: 0.04, radiusBottom: 0.04, height: 0.6, radialSegments: 16 }),
    material,
  });
  // Cylinder/cone are built along +Y; rotate +90° around X so the geometry's +Y maps to +Z.
  // Then the visual front of the arrow aligns with the parent's local +Z.
  shaft.rotation.set(Math.PI / 2, 0, 0);
  shaft.position.set(0, 0, 0.3);

  const tip = new Mesh3D({
    geometry: new ConeGeometry({ radius: 0.12, height: 0.25, radialSegments: 24, heightSegments: 1, openEnded: false }),
    material,
  });
  // Same rotation: cone's apex (geometry's +Y) lands on +Z so the tip points forward.
  tip.rotation.set(Math.PI / 2, 0, 0);
  // Position the cone at the front: its base sits at the end of the shaft (z=0.6),
  // and the apex extends out to z=0.85.
  tip.position.set(0, 0, 0.6 + 0.125);

  arrow.addChild(shaft);
  arrow.addChild(tip);

  return arrow;
}

export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x1d1d22 });
  document.body.appendChild(app.canvas);

  const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
  app.stage.addChild(view3d);

  // Spinning cube — the moving target.
  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 }),
    material: new Material3D({ baseColor: 0xe07a4a, metallic: 0.1, roughness: 0.5 }),
  });
  view3d.root.addChild(cube);

  // Eight arrows arranged in a ring around the cube.
  const arrowCount = 8;
  const ringRadius = 2.2;
  const arrows: Container3D[] = [];
  const arrowColors = [0x6ec7c4, 0xb47ad1, 0xf2c14e, 0x82d683, 0x6ec7c4, 0xb47ad1, 0xf2c14e, 0x82d683];

  for (let i = 0; i < arrowCount; i++) {
    const arrow = makeArrow(arrowColors[i]!);
    const angle = (i / arrowCount) * Math.PI * 2;
    arrow.position.set(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
    view3d.root.addChild(arrow);
    arrows.push(arrow);
  }

  const light = new DirectionalLight({ color: 0xffffff, intensity: 6 });
  light.rotation.set(-0.6, 0.6, 0);
  view3d.root.addChild(light);

  view3d.camera.position.set(0, 2.5, 5);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  // Animate: the cube orbits in a small circle and spins; each arrow re-aims at it every frame.
  let t = 0;
  app.ticker.add((ticker) => {
    t += ticker.deltaTime * 0.02;

    // Cube orbits a tight circle so the arrows visibly track its motion.
    cube.position.set(Math.cos(t) * 0.6, Math.sin(t * 1.3) * 0.3, Math.sin(t) * 0.6);

    // Cube spins for visual interest.
    cube.rotation.set(t * 0.5, t * 0.7, 0);

    // Arrows track the cube. Reading cube.position directly is fine — the arrows live at the
    // same level of the scene graph as the cube, so its local position is also its world position.
    for (const arrow of arrows) {
      arrow.lookAt(cube.position);
    }
  });
}
