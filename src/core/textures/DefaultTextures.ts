import { BufferImageSource, CubeTexture, Texture, TextureSource, TextureView } from 'pixi.js';

/**
 * The flat normal map a material without one binds; code compares against it to mean "no normal map"
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
 * Process-wide singletons, so any code that destroys textures it holds must skip these
 * @internal
 */
export const SHARED_DEFAULT_TEXTURES: ReadonlySet<Texture> = new Set([Texture.WHITE, Texture.EMPTY, NORMAL_MAP]);

/** @internal */
export const CUBETEXTURE_EMPTY = CubeTexture.from({
  faces: {
    left: Texture.EMPTY,
    right: Texture.EMPTY,
    top: Texture.EMPTY,
    bottom: Texture.EMPTY,
    front: Texture.EMPTY,
    back: Texture.EMPTY,
  },
  label: 'pixijs-3d-empty-skybox',
});

/**
 * Placeholder for integer-texture slots, where `Texture.EMPTY` fails the draw on WebGL and the bind
 * group on WebGPU, even when the shader never reads it
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
 * Seeds the global bind group's `uShadowMap` binding (`View3DGlobalData.globalTextureBindings.shadowMap`) and
 * takes it back whenever the shadow pass releases its map, and on WebGPU while the pass draws into
 * the map. It is a bare `TextureSource` with no pixel data, because WebGPU can't copy data into a
 * `depth32float` texture. Its comparison mode matches the real shadow map's: a WebGL program that
 * declares the shadow sampler still samples this placeholder after a release, and a WebGL draw
 * fails when a `sampler2DArrayShadow` reads a depth texture with comparison off.
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
 * Placeholder for a sampled depth slot; a depth-only view, since a WebGPU `texture_depth_2d` binding
 * takes only the depth aspect of a depth-stencil texture
 * @internal
 */
export const DEPTH_VIEW_PLACEHOLDER = new TextureView(DEPTH_STENCIL_EMPTY.source, { aspect: 'depth-only' });
