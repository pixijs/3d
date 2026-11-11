/* unused-internal-disable -- These types mirror the glTF 2.0 schema, including fields the loader never reads */
/**
 * The glTF 2.0 schema, namespaced so `GltfFormat.Camera` can't be mistaken for the engine's camera
 * @internal
 */
export namespace GltfFormat {
  /** @internal */
  export type Id = number;
  /** @internal */
  export interface AccessorSparseIndices {
    bufferView: Id;
    byteOffset?: number;
    componentType: 5121 | 5123 | 5125 | ({} & number);
  }
  /** @internal */
  export interface AccessorSparseValues {
    bufferView: Id;
    byteOffset?: number;
  }
  /** @internal */
  export interface AccessorSparse {
    count: number;
    indices: AccessorSparseIndices;
    values: AccessorSparseValues;
  }
  /** @internal */
  export interface Accessor {
    /** Unset for an accessor of all zeros, which `sparse` then fills in */
    bufferView?: Id;
    byteOffset?: number;
    componentType: 5120 | 5121 | 5122 | 5123 | 5125 | 5126 | ({} & number);
    normalized?: boolean;
    count: number;
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4' | ({} & string);
    max?: number[];
    min?: number[];
    sparse?: AccessorSparse;
    name?: string;
  }
  /** @internal */
  export interface AnimationChannelTarget {
    node?: Id;
    path: 'translation' | 'rotation' | 'scale' | 'weights' | ({} & string);
  }
  /** @internal */
  export interface AnimationChannel {
    sampler: Id;
    target: AnimationChannelTarget;
  }
  /** @internal */
  export interface AnimationSampler {
    input: Id;
    interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' | ({} & string);
    output: Id;
  }
  /** @internal */
  export interface Animation {
    channels: AnimationChannel[];
    samplers: AnimationSampler[];
    name?: string;
  }
  /** @internal */
  export interface Asset {
    copyright?: string;
    generator?: string;
    version: string;
    minVersion?: string;
  }
  /** @internal */
  export interface Buffer {
    /** Unset for a GLB's own binary chunk and for a meshopt fallback */
    uri?: string;
    byteLength: number;
    name?: string;
    extensions?: {
      EXT_meshopt_compression?: MeshoptCompressionBuffer;
      KHR_meshopt_compression?: MeshoptCompressionBuffer;
    };
  }
  /** @internal */
  export interface BufferView {
    buffer: Id;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: 34962 | 34963 | ({} & number);
    name?: string;
    extensions?: {
      EXT_meshopt_compression?: MeshoptCompression;
      KHR_meshopt_compression?: MeshoptCompression;
    };
  }
  /** @internal */
  export interface CameraOrthographic {
    xmag: number;
    ymag: number;
    zfar: number;
    znear: number;
  }
  /** @internal */
  export interface CameraPerspective {
    aspectRatio?: number;
    yfov: number;
    zfar?: number;
    znear: number;
  }
  /** @internal */
  export interface Camera {
    orthographic?: CameraOrthographic;
    perspective?: CameraPerspective;
    type: 'perspective' | 'orthographic' | ({} & string);
    name?: string;
  }
  /** @internal */
  export interface Image {
    uri?: string;
    mimeType?: 'image/jpeg' | 'image/png' | ({} & string);
    bufferView?: Id;
    name?: string;
  }
  /** @internal */
  export interface KHRTextureTransform {
    offset?: [number, number];
    rotation?: number;
    scale?: [number, number];
    texCoord?: number;
  }

