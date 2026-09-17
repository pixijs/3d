// Hand-maintained subset of the glTF 2.0 schema. Only fields and extensions
// pixi-3d reads or writes are declared. To support a new extension, declare
// it explicitly here first — there is deliberately no open-ended index
// signature to silently absorb unknown keys.

/**
 * Index into one of the glTF root arrays
 * @internal
 */
export type GltfId = number;
/**
 * Indices of those attributes that deviate from their initialization value
 * @internal
 */
export interface AccessorSparseIndices {
  /**
   * The index of the bufferView with sparse indices
   *
   * Referenced bufferView can't have ARRAY_BUFFER or ELEMENT_ARRAY_BUFFER target.
   */
  bufferView: GltfId;
  /** The offset relative to the start of the bufferView in bytes; must be aligned */
  byteOffset?: number;
  /** The indices data type */
  componentType: 5121 | 5123 | 5125 | ({} & number);
}
/**
 * Array of size `accessor.sparse.count` times number of components storing the displaced accessor attributes pointed by `accessor.sparse.indices`
 * @internal
 */
export interface AccessorSparseValues {
  /**
   * The index of the bufferView with sparse values
   *
   * Referenced bufferView can't have ARRAY_BUFFER or ELEMENT_ARRAY_BUFFER target.
   */
  bufferView: GltfId;
  /** The offset relative to the start of the bufferView in bytes; must be aligned */
  byteOffset?: number;
}
/**
 * Sparse storage of attributes that deviate from their initialization value
 * @internal
 */
export interface AccessorSparse {
  /** Number of entries stored in the sparse array */
  count: number;
  /**
   * Index array of size `count` that points to those accessor attributes that deviate from their initialization value
   *
   * Indices must strictly increase.
   */
  indices: AccessorSparseIndices;
  /**
   * Array of size `count` times number of components, storing the displaced accessor attributes pointed by `indices`
   *
   * Substituted values must have the same `componentType` and number of components as the base accessor.
   */
  values: AccessorSparseValues;
}
/**
 * A typed view into a bufferView
 *
 * A bufferView contains raw binary data. An accessor provides a typed view into a bufferView or a subset of a bufferView similar to how WebGL's `vertexAttribPointer()` defines an attribute in a buffer.
 * @internal
 */
export interface Accessor {
  /** The index of the bufferView */
  bufferView?: GltfId;
  /** The offset relative to the start of the bufferView in bytes */
  byteOffset?: number;
  /** The datatype of components in the attribute */
  componentType: 5120 | 5121 | 5122 | 5123 | 5125 | 5126 | ({} & number);
  /** Specifies whether integer data values should be normalized */
  normalized?: boolean;
  /** The number of attributes referenced by this accessor */
  count: number;
  /** Specifies if the attribute is a scalar, vector, or matrix */
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4' | ({} & string);
  /** Maximum value of each component in this attribute */
  max?: number[];
  /** Minimum value of each component in this attribute */
  min?: number[];
  /** Sparse storage of attributes that deviate from their initialization value */
  sparse?: AccessorSparse;
  name?: any;
}
/**
 * The index of the node and TRS property that an animation channel targets
 * @internal
 */
export interface AnimationChannelTarget {
  /** The index of the node to target */
  node?: GltfId;
  /**
   * The name of the node's TRS property to modify, or the "weights" of the Morph Targets it instantiates
   *
   * For the "translation" property, the values that are provided by the sampler are the translation along the x, y, and z axes. For the "rotation" property, the values are a quaternion in the order (x, y, z, w), where w is the scalar. For the "scale" property, the values are the scaling factors along the x, y, and z axes.
   */
  path: 'translation' | 'rotation' | 'scale' | 'weights' | ({} & string);
}
/**
 * Targets an animation's sampler at a node's property
 * @internal
 */
export interface AnimationChannel {
  /** The index of a sampler in this animation used to compute the value for the target */
  sampler: GltfId;
  /** The index of the node and TRS property to target */
  target: AnimationChannelTarget;
}
/**
 * Combines input and output accessors with an interpolation algorithm to define a keyframe graph (but not its target)
 * @internal
 */
