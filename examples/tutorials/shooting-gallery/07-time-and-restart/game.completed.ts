import { Container, Graphics, Text } from 'pixi.js';
import type { Application } from 'pixi.js';

import type { Score } from './score';
import type { Targets } from './targets';

const ROUND_SECONDS = 30;

export function startGame(app: Application, targets: Targets, score: Score) {
  // A panel for the end of a round: a shade over the screen, a title, the result and a button to play again
  const panel = new Container();
  const shade = new Graphics();
  const title = new Text({
    text: "Time's up!",
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 44, fontWeight: '800', fill: 0xffffff },
  });
  const result = new Text({
    text: '',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xffc46b },
  });
  const button = new Container();
  const label = new Text({
    text: 'Play again',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: '700', fill: 0xffffff },
  });

  title.anchor.set(0.5);
  result.anchor.set(0.5);
  label.anchor.set(0.5);
  button.addChild(new Graphics().roundRect(-80, -24, 160, 48, 24).fill(0xd81b60), label);
  button.eventMode = 'static';
  button.cursor = 'pointer';
  panel.addChild(shade, title, result, button);
  panel.visible = false;

  // The time left, in the top right corner. The panel goes on the stage last, so it draws over everything.
  const clock = new Text({
    text: '',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xffffff },
  });

  clock.anchor.set(1, 0);
  app.stage.addChild(clock, panel);

  let timeLeft = ROUND_SECONDS;

  app.ticker.add((ticker) => {
    if (!targets.active) return;

    timeLeft = Math.max(0, timeLeft - ticker.deltaMS / 1000);
    clock.text = `0:${String(Math.ceil(timeLeft)).padStart(2, '0')}`;

    // When time runs out, stop the targets and show the panel
    if (timeLeft === 0) {
      targets.active = false;
      result.text = `Final score ${score.points}`;
      panel.visible = true;
    }
  });

  button.on('pointertap', () => {
    score.reset();
    targets.reset();
    targets.active = true;
    timeLeft = ROUND_SECONDS;
    panel.visible = false;
  });

  // Keep the clock in its corner and the panel in the middle when the screen resizes
  const layout = () => {
    const { width, height } = app.screen;

    clock.position.set(width - 20, 16);
    shade.clear().rect(0, 0, width, height).fill({ color: 0x0d0b14, alpha: 0.6 });
    title.position.set(width / 2, height / 2 - 60);
    result.position.set(width / 2, height / 2);
    button.position.set(width / 2, height / 2 + 70);
  };

  layout();
  app.renderer.on('resize', layout);
}
