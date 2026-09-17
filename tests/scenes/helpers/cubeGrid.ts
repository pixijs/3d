import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Mesh3D } from '~/scene/Mesh3D';
import type { View3D } from '~/scene/View3D';

const GRID_SIDE = 7;
const GRID_SPACING = 1.4;
const GRID_CUBE = 0.7;
const GRID_CAMERA_Z = 16;

/**
 * The 7×7 cube grid + straight-on camera shared by the cull/visibility suites — one tuning for
 * all of them, so a layout change keeps every suite's references comparable. Every cube lands
 * inside the camera frustum. `each` receives each cube with its grid coordinates.
 */
export function buildCubeGrid(
  view3d: View3D,
  material: BaseMaterial3D,
  each?: (cube: Mesh3D, x: number, y: number) => void,
): void {
  const geometry = new CubeGeometry({ width: GRID_CUBE, height: GRID_CUBE, depth: GRID_CUBE });
  const half = ((GRID_SIDE - 1) / 2) * GRID_SPACING;

  for (let x = 0; x < GRID_SIDE; x++) {
    for (let y = 0; y < GRID_SIDE; y++) {
      const cube = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      cube.position.set(x * GRID_SPACING - half, y * GRID_SPACING - half, 0);
      view3d.root.addChild(cube);
      each?.(cube, x, y);
    }
  }

  view3d.camera.fov = 50;
  view3d.camera.position.set(0, 0, GRID_CAMERA_Z);
}
