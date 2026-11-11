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
  label: 'pixi3d-empty-skybox',
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
 * Placeholder shadow map, with no pixels since WebGPU can't copy into `depth32float`, and comparison
 * on, since WebGL fails a draw whose `sampler2DArrayShadow` reads a depth texture with it off
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
