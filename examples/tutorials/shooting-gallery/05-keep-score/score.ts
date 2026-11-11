import { ContainerTexture, FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import type { View3D } from '@pixi/3d';
import { Container, Graphics, Text } from 'pixi.js';
import type { Application } from 'pixi.js';

export function createScore(app: Application, view3d: View3D) {
  /** -- INSERT CODE HERE -- */

  const score = {
    points: 0,
    add(points: number) {
      score.points += points;
      show();
    },
    reset() {
      score.points = 0;
      show();
    },
  };

  // Write the score in both places
  const show = () => {
    /** -- INSERT CODE HERE -- */
  };

  show();

  return score;
}

export type Score = ReturnType<typeof createScore>;
