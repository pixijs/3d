/**
 * Index into one of the glTF root arrays
 * @internal
 */
export type GltfId = number;
/**
 * Where a sparse accessor's element indices are stored
 * @internal
 */
export interface AccessorSparseIndices {
  bufferView: GltfId;
  byteOffset?: number;
  componentType: 5121 | 5123 | 5125 | ({} & number);
}
/**
 * Where a sparse accessor's replacement values are stored
 * @internal
 */
export interface AccessorSparseValues {
  bufferView: GltfId;
  byteOffset?: number;
}
/**
 * The elements of an accessor that differ from its base, which is the accessor's bufferView or,
 * without one, all zeros
 * @internal
 */
export interface AccessorSparse {
  count: number;
  indices: AccessorSparseIndices;
  /** Replacement values, with the base accessor's component type and component count */
  values: AccessorSparseValues;
}
/**
 * A typed view of a bufferView, such as one vertex attribute
 * @internal
 */
export interface Accessor {
  /** Unset for an accessor of all zeros, which `sparse` then fills in */
  bufferView?: GltfId;
  byteOffset?: number;
  /** GL enum: 5120 BYTE, 5121 UNSIGNED_BYTE, 5122 SHORT, 5123 UNSIGNED_SHORT, 5125 UNSIGNED_INT, 5126 FLOAT */
  componentType: 5120 | 5121 | 5122 | 5123 | 5125 | 5126 | ({} & number);
  /** Whether integer values read as fractions: 0 to 1 when unsigned, -1 to 1 when signed */
  normalized?: boolean;
  /** Number of elements, not of components */
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4' | ({} & string);
  max?: number[];
  min?: number[];
  sparse?: AccessorSparse;
  name?: any;
}
/**
 * The node property an animation channel drives
 * @internal
 */
export interface AnimationChannelTarget {
  node?: GltfId;
  /** `rotation` values are quaternions `(x, y, z, w)`; `weights` values are one per morph target */
  path: 'translation' | 'rotation' | 'scale' | 'weights' | ({} & string);
}
/**
 * Points one of an animation's samplers at a node property
 * @internal
 */
export interface AnimationChannel {
  sampler: GltfId;
  target: AnimationChannelTarget;
}
/**
 * Keyframes: their times, their values, and how to interpolate between them
 * @internal
 */
export interface AnimationSampler {
  /** Accessor of keyframe times, in seconds */
  input: GltfId;
  /** Defaults to `LINEAR` */
  interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' | ({} & string);
  /** Accessor of keyframe values; `CUBICSPLINE` stores an in-tangent, a value and an out-tangent per keyframe */
  output: GltfId;
}
/**
 * A keyframe animation
 * @internal
 */
export interface GltfAnimation {
  channels: AnimationChannel[];
  samplers: AnimationSampler[];
  name?: any;
}
/**
 * Metadata about the glTF asset
 * @internal
 */
export interface Asset {
  copyright?: string;
  generator?: string;
  version: string;
  minVersion?: string;
}
/**
 * A block of binary data
 * @internal
 */
export interface Buffer {
  /** Unset for a GLB's own binary chunk and for a meshopt fallback */
  uri?: string;
  byteLength: number;
  name?: any;
  extensions?: {
    EXT_meshopt_compression?: MeshoptCompressionBuffer;
    KHR_meshopt_compression?: MeshoptCompressionBuffer;
  };
}
/**
 * A byte range of a buffer
 * @internal
 */
export interface BufferView {
  buffer: GltfId;
  byteOffset?: number;
  byteLength: number;
  /** Bytes from one element to the next when attributes are interleaved; unset when tightly packed */
  byteStride?: number;
  target?: 34962 | 34963 | ({} & number);
  name?: any;
  extensions?: {
    EXT_meshopt_compression?: MeshoptCompression;
    KHR_meshopt_compression?: MeshoptCompression;
  };
}
/**
 * An orthographic projection
 * @internal
 */
export interface CameraOrthographic {
  xmag: number;
  ymag: number;
  zfar: number;
  znear: number;
}
/**
 * A perspective projection
 * @internal
 */
export interface CameraPerspective {
  aspectRatio?: number;
  /** Vertical field of view in radians */
  yfov: number;
  /** Unset for an infinite projection */
  zfar?: number;
  znear: number;
}
/**
 * A camera's projection; the nodes that refer to it place it in the scene
 * @internal
 */
