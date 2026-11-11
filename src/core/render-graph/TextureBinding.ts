import type { BindGroup } from 'pixi.js';

/**
 * Where {@link PassBuilder#sample} puts a texture: a binding in a bind group, and optionally one
 * beside it for the texture's sampler
 *
 * The graph writes the frame's texture into the binding before the pass renders. Make one for each
 * input in a bind group the pass owns, or use one of {@link PassBuilder#globalTextureBindings}.
 * `slot` and `styleSlot` are binding names the pass's shader declares; pixi matches them by name,
 * so their order in the group doesn't matter.
 * @example
 * ```ts
 * class MyPass extends RenderPass {
 *   private readonly _source: ColorHandle = model.sceneColor;
 *   private readonly _group = new BindGroup({
 *     uTexture: Texture.WHITE.source,
 *     uTextureSampler: Texture.WHITE.source.style,
 *   });
 *   private readonly _input: TextureBinding = {
 *     group: this._group,
 *     slot: 'uTexture',
 *     styleSlot: 'uTextureSampler',
 *   };
 *
 *   public override setup(b: PassBuilder): void {
 *     b.sample(this._source, this._input);
 *     b.sample(model.opaqueDepth, b.globalTextureBindings.opaqueDepth);
 *   }
 * }
 * ```
 * @category rendering
 * @advanced
 */
export interface TextureBinding {
  /** The bind group the texture goes in */
  readonly group: BindGroup;
  /** Name of the binding the texture goes in */
  readonly slot: string;
  /**
   * Name of the binding the texture's own sampler goes in; leave it out to bind a sampler of your
   * own. A depth texture has none, and {@link PassBuilder#sample} throws if it's set.
   */
  readonly styleSlot?: string;
}

/**
 * The bindings in the view's global bind group; `setup` reaches them through
 * {@link PassBuilder#globalTextureBindings}
 * @category rendering
 * @advanced
 */
export interface GlobalTextureBindings {
  /** The opaque colour copy {@link CopyOpaquePass} makes, which transmission and blended refraction sample */
  readonly opaqueColor: TextureBinding;
  /** The opaque depth copy {@link CopyDepthPass} makes, which blended refraction samples */
  readonly opaqueDepth: TextureBinding;
  /** The shadow map, which lit materials sample once a light in the view casts a shadow */
  readonly shadowMap: TextureBinding;
}
