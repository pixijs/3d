---
title: Time and restart
---

A game needs an ending. In this step you'll give each round 30 seconds, show the score when time runs out, and add a button to play again.

`createTargets` now returns two controls for the game: `active`, which stops the targets sliding and taking hits while it's `false`, and `reset`, which stands every target back up. `index.ts` passes them and the score to `startGame`, in `game.ts`. Work there.

## The clock and the panel

The starting code builds the end-of-round `panel`: a `shade` over the screen, a `title`, a `result` and a `button`, hidden until the round ends. Put the time left in the top right corner, and add the clock and the panel to the stage:

```ts
const clock = new Text({
  text: '',
  style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xffffff },
});

clock.anchor.set(1, 0);
app.stage.addChild(clock, panel);
```

The panel goes on the stage last, so it draws over everything, the view included, and the button gets the pointer instead of the view.

## Run the clock

Count down on every frame while the targets are active, and end the round at 0:

```ts
let timeLeft = ROUND_SECONDS;

app.ticker.add((ticker) => {
  if (!targets.active) return;

  timeLeft = Math.max(0, timeLeft - ticker.deltaMS / 1000);
  clock.text = `0:${String(Math.ceil(timeLeft)).padStart(2, '0')}`;

  if (timeLeft === 0) {
    targets.active = false;
    result.text = `Final score ${score.points}`;
    panel.visible = true;
  }
});
```

When time runs out, the targets stop sliding and ignore hits, the clock stops at 0:00, and the panel shows the score.

## Play again

The button starts a new round: it zeroes the score, stands the targets up, winds the clock back and hides the panel:

```ts
button.on('pointertap', () => {
  score.reset();
  targets.reset();
  targets.active = true;
  timeLeft = ROUND_SECONDS;
  panel.visible = false;
});
```

## Lay it out

Place the clock and the panel to fit the screen, now and on every resize:

```ts
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
```

You have 30 seconds. Hit as many targets as you can.
