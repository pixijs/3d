import type { UNIFORM_TYPES, VertexFormat } from 'pixi.js';

/** Shader source code mapped to template injection slots (e.g., `{{header}}`, `{{end}}`) */
type ShaderSlots<Slots extends readonly string[]> = Partial<Record<Slots[number], string>>;

/** Shader stages with optional vertex and fragment slot injections */
type ShaderStages<VERTEX_TAGS extends readonly string[], FRAGMENT_TAGS extends readonly string[]> = {
  /** Shared code appended to {{header}} slot (functions, constants, structs) */
  header?: string;
  vertex?: ShaderSlots<VERTEX_TAGS>;
  fragment?: ShaderSlots<FRAGMENT_TAGS>;
};

/**
 * WGSL scalar/vector types allowed for user-defined inter-stage varyings
 * @category rendering
 * @advanced
 */
export type InterStageType =
  | 'f32'
  | 'i32'
  | 'u32'
  | 'vec2<f32>'
  | 'vec3<f32>'
  | 'vec4<f32>'
  | 'vec2<i32>'
  | 'vec3<i32>'
  | 'vec4<i32>'
  | 'vec2<u32>'
  | 'vec3<u32>'
  | 'vec4<u32>';

type UserInterStage = {
  [K: string]: InterStageType;
} & {
  // disallow overwriting builtins inside UserInterStage
  position?: never;
  frontFacing?: never;
  sampleIndex?: never;
  sampleMask?: never;
};

/**
 * Inter-stage varyings a bit declares, keyed by name
 *
 * The reserved builtin slots (`position`, `frontFacing`, `sampleIndex`, `sampleMask`) are pinned
 * to their WGSL builtin types and cannot be overwritten by user varyings.
 * @category rendering
 * @advanced
 */
export type InterStage = {
  /** Clip-space position builtin (`@builtin(position)`); pinned to `vec4<f32>` */
  position?: 'vec4<f32>';
  /** Front-facing fragment builtin (`@builtin(front_facing)`); pinned to `bool` */
  frontFacing?: 'bool';
  /** MSAA sample-index builtin (`@builtin(sample_index)`); pinned to `u32` */
  sampleIndex?: 'u32';
  /** Coverage-mask builtin (`@builtin(sample_mask)`); pinned to `u32` */
  sampleMask?: 'u32';
} & UserInterStage;

type TextureResourceType =
  // 2D
  | 'texture_2d<f32>'
  | 'texture_2d_array<f32>'

  // 3D
  | 'texture_3d<f32>'

  // cube maps
  | 'texture_cube<f32>'
  | 'texture_cube_array<f32>'

  // depth (for shadows, depth-based effects)
  | 'texture_depth_2d'
  | 'texture_depth_2d_array'
  | 'texture_depth_cube'
  | 'texture_depth_cube_array';

type SamplerResourceType = 'sampler' | 'sampler_comparison';

/**
 * WGSL texture or sampler resource type usable in a binding
 * @category rendering
 * @advanced
 */
export type ResourceType = TextureResourceType | SamplerResourceType;

/**
 * A struct definition mapping field names to WGSL types
 * @category rendering
 * @advanced
 */
export type StructDefinition = Record<string, UNIFORM_TYPES | 'u32'>;

type StorageType<StructName extends string> = `storage<${StructName}>`;

/**
 * The WGSL type of a single binding (uniform field, resource, or storage buffer)
 * @category rendering
 * @advanced
 */
export type BindingType = UNIFORM_TYPES | ResourceType | StorageType<string>;

/**
 * Shader stages a binding is visible to, for the WebGPU pipeline layout
 *
 * WebGPU caps storage buffers *per stage* (`maxStorageBuffersPerShaderStage`), so a
 * buffer read only in one stage should be tagged to it — a `VERTEX | FRAGMENT`
 * default spends a slot in both budgets. WebGL ignores this (no per-stage cap).
 * @category rendering
 * @advanced
 */
export type BindingVisibility = 'vertex' | 'fragment' | 'both';

/**
 * A binding's declaration: the bare WGSL {@link BindingType} (visibility defaults
 * to `'both'`), or `{ type, visibility }` to narrow which stages may access it
 * @category rendering
 * @advanced
 */
export type BindingSpec =
  | BindingType
  | {
      /** The binding's WGSL type */
      type: BindingType;
      /** Stages that may access the binding; defaults to `'both'` */
      visibility?: BindingVisibility;
    };

/**
 * A group of uniforms/resources (e.g., `{ uTime: 'f32', uTexture: 'texture_2d<f32>' }`)
 * @category rendering
 * @advanced
 */
export type BindingGroup = Record<string, BindingSpec>;

/**
 * WebGPU/WGSL specialization constant type
 *
 * These are declared with WGSL `override` and provided via WebGPU pipeline `constants`.
 * @category rendering
 * @advanced
 */
export type ShaderOverrideType = 'f32' | 'i32' | 'u32';

