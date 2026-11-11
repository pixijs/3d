import { passthroughFragment, PostEffect } from '@pixi/3d';

/** One fullscreen pass that copies the chain colour and reads nothing else: the floor any fullscreen pass pays. */
export class CopyEffect extends PostEffect {
  protected readonly fragment = passthroughFragment;
}