export interface Camera {
  orthographic?: CameraOrthographic;
  perspective?: CameraPerspective;
  type: 'perspective' | 'orthographic' | ({} & string);
  name?: any;
}
/**
 * An image, given by a URI or stored in a bufferView
 * @internal
 */
export interface Image {
  uri?: string;
  /** Required when the image is in a `bufferView` */
  mimeType?: 'image/jpeg' | 'image/png' | ({} & string);
  bufferView?: GltfId;
  name?: any;
}
/**
 * `KHR_texture_transform`: offset, rotation and scale for a texture's UVs
 *
 * See https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform
 * @internal
 */
export interface KHRTextureTransform {
  /** Defaults to `[0, 0]` */
  offset?: [number, number];
  /** Counter-clockwise, in radians; defaults to 0 */
  rotation?: number;
  /** Defaults to `[1, 1]` */
  scale?: [number, number];
  /** Overrides the `texCoord` of the texture it sits on; ignored, as every texture samples the first UV set */
  texCoord?: number;
}

/**
 * Reference to a texture
 * @internal
 */
export interface TextureInfo {
  index: GltfId;
  /** Which `TEXCOORD_n` set to sample; every texture samples set 0, whatever this says */
  texCoord?: number;
  extensions?: {
    KHR_texture_transform?: KHRTextureTransform;
  };
}
/**
 * The core metallic-roughness material values
 * @internal
 */
export interface MaterialPbrMetallicRoughness {
  /** Linear RGBA */
  baseColorFactor?: number[];
  baseColorTexture?: TextureInfo;
  /** Defaults to 1 */
  metallicFactor?: number;
  /** Defaults to 1 */
  roughnessFactor?: number;
  /** Roughness in G, metalness in B */
  metallicRoughnessTexture?: TextureInfo;
}
/**
 * Reference to a normal map
 * @internal
 */
export interface MaterialNormalTextureInfo {
  index?: any;
  texCoord?: any;
  /** Scales the normals' X and Y; defaults to 1 */
  scale?: number;
  extensions?: {
    KHR_texture_transform?: KHRTextureTransform;
  };
}
/**
 * Reference to an occlusion map
 * @internal
 */
export interface MaterialOcclusionTextureInfo {
  index?: any;
  texCoord?: any;
  /** How much of the occlusion applies, from 0 to 1; defaults to 1 */
  strength?: number;
  extensions?: {
    KHR_texture_transform?: KHRTextureTransform;
  };
}
/**
 * `KHR_materials_transmission`: light passing through the surface, as through glass
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_transmission
 * @internal
 */
export interface KHRMaterialsTransmission {
  transmissionFactor?: number;
  transmissionTexture?: TextureInfo;
}
/**
 * `KHR_materials_volume`: thickness and attenuation for light refracting through a volume
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_volume
 * @internal
 */
export interface KHRMaterialsVolume {
  thicknessFactor?: number;
  thicknessTexture?: TextureInfo;
  attenuationDistance?: number;
  attenuationColor?: number[];
}
/**
 * `KHR_materials_ior`: the index of refraction, which defaults to 1.5 without it
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_ior
 * @internal
 */
export interface KHRMaterialsIor {
  ior?: number;
}
/**
 * `KHR_materials_iridescence`: thin-film iridescence
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_iridescence
 * @internal
 */
export interface KHRMaterialsIridescence {
  iridescenceFactor?: number;
  iridescenceIor?: number;
  iridescenceThicknessMinimum?: number;
  iridescenceThicknessMaximum?: number;
  iridescenceTexture?: TextureInfo;
  iridescenceThicknessTexture?: TextureInfo;
}
/**
 * `KHR_materials_clearcoat`: a clear coat layer over the base material
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_clearcoat
 * @internal
 */
export interface KHRMaterialsClearcoat {
  clearcoatFactor?: number;
  clearcoatRoughnessFactor?: number;
  clearcoatTexture?: TextureInfo;
  clearcoatRoughnessTexture?: TextureInfo;
  clearcoatNormalTexture?: MaterialNormalTextureInfo;
}
/**
 * `KHR_materials_sheen`: the soft sheen of cloth
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_sheen
 * @internal
 */
