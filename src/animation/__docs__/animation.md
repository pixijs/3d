---
title: Animation
description: Playing and blending a model's animation clips, posing skinned meshes, setting morph target weights, and building keyframe animations in code.
category: animation
---

# Animation

PixiJS 3D plays keyframe animation: the clips a glTF model brings, and animations you build in code. Most of the work goes through three classes:

- An {@link Animation} is a named set of keyframe tracks, such as a model's Walk clip. Each track drives one property, such as a bone's rotation or the position of a node (any {@link Container3D} in the scene).
- An {@link AnimationPlayer} plays animations on a node, such as a model, and everything under it.
- An {@link AnimationState} is one animation's playback on one player: its time, speed, looping and weight.

To move something by code every frame, such as a spinning coin, you don't need these. Change the node's transform from the ticker, as in 2D; [Scene graph](../../__docs__/concepts/scene-graph.md#parents-and-children) shows how.

## Playing a model's clips

A {@link Model3D} whose file has animation clips comes with a player, {@link Model3D#player | model.player}, which is `undefined` when the file has none. {@link AnimationPlayer#animationLabels | animationLabels} lists the clips by name, and {@link AnimationPlayer#play | play} starts one and returns its state:

```ts
const fox = new Model3D({ source });

view3d.root.addChild(fox);

const walk = fox.player!.play('Walk');

walk.animationSpeed = 1.5;
```

`play` doesn't stop a clip that's already playing; the two [blend](#blending-and-crossfades). To switch clips, call {@link AnimationPlayer#stop | player.stop()}, which stops every animation on the player, each holding its pose, then play the next.

Like an `AnimatedSprite`, a player advances on `Ticker.shared`, which by default isn't `app.ticker`, so slowing or pausing `app.ticker` doesn't reach it. To drive it from your own ticker, turn {@link AnimationPlayer#autoUpdate | autoUpdate} off and call {@link AnimationPlayer#update | update}:

```ts
const fox = new Model3D({ source, autoUpdate: false });

app.ticker.add((ticker) => fox.player?.update(ticker));
```

## Controlling playback

{@link AnimationPlayer#getState | getState} returns an animation's state without starting playback. The state's methods follow `AnimatedSprite`'s, such as {@link AnimationState#stop | stop()} and {@link AnimationState#gotoAndPlay | gotoAndPlay()}, but take times in seconds, not frame numbers. Writing {@link AnimationState#time | time} only moves the playhead; {@link AnimationState#gotoAndStop | gotoAndStop(time)} shows the pose straight away.

{@link AnimationState#loop | loop} is on by default. With it off, the state stops at its end, holds that pose and calls {@link AnimationState#onComplete | onComplete}. `gotoAndPlay(0)` plays it again, or `gotoAndPlay(state.animation.duration)` when a negative {@link AnimationState#animationSpeed | animationSpeed} plays it backwards. Here the walking fox stops, looks around once, then walks on:

```ts
fox.player!.stop();

const survey = fox.player!.getState('Survey');

survey.loop = false;
survey.onComplete = () => fox.player!.play('Walk');
survey.gotoAndPlay(0);
```

Every model built from one source has its own player, so foxes in a crowd can each set their state's `time` to walk out of step.

## Blending and crossfades

All playing states apply at once, and where two drive a property through tracks with the same label, as a model's clips do, the player mixes them by {@link AnimationState#weight | weight}. Weights are relative, so a clip that alone drives a property shows in full at any weight above 0: lowering its weight doesn't fade it out, but moving weight to another clip does. A track you write for one of a model's bones or nodes doesn't mix with the file's clips; add to a clip's pose as [Skinned meshes](#skinned-meshes) shows.

To crossfade, step the weights each frame: toward 1 on the clip you want and toward 0 on the other. One callback then fades either way, even when you switch mid-fade:

```ts
const player = fox.player!;
const walk = player.play('Walk');
const run = player.getState('Run');
let target = walk;

app.ticker.add((ticker) => {
  const step = ticker.deltaMS / 300;

  for (const state of [walk, run]) {
    state.weight = state === target ? Math.min(1, state.weight + step) : Math.max(0, state.weight - step);
    if (state.weight === 0) state.stop();
  }
});

const fadeTo = (next: AnimationState) => {
  if (!next.playing) {
    next.weight = 0;
    next.play();
  }
  target = next;
};

button.on('pointertap', () => fadeTo(target === walk ? run : walk));
```

A stopped state keeps its weight, so the snippet sets a stopped clip's weight to 0 before playing it. The callback sets both weights while it runs, so switch clips by changing its target, as the button does; once you remove the callback, set a faded-out clip's weight above 0 before you play it again, or it changes nothing.

Two cycles that start on the same foot and step in the same order begin the fade in step if the incoming clip starts at the same share of its {@link Animation#duration | duration} as the outgoing clip has reached: set its {@link AnimationState#time | time} before you play it. The fox's walk and run don't match this way.

[Playing clips](/3d/examples?example=animation_clips) crossfades the fox between its clips, and blends its walk with its run.

## Skinned meshes

A skinned mesh bends with a skeleton: a hierarchy of bones, such as a character's spine and limbs, that each move the vertices tied to them. A {@link Model3D} lists its {@link Skeleton | skeletons} in {@link Model3D#skeletons | model.skeletons}, and every model gets its own, so posing one fox doesn't move another.

{@link Container3D#getChildByLabel | getChildByLabel} finds only the bones the file puts a mesh under, as [Scene graph](../../__docs__/concepts/scene-graph.md#parents-and-children) explains, and you move those like any node. The rest live only in the skeleton: {@link Skeleton#indexOf | indexOf} finds one by its name in the file, and its local position, rotation and scale sit in flat arrays. {@link Skeleton#localRotation | localRotation} holds each bone's rotation as a [quaternion](../../math/__docs__/math.md#rotations), four numbers per bone. Write into the arrays and set {@link Skeleton#dirty | dirty}, or call {@link Skeleton#setLocalTRS | setLocalTRS}, which does both.

A playing clip rewrites the bones it drives on every update, so a pose you write there lasts only until the next one. To add to a clip's pose, turn the model's {@link Model3DOptions#autoUpdate | autoUpdate} off, so you choose the order, and pose the bone right after you update the player:

```ts
const fox = new Model3D({ source, autoUpdate: false, autoPlay: 'Walk' });
const skeleton = fox.skeletons[0];
const head = skeleton.indexOf('b_Head_05') * 4;
const turn = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 6);
const rotation = new Quaternion();

view3d.root.addChild(fox);

app.ticker.add((ticker) => {
  fox.player!.update(ticker);

  // Turn the head a further 30 degrees, on top of the pose the walk just set
  rotation.fromArray(skeleton.localRotation, head).multiply(turn).toArray(skeleton.localRotation, head);
  skeleton.dirty = true;
});
```

While the walk plays, it resets the head on every update, so the turn doesn't pile up; once no playing clip drives the bone, as after `player.stop()`, write the rotation outright, or it turns further every frame. A bone turns about its own axes, which depend on how the file was rigged, so check the axis on your model.

[Driving bones](/3d/examples?example=animation_bones) turns the fox's head toward the pointer the same way.

Picking and culling don't follow the bones: see [Interaction](../../events/__docs__/interaction.md#hit-volumes) for an animated character's hit volume, and [Performance](../../__docs__/concepts/performance.md#culling) for one that vanishes near the screen's edge.

## Morph targets

A morph target is another shape stored for the same vertices, such as a smile or a blink. A mesh whose geometry has morph targets has {@link Mesh3D#weights | weights}, one number per target: 0 leaves the base shape, 1 reaches the target, and several targets add up. Clips in the file can drive the weights, or you can set them yourself:

```ts
model.traverse((node) => {
  if (node instanceof Mesh3D && node.weights) node.weights[0] = 0.8;
});
```

Write into the array rather than assigning a new one: a clip that has started keeps using the old array. Each model has its own weights, even when several share one source.

[Morph targets from glTF](/3d/examples?example=animation_morph-targets) plays a cube's clip on its weights. A playing clip rewrites them on every update, so the example stops it when you set one by hand.

## Animating in code

Build an {@link Animation} from tracks to animate a node's properties in code, such as its position or a mesh's weights. Each track names the property it drives as `'<node label>.<property>'`, and holds keyframe times in seconds with a value for each:

```ts
const crate = new Mesh3D({
  geometry: new CubeGeometry(),
  material: new Material3D(),
  label: 'crate',
  parent: view3d.root,
});

const bob = new Animation({
  label: 'bob',
  tracks: [new NumberTrack({ label: 'crate.y', times: [0, 0.5, 1], values: [0, 1, 0] })],
});

const player = new AnimationPlayer({ target: crate, animations: [bob], autoPlay: 'bob' });
```

The player finds each track's node by label, or a skinned mesh's bone by name, under its `target`, as {@link TrackOptions#label} describes. It looks each label up once, the first time an animation that uses it plays or calls `gotoAndStop`, so add the nodes first. A label that names no node, or a property the player can't animate, does nothing, without a warning: a track can't reach a material, and of the nodes only a {@link Sprite3D} has an `alpha`. When copies under one target share a label, only one animates, so give each copy its own player; players can share one animation.

Pick the track class by the property's type:

| Track                   | Property                                                        | Numbers per value |
| ----------------------- | --------------------------------------------------------------- | ----------------- |
| {@link Vector3Track}    | A vector, such as `position`, `scale`, or `rotation` in radians | 3                 |
| {@link QuaternionTrack} | `quaternion`                                                    | 4                 |
| {@link NumberTrack}     | A number, such as `y`                                           | 1                 |
| {@link Track}           | An array of numbers, such as `weights`, with `valueSize`        | `valueSize`       |

- A `position` track sets all three coordinates. Animate `y` alone with a {@link NumberTrack} to keep the `x` and `z` you placed the node at.
- A `rotation` track sets all three angles too, so give it a {@link Vector3Track} even to turn about one axis. `angle` doesn't animate.
- On a bone, a track drives only `position`, `quaternion` or `scale`, so turn a bone with a {@link QuaternionTrack}.
- {@link TrackOptions#interpolation | interpolation} sets how a track fills the time between keyframes. `'CUBICSPLINE'` stores two tangents with each keyframe's value, as {@link TrackOptions#values} lays out.
- A {@link QuaternionTrack} with `'LINEAR'` interpolation, the default, takes the shorter way between two keyframes, so keep each step under half a turn. A {@link Vector3Track} on `rotation` turns through the angles as you give them.
- An animation lasts until its last keyframe; set {@link AnimationOptions#duration | duration} longer to hold the end pose before it loops.

[Keyframes](/3d/examples?example=animation_keyframes) assembles the PixiJS logo from a `Vector3Track` per piece, a `QuaternionTrack` that rolls its badge and a `NumberTrack` that flashes a light, and plays the same keyframes with each interpolation.

## Cleaning up

A model's {@link Model3D#destroy | destroy} destroys its player and skeletons. A player you built isn't tied to its target: destroying the target leaves the player running on `Ticker.shared` while it plays, so call its {@link AnimationPlayer#destroy | destroy} too. Remove the ticker callbacks you added to drive a player or its bones, such as the crossfade and the head turn above.

## Next steps

- [Loading models](../../assets/__docs__/models.md): where models and their clips come from.
- [Scene graph and transforms](../../__docs__/concepts/scene-graph.md#rotation-and-quaternion): how `rotation` and `quaternion` share a node.
