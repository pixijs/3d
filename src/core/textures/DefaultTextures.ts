import { BufferImageSource, CubeTexture, Texture, TextureSource, TextureView } from 'pixi.js';

/**
 * Flat normal map: one texel of (0.5, 0.5, 1), a tangent-space normal straight out of the surface
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
 * Cube of six empty faces, bound in the environment and background slots while a view has neither
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
 * Empty unsigned-integer texture (rgba32uint, 1x1)
 *
 * Placeholder for every slot a shader declares as an integer texture: the material, mesh and
 * geometry store views and the pass instance index on WebGL, and the material store on WebGPU.
 * These slots can't share `Texture.EMPTY`. WebGL fails a draw whose integer sampler has a float
 * texture bound, even when the shader never reads it. WebGPU rejects a bind group whose texture
 * doesn't match the layout's sample type.
 * @internal
 */
export const UINT_EMPTY = new Texture({
  source: new BufferImageSource({
    resource: new Uint32Array(4),
    width: 1,
    height: 1,
    format: 'rgba32uint',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
    label: 'UINT_EMPTY',
  }),
  label: 'UINT_EMPTY',
});

/**
 * Empty depth texture array (depth32float, 4 layers)
 *
 * Seeds the global bind group's `uShadowMap` slot (each backend's `globalSlots.shadowMap`) and
 * takes it back whenever the shadow pass releases its map. It is a bare `TextureSource` with no
 * pixel data, because WebGPU can't copy data into a `depth32float` texture. Its comparison mode
 * matches the real shadow map's: a WebGL program that declares the shadow sampler still samples
 * this placeholder after a release, and a WebGL draw fails when a `sampler2DArrayShadow` reads a
 * depth texture with comparison off.
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
 * Empty depth-stencil texture (depth24plus-stencil8, single 2D layer) behind
 * {@link DEPTH_VIEW_PLACEHOLDER}
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
 * Depth-only `TextureView` over `DEPTH_STENCIL_EMPTY`, the placeholder for a sampled depth slot
 *
 * WebGPU's global bind group starts with it in `uOpaqueDepthTexture`, since the layout needs a
 * depth texture there before any pass binds the opaque depth copy. `RenderGraph` puts it back in
 * any depth sample slot whose texture the pool destroyed. It is a view because a WebGPU
 * `texture_depth_2d` binding takes only the depth aspect of a depth-stencil texture.
 * @internal
 */
export const DEPTH_VIEW_PLACEHOLDER = new TextureView(DEPTH_STENCIL_EMPTY.source, { aspect: 'depth-only' });
