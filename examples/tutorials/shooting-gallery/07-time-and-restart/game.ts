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

  /** -- INSERT CODE HERE -- */
}