  /** @internal */
  export interface TextureInfo {
    index: Id;
    texCoord?: number;
    extensions?: {
      KHR_texture_transform?: KHRTextureTransform;
    };
  }
  /** @internal */
  export interface MaterialPbrMetallicRoughness {
    baseColorFactor?: number[];
    baseColorTexture?: TextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: TextureInfo;
  }
  /** @internal */
  export interface MaterialNormalTextureInfo {
    index: Id;
    texCoord?: number;
    scale?: number;
    extensions?: {
      KHR_texture_transform?: KHRTextureTransform;
    };
  }
  /** @internal */
  export interface MaterialOcclusionTextureInfo {
    index: Id;
    texCoord?: number;
    strength?: number;
    extensions?: {
      KHR_texture_transform?: KHRTextureTransform;
    };
  }
  /** @internal */
  export interface KHRMaterialsTransmission {
    transmissionFactor?: number;
    transmissionTexture?: TextureInfo;
  }
  /** @internal */
  export interface KHRMaterialsVolume {
    thicknessFactor?: number;
    thicknessTexture?: TextureInfo;
    attenuationDistance?: number;
    attenuationColor?: number[];
  }
  /** @internal */
  export interface KHRMaterialsIor {
    ior?: number;
  }
  /** @internal */
  export interface KHRMaterialsIridescence {
    iridescenceFactor?: number;
    iridescenceIor?: number;
    iridescenceThicknessMinimum?: number;
    iridescenceThicknessMaximum?: number;
    iridescenceTexture?: TextureInfo;
    iridescenceThicknessTexture?: TextureInfo;
  }
  /** @internal */
  export interface KHRMaterialsClearcoat {
    clearcoatFactor?: number;
    clearcoatRoughnessFactor?: number;
    clearcoatTexture?: TextureInfo;
    clearcoatRoughnessTexture?: TextureInfo;
    clearcoatNormalTexture?: MaterialNormalTextureInfo;
  }
  /** @internal */
  export interface KHRMaterialsSheen {
    sheenColorFactor?: number[];
    sheenRoughnessFactor?: number;
    sheenColorTexture?: TextureInfo;
    sheenRoughnessTexture?: TextureInfo;
  }
  /** @internal */
  export interface KHRMaterialsSpecular {
    specularFactor?: number;
    specularColorFactor?: number[];
    specularTexture?: TextureInfo;
    specularColorTexture?: TextureInfo;
  }
  /** @internal */
  export interface KHRMaterialsAnisotropy {
    anisotropyStrength?: number;
    anisotropyRotation?: number;
    anisotropyTexture?: TextureInfo;
  }
  /** @internal */
  export interface KHRMaterialsEmissiveStrength {
    emissiveStrength?: number;
  }
  /** @internal */
  export type KHRMaterialsUnlit = Record<string, never>;
  /** @internal */
  export interface Material {
    name?: string;
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
    pbrMetallicRoughness?: MaterialPbrMetallicRoughness;
    normalTexture?: MaterialNormalTextureInfo;
    occlusionTexture?: MaterialOcclusionTextureInfo;
    emissiveTexture?: TextureInfo;
    emissiveFactor?: number[];
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND' | ({} & string);
    alphaCutoff?: number;
    doubleSided?: boolean;
  }
  /** @internal */
  export interface MeshPrimitive {
    attributes: {
      [k: string]: Id;
    };
    indices?: Id;
    material?: Id;
    mode?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | ({} & number);
    targets?: {
      [k: string]: Id;
    }[];
    extensions?: {
      KHR_draco_mesh_compression?: KHRDracoMeshCompression;
    };
  }
  /** @internal */
  export interface Mesh {
    primitives: MeshPrimitive[];
    weights?: number[];
    name?: string;
  }
  /** @internal */
  export interface KHRNodeVisibility {
    visible?: boolean;
  }
  /** @internal */
  export interface Node {
    camera?: Id;
    children?: Id[];
    skin?: Id;
    matrix?: number[];
    mesh?: Id;
    rotation?: number[];
    scale?: number[];
    translation?: number[];
    weights?: number[];
    name?: string;
    extensions?: {
      KHR_lights_punctual?: { light: Id };
      KHR_node_visibility?: KHRNodeVisibility;
    };
  }
  /** @internal */
  export interface Sampler {
    magFilter?: 9728 | 9729 | ({} & number);
    minFilter?: 9728 | 9729 | 9984 | 9985 | 9986 | 9987 | ({} & number);
    wrapS?: 33071 | 33648 | 10497 | ({} & number);
    wrapT?: 33071 | 33648 | 10497 | ({} & number);
    name?: string;
  }
  /** @internal */
  export interface Scene {
    nodes?: Id[];
    name?: string;
  }
  /** @internal */
  export interface Skin {
    /** Accessor of one 4x4 matrix per joint; unset means every matrix is the identity */
    inverseBindMatrices?: Id;
    skeleton?: Id;
    joints: Id[];
    name?: string;
  }
  /** @internal */
  export interface Texture {
    sampler?: Id;
    /** Unset when an extension supplies the image */
    source?: Id;
    name?: string;
    extensions?: {
      KHR_texture_basisu?: TextureImageExtension;
      EXT_texture_webp?: TextureImageExtension;
      EXT_texture_avif?: TextureImageExtension;
    };
  }
  /** @internal */
  export interface TextureImageExtension {
    source: Id;
  }

  /** @internal */
  export interface KHRDracoMeshCompression {
    bufferView: Id;
    attributes: {
      [k: string]: number;
    };
  }

  /** @internal */
  export interface MeshoptCompression {
    buffer: Id;
    byteOffset?: number;
    byteLength: number;
    byteStride: number;
    count: number;
    mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
    filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
  }

  /** @internal */
  export interface MeshoptCompressionBuffer {
    fallback?: boolean;
  }

  /** @internal */
  export interface Light {
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

  /** @internal */
  export interface Extensions {
    KHR_lights_punctual?: {
      lights: Light[];
    };
  }
}

/** @internal */
export interface GltfFormat {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  accessors?: GltfFormat.Accessor[];
  animations?: GltfFormat.Animation[];
  asset: GltfFormat.Asset;
  buffers?: GltfFormat.Buffer[];
  bufferViews?: GltfFormat.BufferView[];
  cameras?: GltfFormat.Camera[];
  images?: GltfFormat.Image[];
  materials?: GltfFormat.Material[];
  meshes?: GltfFormat.Mesh[];
  nodes?: GltfFormat.Node[];
  samplers?: GltfFormat.Sampler[];
  scene?: GltfFormat.Id;
  scenes?: GltfFormat.Scene[];
  skins?: GltfFormat.Skin[];
  textures?: GltfFormat.Texture[];
  extensions?: GltfFormat.Extensions;
}
