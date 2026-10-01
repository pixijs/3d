import type { UNIFORM_TYPES, VertexFormat } from 'pixi.js';

/** One stage's code, keyed by the template slot it fills */
type ShaderSlots<Slots extends readonly string[]> = Partial<Record<Slots[number], string>>;

/** One backend's code for a bit: a shared header plus each stage's slots */
type ShaderStages<VERTEX_TAGS extends readonly string[], FRAGMENT_TAGS extends readonly string[]> = {
  /** Code for the template's `{{header}}` slot, such as functions and constants; GLSL puts it in both stages */
  header?: string;
  vertex?: ShaderSlots<VERTEX_TAGS>;
  fragment?: ShaderSlots<FRAGMENT_TAGS>;
};

/**
 * The WGSL types a varying can have; integer types are flat-interpolated on both backends
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

/** Varyings a bit names itself; the `never` members keep the builtin names out */
type UserInterStage = {
  [K: string]: InterStageType;
} & {
  position?: never;
  frontFacing?: never;
  sampleIndex?: never;
  sampleMask?: never;
};

/**
 * The varyings a bit declares, keyed by name
 *
 * The builtin names `position`, `frontFacing`, `sampleIndex` and `sampleMask` are reserved, and the
 * type rejects them. The compiler declares `input.position` and `input.frontFacing` in every WGSL
 * fragment input itself; GLSL reads `gl_FragCoord` and `gl_FrontFacing` instead.
 * @category rendering
 * @advanced
 */
export type InterStage = {
  /** Reserved for `@builtin(position)`, which the compiler declares */
  position?: 'vec4<f32>';
  /** Reserved for `@builtin(front_facing)`, which the compiler declares */
  frontFacing?: 'bool';
  /** Reserved for `@builtin(sample_index)` */
  sampleIndex?: 'u32';
  /** Reserved for `@builtin(sample_mask)` */
  sampleMask?: 'u32';
} & UserInterStage;

/**
 * The texture half of {@link ResourceType}
 *
 * `RESOURCE_TYPES` in `codegen/parseBindingType.ts` lists these and the sampler types, and must stay
 * in step with them.
 */
type TextureResourceType =
  | 'texture_2d<f32>'
  | 'texture_2d<u32>'
  | 'texture_2d<i32>'
  | 'texture_2d_array<f32>'
  | 'texture_3d<f32>'
  | 'texture_cube<f32>'
  | 'texture_cube_array<f32>'
  | 'texture_depth_2d'
  | 'texture_depth_2d_array'
  | 'texture_depth_cube'
  | 'texture_depth_cube_array';

type SamplerResourceType = 'sampler' | 'sampler_comparison';

/**
 * WGSL texture or sampler resource type usable in a binding
 *
 * The type in angle brackets is what a read returns. It has to match the format of the texture
 * bound to the slot:
 *
 * - `texture_2d<f32>` for float and normalised formats, such as `rgba8unorm` or `rgba16float`
 * - `texture_2d<u32>` for unsigned integer formats, such as `rgba32uint`
 * - `texture_2d<i32>` for signed integer formats, such as `rgba32sint`
 *
 * A 32-bit float format such as `rgba32float` binds to `texture_2d<f32>` on WebGL only. WebGPU
 * rejects it, because the binding asks for a filterable texture.
 *
 * An integer texture returns the exact integers that were stored, and it can't be filtered. Read
 * it with `textureLoad` in WGSL and `texelFetch` in GLSL.
 *
 * With a texture of the wrong kind bound, WebGL fails the draw and WebGPU rejects the bind group.
 * @category rendering
 * @advanced
 */
export type ResourceType = TextureResourceType | SamplerResourceType;

/**
 * A struct's fields, name to WGSL type, in memory order
 *
 * The `Material` struct is the exception: the compiler reorders its fields to pack them tightly.
 * @category rendering
 * @advanced
 */
export type StructDefinition = Record<string, UNIFORM_TYPES | 'u32'>;

type StorageType<StructName extends string> = `storage<${StructName}>`;

/**
 * The WGSL type of one binding: a uniform field, a texture or sampler, or a `storage<StructName>`
 * buffer
 * @category rendering
 * @advanced
 */
export type BindingType = UNIFORM_TYPES | ResourceType | StorageType<string>;

/**
 * The shader stages a binding is visible to in the WebGPU pipeline layout
 *
 * WebGPU limits storage buffers per stage (`maxStorageBuffersPerShaderStage`), and a buffer visible
 * to both stages counts against both limits. Tag a buffer that only one stage reads with that
 * stage. WebGL has no such limit and ignores this.
 * @category rendering
 * @advanced
 */
export type BindingVisibility = 'vertex' | 'fragment' | 'both';

/**
 * A binding's declaration: the bare WGSL {@link BindingType}, visible to both stages, or
 * `{ type, visibility }` to narrow the stages
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
 * One bind group's bindings, keyed by name, such as `{ uTime: 'f32', uTexture: 'texture_2d<f32>' }`
 *
 * A group's uniform fields share one uniform struct, which takes the group's first binding.
 * Textures and samplers follow, then storage buffers.
 * @category rendering
 * @advanced
 */
export type BindingGroup = Record<string, BindingSpec>;