/**
 * Declaration of a WGSL `override` specialization constant: either a default value or `required`
 * @category rendering
 * @advanced
 */
export type ShaderOverrideDef<T extends ShaderOverrideType = ShaderOverrideType> =
  | {
      /** WGSL scalar type of the override constant */
      type: T;
      /** Default value used if the shader doesn't provide an override value */
      default: number;
      /** Mutually exclusive with `default` */
      required?: never;
    }
  | {
      /** WGSL scalar type of the override constant */
      type: T;
      /** If true, the shader must provide a value for this override */
      required: true;
      /** Mutually exclusive with `required` */
      default?: never;
    };

/** Shader bindings organized by named groups (e.g., `global`, `material`, `local`) */
type ShaderBindings<BIND_GROUPS extends readonly string[]> = Partial<Record<BIND_GROUPS[number], BindingGroup>>;

/**
 * A modular shader component that can be composed into a full shader
 *
 * Type parameters:
 * - `VERTEX_TAGS` - Vertex shader template injection slots (e.g., `["header", "input", "beforeTransform", "afterTransform", "end"]`)
 * - `FRAGMENT_TAGS` - Fragment shader template injection slots (e.g., `["header", "end"]`)
 * - `BIND_GROUPS` - Bind group names for bindings (e.g., `["global", "material", "local"]`)
 * @example
 * ```ts
 * const colorBit: ShaderBit = {
 *   name: "color",
 *   attributes: {
 *     aPosition: "float32x3",
 *     aColor: "float32x4",
 *   },
 *   interStage: {
 *     vColor: "vec4<f32>",
 *   },
 *   bindings: {
 *     global: { uTime: "f32" },
 *     material: { uColor: "vec4<f32>" },
 *   },
 *   gpu: {
 *     vertex: { input: "output.vColor = input.aColor;" },
 *     fragment: { end: "return input.vColor * material.uColor;" },
 *   },
 *   gl: {
 *     vertex: { input: "vColor = aColor;" },
 *     fragment: { end: "fragColor = vColor * uColor;" },
 *   },
 * };
 * ```
 * @category rendering
 * @advanced
 */
export type ShaderBit<
  VERTEX_TAGS extends readonly string[] = readonly string[],
  FRAGMENT_TAGS extends readonly string[] = readonly string[],
  BIND_GROUPS extends readonly string[] = readonly string[],
> = {
  /** Unique bit name, used for registry identity and debugging */
  name: string;
  /** Vertex attributes this bit consumes, keyed by attribute name */
  attributes?: Record<string, VertexFormat>;
  /** Inter-stage varyings this bit declares */
  interStage?: InterStage;
  /** Named WGSL struct definitions this bit contributes */
  structs?: Record<string, StructDefinition>;
  /** Bindings this bit contributes, grouped by bind-group name */
  bindings?: ShaderBindings<BIND_GROUPS>;
  /**
   * WebGPU pipeline specialization constants (WGSL `override`)
   *
   * These are compiled into the WGSL module as `override` declarations and can be set per-shader
   * via `Shader.overrides` (Pixi) which flows into pipeline `constants`.
   */
  overrideDefs?: Record<string, ShaderOverrideDef>;
  /**
   * Texture slots this bit contributes
   *
   * Each entry is a camelCase name (e.g. `'transmission'`).
   *
   * **Dynamic Texture Packing:**
   * To keep shaders efficient and avoid binding maximum textures for simple materials,
   * 3D materials use a "dynamic texture packing" system. When a material is used,
   * its enabled features (e.g. transmission, iridescence) push their required textures
   * into a single, flat `material._textures` array.
   *
   * At shader compile time, the compiler's `texturesPlugin` walks all active bits
   * in order, assigns a sequential 4-bit index to each declared `texture` name,
   * and generates a dedicated `sampleX(uv)` helper function (e.g. `sampleTransmission(uv)`).
   * These generated functions automatically handle unpacking the correct texture index
   * and computing derivatives for mipmapping.
   * @example
   * ```ts
   * const myBit: ShaderBit = {
   *   name: 'myFeature',
   *   textures: ['myCustomMap'],
   *   gpu: { fragment: { material: 'let color = sampleMyCustomMap(input.vUV);' } }
   * }
   * ```
   */
  textures?: string[];
  /** WGSL sources injected into the template's vertex/fragment slots */
  gpu?: ShaderStages<VERTEX_TAGS, FRAGMENT_TAGS>;
  /** GLSL sources injected into the template's vertex/fragment slots */
  gl?: ShaderStages<VERTEX_TAGS, FRAGMENT_TAGS>;

  /**
   * Identity-registry stamp — set by `assertBitIdentity` after this bit's name is verified
   * @internal
   */
  _identityChecked?: boolean;
  /**
   * Lazy content snapshot used to adjudicate name collisions (see `bitRegistry`)
   * @internal
   */
  _contentSnapshot?: string;
};