export interface AnimationSampler {
  /** The index of an accessor containing keyframe input values, e.g., time */
  input: GltfId;
  /** Interpolation algorithm */
  interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' | ({} & string);
  /** The index of an accessor, containing keyframe output values */
  output: GltfId;
}
/**
 * A keyframe animation
 * @internal
 */
export interface GltfAnimation {
  /**
   * An array of channels, each of which targets an animation's sampler at a node's property
   *
   * Different channels of the same animation can't have equal targets.
   */
  channels: AnimationChannel[];
  /**
   * An array of samplers that combines input and output accessors with an interpolation algorithm to define a keyframe graph (but not its target)
   */
  samplers: AnimationSampler[];
  name?: any;
}
/**
 * Metadata about the glTF asset
 * @internal
 */
export interface Asset {
  /** A copyright message suitable for display to credit the content creator */
  copyright?: string;
  /** Tool that generated this glTF model, useful for debugging */
  generator?: string;
  /** The glTF version that this asset targets */
  version: string;
  /** The minimum glTF version that this asset targets */
  minVersion?: string;
}
/**
 * A buffer points to binary geometry, animation, or skins
 * @internal
 */
export interface Buffer {
  /** The uri of the buffer */
  uri?: string;
  /** The length of the buffer in bytes */
  byteLength: number;
  name?: any;
  extensions?: {
    EXT_meshopt_compression?: MeshoptCompressionBuffer;
    KHR_meshopt_compression?: MeshoptCompressionBuffer;
  };
}
/**
 * A view into a buffer generally representing a subset of the buffer
 * @internal
 */
export interface BufferView {
  /** The index of the buffer */
  buffer: GltfId;
  /** The offset into the buffer in bytes */
  byteOffset?: number;
  /** The total byte length of the buffer view */
  byteLength: number;
  /** The stride, in bytes */
  byteStride?: number;
  /** The target that the GPU buffer should be bound to */
  target?: 34962 | 34963 | ({} & number);
  name?: any;
  extensions?: {
    EXT_meshopt_compression?: MeshoptCompression;
    KHR_meshopt_compression?: MeshoptCompression;
  };
}
/**
 * An orthographic camera containing properties to create an orthographic projection matrix
 * @internal
 */
export interface CameraOrthographic {
  /** The floating-point horizontal magnification of the view; must not be zero */
  xmag: number;
  /** The floating-point vertical magnification of the view; must not be zero */
  ymag: number;
  /** The floating-point distance to the far clipping plane; must be greater than `znear` */
  zfar: number;
  /** The floating-point distance to the near clipping plane */
  znear: number;
}
/**
 * A perspective camera containing properties to create a perspective projection matrix
 * @internal
 */
export interface CameraPerspective {
  /** The floating-point aspect ratio of the field of view */
  aspectRatio?: number;
  /** The floating-point vertical field of view in radians */
  yfov: number;
  /** The floating-point distance to the far clipping plane */
  zfar?: number;
  /** The floating-point distance to the near clipping plane */
  znear: number;
}
/**
 * A camera's projection
 *
 * A node can reference a camera to apply a transform to place the camera in the scene.
 * @internal
 */
export interface Camera {
  /** An orthographic camera containing properties to create an orthographic projection matrix */
  orthographic?: CameraOrthographic;
  /** A perspective camera containing properties to create a perspective projection matrix */
  perspective?: CameraPerspective;
  /** Specifies if the camera uses a perspective or orthographic projection */
  type: 'perspective' | 'orthographic' | ({} & string);
  name?: any;
}
/**
 * Image data used to create a texture
 *
 * Image can be referenced by URI or `bufferView` index. `mimeType` is required in the latter case.
 * @internal
 */
export interface Image {
  /** The uri of the image */
  uri?: string;
  /** The image's MIME type; required if `bufferView` is defined */
  mimeType?: 'image/jpeg' | 'image/png' | ({} & string);
  /** The index of the bufferView that contains the image; use this instead of the image's `uri` */
  bufferView?: GltfId;
  name?: any;
}
/**
 * KHR_texture_transform extension on a TextureInfo
 *
 * See https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform
 * @internal
 */