/**
 * The scalar type of a specialization constant
 *
 * WebGPU declares the constant with WGSL `override` and sets it through the pipeline's
 * `constants`. WebGL has no specialization constants, so the value is baked into the GLSL as a
 * `#define`.
 * @category rendering
 * @advanced
 */
export type ShaderOverrideType = 'f32' | 'i32' | 'u32';

/**
 * A specialization constant a bit declares: a `default`, or `required: true`
 *
 * The value comes from the descriptor's `overrides`. Bits that declare the same constant must
 * agree on its type and default, or the compile throws.
 * @category rendering
 * @advanced
 */
export type ShaderOverrideDef<T extends ShaderOverrideType = ShaderOverrideType> =
  | {
      /** The constant's scalar type */
      type: T;
      /** The value used when the descriptor's `overrides` gives none */
      default: number;
      /** Not allowed alongside `default` */
      required?: never;
    }
  | {
      /** The constant's scalar type */
      type: T;
      /** The descriptor's `overrides` must give a value; WebGL compilation throws without one */
      required: true;
      /** Not allowed alongside `required` */
      default?: never;
    };

/** A bit's bindings, keyed by bind group name */
type ShaderBindings<BIND_GROUPS extends readonly string[]> = Partial<Record<BIND_GROUPS[number], BindingGroup>>;

/**
 * One piece of a shader: the attributes, varyings, bindings and code it adds to a template
 *
 * A {@link ShaderDescriptor} lists the bits, and the compiler merges them into one program per
 * backend, filling each template slot with the bits' code in list order.
 *
 * The type parameters narrow the slot and group names a bit may use:
 * - `VERTEX_TAGS`: the vertex slots, such as `['input', 'beforeTransform', 'afterTransform', 'end']`
 * - `FRAGMENT_TAGS`: the fragment slots, such as `['material', 'lighting', 'end']`
 * - `BIND_GROUPS`: the bind group names, such as `['global', 'camera', 'material']`
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
 *     fragment: { end: "fragColor = vColor * material.uColor;" },
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
  /**
   * A unique name
   *
   * Compiled shaders are cached by the names of their bits, so two different bits that share a
   * name throw rather than share a shader.
   */
  name: string;
  /** The vertex attributes this bit reads; a name redeclared with another format warns, and the first wins */
  attributes?: Record<string, VertexFormat>;
  /** The varyings this bit declares; a name redeclared with another type warns, and the first wins */
  interStage?: InterStage;
  /**
   * WGSL structs this bit declares, keyed by struct name
   *
   * The first bit to declare a name wins, and later declarations are dropped without a warning,
   * so bits that share a struct should import one definition.
   */
  structs?: Record<string, StructDefinition>;
  /**
   * The bindings this bit adds, keyed by bind group name
   *
   * Fields in the `material` group become fields of the `Material` struct, read as
   * `material.<name>`. The group isn't bound; each material's values live in a row of a shared
   * store, so texture and sampler types in it are dropped. Declare textures in `textures`.
   */
  bindings?: ShaderBindings<BIND_GROUPS>;
  /**
   * Specialization constants, keyed by name
   *
   * WebGPU declares them as WGSL `override` constants and sets them per pipeline. WebGL bakes the
   * value into the GLSL as a `#define`. The values come from the descriptor's `overrides`.
   */
  overrideDefs?: Record<string, ShaderOverrideDef>;
  /**
   * The textures this bit samples, as camelCase names such as `'transmission'`
   *
   * Each name gets two generated WGSL and GLSL helpers. `sampleX(uv)`, such as
   * `sampleTransmission(uv)`, takes its mip level from the fragment's derivatives, so it works in
   * the fragment stage only. `sampleXDirect(uv)` reads mip level 0 and works in either stage, so a
   * vertex displacement bit can use it.
   *
   * A material binds its textures in the order its bits declare them, and each draw packs their
   * batch slots four bits apiece into one 32-bit word. That caps a material at eight textures
   * across all of its bits.
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
  /**
   * The WGSL code for the WebGPU backend
   *
   * The template names each stage slot with the stage prefix, so `vertex.input` fills
   * `{{vertexInput}}` and `fragment.end` fills `{{fragmentEnd}}`.
   *
   * Every compiled module turns off WGSL's `derivative_uniformity` diagnostic, which the batch
   * texture samplers need. So the compiler won't reject a `textureSample`, `dpdx` or `dpdy` in a
   * branch it can't prove uniform. Keep them in uniform control flow yourself: in a non-uniform
   * branch the derivative, and so the mip level, is undefined.
   */
  gpu?: ShaderStages<VERTEX_TAGS, FRAGMENT_TAGS>;
  /**
   * The GLSL code for the WebGL backend
   *
   * Each stage compiles from its own template, so slot names carry no prefix: `vertex.input` fills
   * the vertex template's `{{input}}`.
   */
  gl?: ShaderStages<VERTEX_TAGS, FRAGMENT_TAGS>;

  /**
   * Set by `assertBitIdentity` once this bit owns its name, so later checks are one read
   * @internal
   */
  _identityChecked?: boolean;
  /**
   * This bit's serialized content, built only when another bit claims the same name
   * @internal
   */
  _contentSnapshot?: string;
};
