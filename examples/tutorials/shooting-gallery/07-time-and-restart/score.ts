import { ContainerTexture, FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import type { View3D } from '@pixi/3d';
import { Container, Graphics, Text } from 'pixi.js';
import type { Application } from 'pixi.js';

export function createScore(app: Application, view3d: View3D) {
  // The score in the corner of the screen, in 2D
  const hud = new Text({
    text: '',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xffffff },
  });

  hud.position.set(20, 16);
  app.stage.addChild(hud);

  // The same score on a board over the booth: a 2D container drawn into a texture
  const board = new Container();
  const digits = new Text({
    text: '',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 80, fontWeight: '800', fill: 0xffc46b },
  });

  digits.anchor.set(0.5);
  digits.position.set(256, 64);
  board.addChild(
    new Graphics().rect(0, 0, 512, 128).fill(0x1b1430).rect(8, 8, 496, 112).stroke({ color: 0xffc46b, width: 6 }),
    digits,
  );

  const texture = new ContainerTexture({ container: board, width: 512, height: 128, renderer: app.renderer });
  const sign = new Mesh3D({
    geometry: new PlaneGeometry({ width: 2.4, height: 0.6 }),
    material: new FlatMaterial({ baseColorTexture: texture }),
  });

  sign.position.set(0, 6.3, 1.7);
  view3d.root.addChild(sign);

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

  // Write the score in both places. The texture only redraws when asked.
  const show = () => {
    hud.text = `Score ${score.points}`;
    digits.text = String(score.points);
    texture.render();
  };

  show();

  return score;
}

export type Score = ReturnType<typeof createScore>;