export interface KHRTextureTransform {
  /** UV offset — defaults to [0, 0] */
  offset?: [number, number];
  /** Rotation in radians, counter-clockwise — defaults to 0 */
  rotation?: number;
  /** UV scale — defaults to [1, 1] */
  scale?: [number, number];
  /** Overrides the parent TextureInfo.texCoord; currently ignored (single UV set) */
  texCoord?: number;
}

/**
 * Reference to a texture
 * @internal
 */
export interface TextureInfo {
  /** The index of the texture */
  index: GltfId;
  /** The set index of texture's TEXCOORD attribute used for texture coordinate mapping */
  texCoord?: number;
  extensions?: {
    KHR_texture_transform?: KHRTextureTransform;
  };
}
/**
 * A set of parameter values that are used to define the metallic-roughness material model from Physically-Based Rendering (PBR) methodology
 * @internal
 */
export interface MaterialPbrMetallicRoughness {
  /** The material's base color factor */
  baseColorFactor?: number[];
  /** The base color texture */
  baseColorTexture?: TextureInfo;
  /** The metalness of the material */
  metallicFactor?: number;
  /** The roughness of the material */
  roughnessFactor?: number;
  /** The metallic-roughness texture */
  metallicRoughnessTexture?: TextureInfo;
}
/** @internal */
export interface MaterialNormalTextureInfo {
  index?: any;
  texCoord?: any;
  /** The scalar multiplier applied to each normal vector of the normal texture */
  scale?: number;
  extensions?: {
    KHR_texture_transform?: KHRTextureTransform;
  };
}
/** @internal */
export interface MaterialOcclusionTextureInfo {
  index?: any;
  texCoord?: any;
  /** A scalar multiplier controlling the amount of occlusion applied */
  strength?: number;
  extensions?: {
    KHR_texture_transform?: KHRTextureTransform;
  };
}
/**
 * KHR_materials_transmission — adds light transmission through thin surfaces
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_transmission
 * @internal
 */
export interface KHRMaterialsTransmission {
  transmissionFactor?: number;
  transmissionTexture?: TextureInfo;
}
/**
 * KHR_materials_volume — adds thickness/attenuation for volumetric refraction
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
 * KHR_materials_ior — overrides the dielectric index of refraction (default 1.5)
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_ior
 * @internal
 */
export interface KHRMaterialsIor {
  ior?: number;
}
/**
 * KHR_materials_iridescence — adds thin-film iridescence
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
 * KHR_materials_clearcoat — adds a clearcoat layer on top of the base material
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
 * KHR_materials_sheen — adds a soft retroreflective fabric-like response
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
 * KHR_materials_specular — overrides the dielectric F0 colour and strength
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
 * KHR_materials_anisotropy — directional roughness for brushed-metal / carbon-fibre looks
 *
 * `anisotropyTexture` packs the per-texel direction in RG (a [-1,1] vector encoded to
 * [0,1]) and the strength in B.
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy
 * @internal
 */
export interface KHRMaterialsAnisotropy {
  anisotropyStrength?: number;
  anisotropyRotation?: number;
  anisotropyTexture?: TextureInfo;
}
/**
 * KHR_materials_emissive_strength — multiplies emissive output beyond [0, 1]
 *
 * Note the field is `emissiveStrength` (not `emissiveStrengthFactor`).
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_emissive_strength
 * @internal
 */
export interface KHRMaterialsEmissiveStrength {
  emissiveStrength?: number;
}
/**
 * KHR_materials_unlit — marker extension; presence flips the material to an unlit shading model
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit
 * @internal
 */