export interface KHRMaterialsSheen {
  sheenColorFactor?: number[];
  sheenRoughnessFactor?: number;
  sheenColorTexture?: TextureInfo;
  sheenRoughnessTexture?: TextureInfo;
}
/**
 * `KHR_materials_specular`: the strength and colour of a non-metal's specular reflection
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_specular
 * @internal
 */
export interface KHRMaterialsSpecular {
  specularFactor?: number;
  specularColorFactor?: number[];
  specularTexture?: TextureInfo;
  specularColorTexture?: TextureInfo;
}
/**
 * `KHR_materials_anisotropy`: roughness that depends on direction, as on brushed metal
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy
 * @internal
 */
export interface KHRMaterialsAnisotropy {
  anisotropyStrength?: number;
  anisotropyRotation?: number;
  anisotropyTexture?: TextureInfo;
}
/**
 * `KHR_materials_emissive_strength`: a multiplier that lets emission exceed 1
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_emissive_strength
 * @internal
 */
export interface KHRMaterialsEmissiveStrength {
  emissiveStrength?: number;
}
/**
 * `KHR_materials_unlit`: an empty object whose presence makes the material unlit
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit
 * @internal
 */
export type KHRMaterialsUnlit = Record<string, never>;
/**
 * A material
 * @internal
 */
export interface Material {
  name?: any;
  extensions?: {
    KHR_materials_transmission?: KHRMaterialsTransmission;
    KHR_materials_volume?: KHRMaterialsVolume;
    KHR_materials_ior?: KHRMaterialsIor;
    KHR_materials_iridescence?: KHRMaterialsIridescence;
    KHR_materials_clearcoat?: KHRMaterialsClearcoat;
    KHR_materials_sheen?: KHRMaterialsSheen;
    KHR_materials_specular?: KHRMaterialsSpecular;
    KHR_materials_anisotropy?: KHRMaterialsAnisotropy;
    KHR_materials_emissive_strength?: KHRMaterialsEmissiveStrength;
    KHR_materials_unlit?: KHRMaterialsUnlit;
  };
  /** Unset means every metallic-roughness value takes its default */
  pbrMetallicRoughness?: MaterialPbrMetallicRoughness;
  normalTexture?: MaterialNormalTextureInfo;
  occlusionTexture?: MaterialOcclusionTextureInfo;
  emissiveTexture?: TextureInfo;
  /** Linear RGB; defaults to black */
  emissiveFactor?: number[];
  /** Defaults to `OPAQUE` */
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND' | ({} & string);
  /** The alpha below which `MASK` discards a pixel; defaults to 0.5 */
  alphaCutoff?: number;
  doubleSided?: boolean;
}
/**
 * One draw of a mesh: vertex attributes, optional indices and a material
 * @internal
 */
export interface MeshPrimitive {
  /** Accessor index per attribute name, such as `POSITION` or `TEXCOORD_0` */
  attributes: {
    [k: string]: GltfId;
  };
  indices?: GltfId;
  /** Unset means the glTF default material */
  material?: GltfId;
  /** 0 points, 1 lines, 2 line loop, 3 line strip, 4 triangles, 5 triangle strip, 6 triangle fan; defaults to 4 */
  mode?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | ({} & number);
  /** Morph targets, each an accessor index per attribute name, holding offsets from the base values */
  targets?: {
    [k: string]: GltfId;
  }[];
  extensions?: {
    KHR_draco_mesh_compression?: KHRDracoMeshCompression;
  };
}
/**
 * A mesh: one or more primitives drawn together
 * @internal
 */
export interface Mesh {
  primitives: MeshPrimitive[];
  /** Starting morph-target weights; a node's own `weights` override them */
  weights?: number[];
  name?: any;
}
/**
 * `KHR_node_visibility`: hides a node and everything under it when `visible` is `false`
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_node_visibility
 * @internal
 */
export interface KHRNodeVisibility {
  visible?: boolean;
}
/**
 * A node: a local transform plus an optional mesh, camera, skin or light
 *
 * The transform is either `matrix` or any of `translation`, `rotation` and `scale`.
 * @internal
 */
