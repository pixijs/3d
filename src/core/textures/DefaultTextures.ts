import { BufferImageSource, CubeTexture, Texture, TextureSource, TextureView } from 'pixi.js';

/**
 * Default normal map texture (flat normal pointing up)
 * @internal
 */
export const NORMAL_MAP = new Texture({
  source: new BufferImageSource({
    resource: new Uint8Array([128, 128, 255, 255]),
    width: 1,
    height: 1,
    alphaMode: 'premultiply-alpha-on-upload',
    label: 'NORMAL',
  }),
  label: 'NORMAL',
});

/**
 * Shared default textures a material's slots fall back to
 *
 * Process-global singletons: anything that destroys the textures it holds must skip them, since
 * destroying one would break every other material still pointing at it.
 * @internal
 */
export const SHARED_DEFAULT_TEXTURES: ReadonlySet<Texture> = new Set([Texture.WHITE, Texture.EMPTY, NORMAL_MAP]);

/**
 * Empty cubemap texture (all faces are empty)
 *
 * Used as a placeholder when no environment/background is set.
 * @internal
 */
export const CUBETEXTURE_EMPTY = CubeTexture.from({
  faces: {
    left: Texture.EMPTY,
    right: Texture.EMPTY,
    top: Texture.EMPTY,
    bottom: Texture.EMPTY,
    front: Texture.EMPTY,
    back: Texture.EMPTY,
  },
  label: 'pixi3d-empty-skybox',
});

/**
 * Empty depth texture array (depth32float, 4 layers)
 *
 * Seeds the global bind group's `uShadowMap` slot (each backend's `globalSlots.shadowMap`) and
 * takes it back whenever the shadow pass releases its map. WebGPU forbids `Queue.WriteTexture` on
 * depth formats, so this is a bare `TextureSource` (no pixel data) rather than a
 * `BufferImageSource`. The comparison mode matches the real shadow map's: a GL program that
 * declares the shadow sampler still samples this placeholder after a release, and GL refuses a
 * compare-mode-NONE depth texture through `sampler2DArrayShadow`.
 * @internal
 */
export const DEPTH_EMPTY = new Texture({
  source: new TextureSource({
    width: 1,
    height: 1,
    format: 'depth32float',
    scaleMode: 'nearest',
    viewDimension: '2d-array',
    autoGenerateMipmaps: false,
    arrayLayerCount: 4,
    compare: 'less',
    label: 'DEPTH_EMPTY',
  }),
  label: 'DEPTH_EMPTY',
});

/**
 * Empty depth-stencil texture (depth24plus-stencil8, single 2D layer)
 *
 * Used as the placeholder for `uOpaqueDepthTexture` (global bind group slot 7) at initialisation
 * time. The global bind group needs a valid depth texture from the start so the pipeline layout
 * is consistent, but the real depth texture isn't available until the transparent pass creates a
 * `depth-only` TextureView from the render target's depth-stencil attachment.
 * @internal
 */
const DEPTH_STENCIL_EMPTY = new Texture({
  source: new TextureSource({
    width: 1,
    height: 1,
    format: 'depth24plus-stencil8',
    scaleMode: 'nearest',
    viewDimension: '2d',
    autoGenerateMipmaps: false,
    label: 'DEPTH_2D_EMPTY',
  }),
  label: 'DEPTH_2D_EMPTY',
});

/**
 * Depth-only `TextureView` over `DEPTH_STENCIL_EMPTY`
 *
 * Single canonical placeholder for global bind-group slots that hold an opaque-depth sampler —
 * used as the initial value at bind-group construction (see `globalBitGpu.ts`) and by the graph's
 * resize/destroy safety path (`_rebindTransientSlotsToDefaults`) so a doomed transient can be
 * unbound without leaving a null slot. WebGPU's `texture_depth_2d` validation requires a
 * depth-aspect view, hence the wrapper.
 * @internal
 */
export const DEPTH_VIEW_PLACEHOLDER = new TextureView(DEPTH_STENCIL_EMPTY.source, { aspect: 'depth-only' });