export type KHRMaterialsUnlit = Record<string, never>;
/**
 * The material appearance of a primitive
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
  /**
   * A set of parameter values that are used to define the metallic-roughness material model from Physically-Based Rendering (PBR) methodology
   *
   * When not specified, all the default values of `pbrMetallicRoughness` apply.
   */
  pbrMetallicRoughness?: MaterialPbrMetallicRoughness;
  /** The normal map texture */
  normalTexture?: MaterialNormalTextureInfo;
  /** The occlusion map texture */
  occlusionTexture?: MaterialOcclusionTextureInfo;
  /** The emissive map texture */
  emissiveTexture?: TextureInfo;
  /** The emissive color of the material */
  emissiveFactor?: number[];
  /** The alpha rendering mode of the material */
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND' | ({} & string);
  /** The alpha cutoff value of the material */
  alphaCutoff?: number;
  /** Specifies whether the material is double sided */
  doubleSided?: boolean;
}
/**
 * Geometry to be rendered with the given material
 * @internal
 */
export interface MeshPrimitive {
  /**
   * A dictionary object, where each key corresponds to mesh attribute semantic and each value is the index of the accessor containing attribute's data
   */
  attributes: {
    [k: string]: GltfId;
  };
  /** The index of the accessor that contains the indices */
  indices?: GltfId;
  /** The index of the material to apply to this primitive when rendering */
  material?: GltfId;
  /** The type of primitives to render */
  mode?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | ({} & number);
  /**
   * An array of Morph Targets, each Morph Target is a dictionary mapping attributes (only `POSITION`, `NORMAL`, and `TANGENT` supported) to their deviations in the Morph Target
   */
  targets?: {
    [k: string]: GltfId;
  }[];
  extensions?: {
    KHR_draco_mesh_compression?: KHRDracoMeshCompression;
  };
}
/**
 * A set of primitives to be rendered
 *
 * A node can contain one mesh. A node's transform places the mesh in the scene.
 * @internal
 */
export interface Mesh {
  /** An array of primitives, each defining geometry to be rendered with a material */
  primitives: MeshPrimitive[];
  /** Array of weights to be applied to the Morph Targets */
  weights?: number[];
  name?: any;
}
/**
 * KHR_node_visibility — toggles a node (and its descendants) off when `visible === false`
 *
 * See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_node_visibility
 * @internal
 */
export interface KHRNodeVisibility {
  visible?: boolean;
}
/**
 * A node in the node hierarchy
 *
 * When the node contains `skin`, all `mesh.primitives` must contain `JOINTS_0` and `WEIGHTS_0` attributes. A node can have either a `matrix` or any combination of `translation`/`rotation`/`scale` (TRS) properties. TRS properties are converted to matrices and postmultiplied in the `T * R * S` order to compose the transformation matrix; first the scale is applied to the vertices, then the rotation, and then the translation. If none are provided, the transform is the identity. When a node is targeted for animation (referenced by an animation.channel.target), only TRS properties may be present; `matrix` will not be present.
 * @internal
 */
export interface Node {
  /** The index of the camera referenced by this node */
  camera?: GltfId;
  /** The indices of this node's children */
  children?: GltfId[];
  /** The index of the skin referenced by this node */
  skin?: GltfId;
  /** A floating-point 4x4 transformation matrix stored in column-major order */
  matrix?: number[];
  /** The index of the mesh in this node */
  mesh?: GltfId;
  /** The node's unit quaternion rotation in the order (x, y, z, w), where w is the scalar */
  rotation?: number[];
  /** The node's non-uniform scale, given as the scaling factors along the x, y, and z axes */
  scale?: number[];
  /** The node's translation along the x, y, and z axes */
  translation?: number[];
  /** The weights of the instantiated Morph Target, one per Morph Target of the used mesh */
  weights?: number[];
  name?: any;
  extensions?: {
    KHR_lights_punctual?: { light: GltfId };
    KHR_node_visibility?: KHRNodeVisibility;
  };
}
/**
 * Texture sampler properties for filtering and wrapping modes
 * @internal
 */
export interface Sampler {
  /** Magnification filter */
  magFilter?: 9728 | 9729 | ({} & number);
  /** Minification filter */
  minFilter?: 9728 | 9729 | 9984 | 9985 | 9986 | 9987 | ({} & number);
  /** S (horizontal) wrapping mode */
  wrapS?: 33071 | 33648 | 10497 | ({} & number);
  /** T (vertical) wrapping mode */
  wrapT?: 33071 | 33648 | 10497 | ({} & number);
  name?: any;
}
/**
 * The root nodes of a scene
 * @internal
 */