export interface Node {
  camera?: GltfId;
  children?: GltfId[];
  skin?: GltfId;
  /** Column-major 4x4 */
  matrix?: number[];
  mesh?: GltfId;
  /** Quaternion `(x, y, z, w)` */
  rotation?: number[];
  scale?: number[];
  translation?: number[];
  /** Morph-target weights for the node's mesh, overriding the mesh's own */
  weights?: number[];
  name?: any;
  extensions?: {
    KHR_lights_punctual?: { light: GltfId };
    KHR_node_visibility?: KHRNodeVisibility;
  };
}
/**
 * How a texture is filtered and wrapped
 * @internal
 */
export interface Sampler {
  /** GL enum: 9728 NEAREST, 9729 LINEAR */
  magFilter?: 9728 | 9729 | ({} & number);
  /** GL enum: 9728 NEAREST, 9729 LINEAR, 9984 to 9987 the four `*_MIPMAP_*` modes */
  minFilter?: 9728 | 9729 | 9984 | 9985 | 9986 | 9987 | ({} & number);
  /** GL enum: 33071 CLAMP_TO_EDGE, 33648 MIRRORED_REPEAT, 10497 REPEAT; defaults to REPEAT */
  wrapS?: 33071 | 33648 | 10497 | ({} & number);
  /** As `wrapS`, for the V axis */
  wrapT?: 33071 | 33648 | 10497 | ({} & number);
  name?: any;
}
/**
 * The root nodes of a scene
 * @internal
 */
export interface Scene {
  nodes?: GltfId[];
  name?: any;
}
/**
 * The joints and matrices of a skin
 * @internal
 */
export interface Skin {
  /** Accessor of one 4x4 matrix per joint; unset means every matrix is the identity */
  inverseBindMatrices?: GltfId;
  /** The joints' common root, or an ancestor of it */
  skeleton?: GltfId;
  joints: GltfId[];
  name?: any;
}
/**
 * A texture: an image and a sampler
 * @internal
 */
export interface Texture {
  /** Unset means repeat wrapping and automatic filtering */
  sampler?: GltfId;
  /** Unset when an extension supplies the image */
  source?: GltfId;
  name?: any;
}

/**
 * `KHR_draco_mesh_compression` on a mesh primitive
 *
 * The bufferView holds the Draco-encoded geometry. `attributes` maps each attribute name to the
 * id it was given in the Draco data.
 * @internal
 */
export interface KHRDracoMeshCompression {
  bufferView: GltfId;
  attributes: {
    [k: string]: number;
  };
}

/**
 * Meshopt compression of a bufferView: where the compressed bytes are and how to decode them
 *
 * `EXT_meshopt_compression` and its successor `KHR_meshopt_compression` share this shape. The KHR
 * version adds a newer encoding and a `COLOR` filter.
 * @internal
 */
export interface MeshoptCompression {
  buffer: GltfId;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
  filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
}

/**
 * Meshopt compression on a buffer, where `fallback` marks the buffer as a placeholder for data that
 * sits compressed in another buffer
 * @internal
 */
export interface MeshoptCompressionBuffer {
  fallback?: boolean;
}

/**
 * A light from `KHR_lights_punctual`
 * @internal
 */
export interface GltfLight {
  name?: string;
  /** Linear RGB; defaults to white */
  color?: number[];
  intensity?: number;
  type: 'directional' | 'point' | 'spot';
  /** Unset means infinite */
  range?: number;
  /** Cone angles in radians from the axis; they default to 0 and π/4 */
  spot?: {
    innerConeAngle?: number;
    outerConeAngle?: number;
  };
}

/**
 * Extensions on the glTF root
 * @internal
 */
export interface GltfExtensions {
  KHR_lights_punctual?: {
    lights: GltfLight[];
  };
}

/**
 * The root object of a glTF file
 *
 * A hand-kept part of the glTF 2.0 schema, covering what the loader works with. It has no
 * catch-all index signature, so an extension has to be declared here before the loader can read
 * it.
 * @internal
 */
export interface GltfFormat {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  accessors?: Accessor[];
  animations?: GltfAnimation[];
  asset: Asset;
  buffers?: Buffer[];
  bufferViews?: BufferView[];
  cameras?: Camera[];
  images?: Image[];
  materials?: Material[];
  meshes?: Mesh[];
  nodes?: Node[];
  samplers?: Sampler[];
  /** The scene to show on load; unset leaves the choice to the viewer */
  scene?: GltfId;
  scenes?: Scene[];
  skins?: Skin[];
  textures?: Texture[];
  extensions?: GltfExtensions;
}