export interface Scene {
  /** The indices of each root node */
  nodes?: GltfId[];
  name?: any;
}
/**
 * Joints and matrices defining a skin
 * @internal
 */
export interface Skin {
  /**
   * The index of the accessor containing the floating-point 4x4 inverse-bind matrices
   *
   * The default is that each matrix is a 4x4 identity matrix, which implies that inverse-bind matrices were pre-applied.
   */
  inverseBindMatrices?: GltfId;
  /** The index of the node used as a skeleton root */
  skeleton?: GltfId;
  /** Indices of skeleton nodes, used as joints in this skin */
  joints: GltfId[];
  name?: any;
}
/**
 * A texture and its sampler
 * @internal
 */
export interface Texture {
  /**
   * The index of the sampler used by this texture
   *
   * When undefined, a sampler with repeat wrapping and auto filtering should be used.
   */
  sampler?: GltfId;
  /**
   * The index of the image used by this texture
   *
   * When undefined, it is expected that an extension or other mechanism will supply an alternate texture source, otherwise behavior is undefined.
   */
  source?: GltfId;
  name?: any;
}

/**
 * KHR_draco_mesh_compression extension on a mesh primitive
 *
 * The bufferView contains Draco-encoded geometry; attribute IDs map semantic names
 * to the Draco attribute IDs used when encoding.
 * @internal
 */
export interface KHRDracoMeshCompression {
  bufferView: GltfId;
  attributes: {
    [k: string]: number;
  };
}

/**
 * Meshopt compression extension data on a bufferView
 *
 * The same shape is used by both `EXT_meshopt_compression` (original) and
 * `KHR_meshopt_compression` (successor) — only the JSON key differs. Describes
 * where in the source buffer the compressed bytes live and how to reconstruct
 * the decoded output.
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
 * Meshopt compression extension data on a Buffer (not BufferView)
 *
 * The buffer is a fallback stub whose real data lives compressed in another
 * buffer; only the `fallback` flag is meaningful at this level.
 * @internal
 */
export interface MeshoptCompressionBuffer {
  fallback?: boolean;
}

/**
 * KHR_lights_punctual extension light definition
 * @internal
 */
export interface GltfLight {
  name?: string;
  color?: number[];
  intensity?: number;
  type: 'directional' | 'point' | 'spot';
  range?: number;
  spot?: {
    innerConeAngle?: number;
    outerConeAngle?: number;
  };
}

/**
 * Common glTF extensions
 * @internal
 */
export interface GltfExtensions {
  KHR_lights_punctual?: {
    lights: GltfLight[];
  };
}

/**
 * The root object for a glTF asset
 * @internal
 */
export interface GltfFormat {
  /** Names of glTF extensions used somewhere in this asset */
  extensionsUsed?: string[];
  /** Names of glTF extensions required to properly load this asset */
  extensionsRequired?: string[];
  /** An array of accessors */
  accessors?: Accessor[];
  /** An array of keyframe animations */
  animations?: GltfAnimation[];
  /** Metadata about the glTF asset */
  asset: Asset;
  /** An array of buffers */
  buffers?: Buffer[];
  /** An array of bufferViews */
  bufferViews?: BufferView[];
  /** An array of cameras */
  cameras?: Camera[];
  /** An array of images */
  images?: Image[];
  /** An array of materials */
  materials?: Material[];
  /** An array of meshes */
  meshes?: Mesh[];
  /** An array of nodes */
  nodes?: Node[];
  /** An array of samplers */
  samplers?: Sampler[];
  /** The index of the default scene */
  scene?: GltfId;
  /** An array of scenes */
  scenes?: Scene[];
  /** An array of skins */
  skins?: Skin[];
  /** An array of textures */
  textures?: Texture[];
  extensions?: GltfExtensions;
}
