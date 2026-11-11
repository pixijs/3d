import type { UNIFORM_TYPES, VertexFormat } from 'pixi.js';

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

/**
 * The varyings a bit declares, keyed by name
 *
 * `position`, `frontFacing`, `sampleIndex` and `sampleMask` are reserved. WGSL fragment code reads
 * `input.position` and `input.frontFacing` without declaring them; GLSL reads `gl_FragCoord` and
 * `gl_FrontFacing`.
 * @category rendering
 * @advanced
 */
export type InterStage = { [K: string]: InterStageType } & {
  /** Reserved for `@builtin(position)`, which the compiler declares */
  position?: never;
  /** Reserved for `@builtin(front_facing)`, which the compiler declares */
  frontFacing?: never;
  /** Reserved for `@builtin(sample_index)` */
  sampleIndex?: never;
  /** Reserved for `@builtin(sample_mask)` */
  sampleMask?: never;
};

/**
 * The WGSL types a fragment output can have: the same scalars and vectors a varying can have
 *
 * A blended draw blends every float output with its blend mode, and on WebGPU a blend mode that
 * reads alpha, such as `'normal'`, needs the output written as a `vec4<f32>`. Integer outputs never
 * blend.
 * @category rendering
 * @advanced
 */
export type FragmentOutputType = InterStageType;

/**
 * WGSL texture or sampler resource type usable in a binding
 *
 * The type in angle brackets is what a read returns, and it has to match the bound texture's format:
 *
 * - `texture_2d<f32>` for float and normalised formats, such as `rgba8unorm` or `rgba16float`
 * - `texture_2d<u32>` for unsigned integer formats, such as `rgba32uint`
 * - `texture_2d<i32>` for signed integer formats, such as `rgba32sint`
 *
 * A wrong kind fails the draw on WebGL and the bind group on WebGPU. WebGPU also rejects a 32-bit
 * float format such as `rgba32float`, which can't be filtered. Integer textures can't be filtered
 * either: read them with `textureLoad` in WGSL and `texelFetch` in GLSL.
 * @category rendering
 * @advanced
 */
export type ResourceType =
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
  | 'texture_depth_cube_array'
  | 'sampler'
  | 'sampler_comparison';

/**
 * A struct's fields, name to WGSL type, in memory order
 * @category rendering
 * @advanced
 */
export type StructDefinition = Record<string, UNIFORM_TYPES | 'u32'>;

/**
 * A uniform buffer holding one struct, `uniform<StructName>`, bound as a `BufferResource` range
 *
 * The struct comes from the bits' `structs`, or from the fields of a group the template doesn't
 * bind. WGSL reads a `wind` binding as `wind.<field>` and GLSL as `uWind.<field>`, except that
 * GLSL splits a `mat2x2<f32>` field into `<field>_0` and `<field>_1`. Fill the buffer in WGSL's
 * layout. GLSL's `std140` matches it for scalars, vectors, `mat2x2<f32>`, matrices of `vec3` or
 * `vec4` columns, and arrays of 16-byte elements, and the GLSL compile refuses any other field.
 *
 * Only a bind group your own pass builds can hold one. One declared in the engine's `global`,
 * `camera` or `batch` group is never bound: WebGL skips the draw and WebGPU throws at the first
 * draw. Put per-material values in the bit's `material` fields instead, and read them through the
 * `material` local, never `uMaterial`, which a draw that merges materials doesn't declare.
 * @category rendering
 * @advanced
 */
export type UniformBufferType<StructName extends string> = `uniform<${StructName}>`;

/**
 * The WGSL type of one binding: a uniform field, a texture or sampler, a storage buffer, or a
 * uniform buffer
 *
 * A storage buffer is `storage<ElementType>`, an array of a struct, a scalar or a vector, such as
 * `storage<Renderable>` or `storage<vec4<u32>>`. A uniform buffer is {@link UniformBufferType}.
 * @category rendering
 * @advanced
 */
export type BindingType = UNIFORM_TYPES | ResourceType | `storage<${string}>` | UniformBufferType<string>;

/**
 * The shader stages a binding is visible to on WebGPU
 *
 * WebGPU limits storage buffers per stage (`maxStorageBuffersPerShaderStage`), and a buffer visible
 * to both stages counts against both limits, so tag a buffer that one stage reads with that stage.
 * WebGL ignores it.
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
 * A uniform group of its own inside a bind group: its uniform fields, keyed by name
 *
 * It binds to a `UniformGroup` apart from the bind group's own. Use one for values that change at a
 * different rate, since a write to them uploads nothing else. Bits that declare the same name add
 * to one group. WGSL reads a field as `<group>.<field>`, and GLSL as a plain uniform, `<field>`,
 * whatever the template's `ubo` says.
 *
 * Only a bind group your own pass builds can hold one. One declared in the engine's `global`,
 * `camera` or `batch` group is never bound: WebGL reads zeros and WebGPU throws at the first draw.
 * @category rendering
 * @advanced
 */
export type UniformGroupBindings = Record<string, BindingSpec>;

/**
 * One bind group's bindings, keyed by name, such as `{ uTime: 'f32', uTexture: 'texture_2d<f32>' }`
 *
 * A group's uniform fields share one uniform struct, which takes the group's first binding.
 * Textures and samplers follow, then storage buffers, then uniform buffers, then the
 * {@link UniformGroupBindings} declared inside it, one binding each, as in
 * `{ batchTransform: { uBatchWorldMatrix: 'mat4x4<f32>' } }`.
 * @category rendering
 * @advanced
 */
export type BindingGroup = Record<string, BindingSpec | UniformGroupBindings>;

/**
 * The scalar type of a specialization constant
 *
 * WebGPU declares the constant as a WGSL `override`. WebGL bakes the value into the GLSL as a
 * `#define`, where a `u32` reads as an `int`, so compare a `u32` constant with a bare literal such
 * as `== 1`, which both languages accept.
 * @category rendering
 * @advanced
 */
export type ShaderOverrideType = 'f32' | 'i32' | 'u32';

/**
 * A specialization constant a bit declares: a `default`, or `required: true`
 *
 * The value comes from {@link ShaderDescriptorOptions#overrides}. Bits that declare the same
 * constant must agree on its type, whether it's required, and its default, or the compile throws.
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
      /** The descriptor's `overrides` must give a value, or the shader fails to build */
      required: true;
      /** Not allowed alongside `required` */
      default?: never;
    };

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
 *     fragment: { material: "albedo *= input.vColor.rgb * material.uColor.rgb;" },
 *   },
 *   gl: {
 *     vertex: { input: "vColor = aColor;" },
 *     fragment: { material: "albedo *= vColor.rgb * material.uColor.rgb;" },
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
  /** A unique name; shaders are cached by their bits' names, so two different bits with one name throw */
  name: string;
  /** The vertex attributes this bit reads; a name redeclared with another format warns, and the first wins */
  attributes?: Record<string, VertexFormat>;
  /** The varyings this bit declares; a name redeclared with another type warns, and the first wins */
  interStage?: InterStage;
  /**
   * The fragment outputs this bit declares, keyed by name, such as `{ normal: 'vec4<f32>' }`
   *
   * The fragment stage writes one as `outputs.normal`, and every field starts at zero.
   * {@link ShaderDescriptorOptions#outputLocations} says which output each location writes, and an
   * output with no location is dropped, so a bit can write one without knowing which passes use it.
   * In a view with scene outputs, a material on the engine's template can write any
   * {@link SceneOutput} by its name.
   *
   * The engine's template declares `color` as `vec4<f32>` and fills it from `finalColor` and
   * `alpha` after the `end` slot, so set those rather than `outputs.color`. Two bits that declare
   * one name with different types throw. A custom template needs the output slots: in WGSL
   * `{{fragmentDeclareOutputs}}` and `{{fragmentWriteOutputs}}`, returning `FragmentOutput`, and in
   * the GLSL fragment template `{{declareOutputs}}` and `{{writeOutputs}}`.
   * @example
   * ```ts
   * const depthOutputBit: ShaderBit = {
   *   name: 'myDepthOutput',
   *   outputs: { depth: 'f32' },
   *   gpu: { fragment: { end: 'outputs.depth = input.position.z;' } },
   *   gl: { fragment: { end: 'outputs.depth = gl_FragCoord.z;' } },
   * };
   * ```
   */
  outputs?: Record<string, FragmentOutputType>;
  /**
   * WGSL structs this bit declares, keyed by struct name
   *
   * The first bit to declare a name wins and later ones are dropped without a warning, so bits that
   * share a struct should import one definition.
   */
  structs?: Record<string, StructDefinition>;
  /**
   * The bindings this bit adds, keyed by bind group name
   *
   * Fields in the `material` group are per-material values, read as `material.<name>` in every
   * stage slot but the vertex `input` slot, which WebGL runs before declaring `material`. A
   * `header` helper can't see `material`, so pass it the values as arguments. A field is `f32`,
   * `i32`, `u32`, `mat2x2<f32>` or a `vec2`, `vec3` or `vec4` of `f32`, and other value types
   * throw. Texture and sampler types there are dropped; declare textures in `textures`. A material
   * can have any number of fields, but a write to one uploads them all, and a draw that merges
   * materials reads all of them in each stage, one texel per 16 bytes.
   *
   * Fields in the `instance` group are the per-slot values of a {@link BatchedMesh3D}, read as
   * `instance.<name>` in the same slots. Each must match a field of the batch's `instanceData`
   * option by name and type. A custom template adds `{{vertexStoreAccess}}` and
   * `{{fragmentStoreAccess}}` to its WGSL, the vertex one after it declares `inst` as the engine's
   * template does, and `{{storeAccess}}` to each GLSL stage, after the vertex `{{input}}`. A pass's
   * descriptor also lists {@link instanceFetchBitGl} in its `bitsGl`.
   *
   * Don't add fields of your own to `global` or `camera`, which the engine fills from fixed
   * buffers, or the draw can fail. A material's shader always has the engine's fields there, so
   * a bit reads them without declaring them, as `camera.uCameraPosition` in WGSL or
   * `uCameraPosition` in GLSL.
   */
  bindings?: Partial<Record<BIND_GROUPS[number], BindingGroup>>;
  /** Specialization constants, keyed by name; see {@link ShaderOverrideType} */
  overrideDefs?: Record<string, ShaderOverrideDef>;
  /**
   * The textures this bit samples, as camelCase names such as `'transmission'`
   *
   * In a material's shader, each name gets two helpers in both languages, which
   * {@link BaseMaterial3DOptions#textures} fills by name. `sampleX(uv)`, such as
   * `sampleTransmission(uv)`, picks its mip level from the fragment's derivatives, so it works in
   * the fragment stage only, and `sampleXDirect(uv)` reads mip 0 in either stage. Pixi uploads
   * images with their alpha premultiplied by default, so divide a sample's `rgb` by its `a`, as in
   * `c.rgb / max(c.a, 0.001)`, to read the colour the image stores.
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
   * Other bits this bit needs in the shader, such as one that declares a helper function it calls
   *
   * The compiler adds each required bit once, just ahead of the first bit that requires it, so two
   * bits can share a helper without declaring it twice. A material need not list them.
   *
   * A required bit should hold only shader code, such as helpers and constants: one the material
   * doesn't list can't add texture slots, `material` fields or `instance` fields. Declare those on
   * a listed bit, and list it ahead of any bit that requires it.
   * @example
   * ```ts
   * const luminanceBit: ShaderBit = {
   *   name: 'luminance',
   *   gpu: { header: 'fn luminance(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }' },
   *   gl: { fragment: { header: 'float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }' } },
   * };
   *
   * const desaturateBit: ShaderBit = {
   *   name: 'desaturate',
   *   requires: [luminanceBit],
   *   gpu: { fragment: { material: 'albedo = vec3<f32>(luminance(albedo));' } },
   *   gl: { fragment: { material: 'albedo = vec3(luminance(albedo));' } },
   * };
   * ```
   */
  requires?: ShaderBit[];
  /**
   * The WGSL code for WebGPU; {@link ShaderBitTemplate} says which slot each key fills
   *
   * The compiler doesn't check that a `textureSample`, `dpdx` or `dpdy` sits in uniform control
   * flow, so keep it there yourself. A branch on a `material` value is uniform. Under a branch on a
   * per-fragment value, the derivative, and so the mip level, is undefined.
   */
  gpu?: {
    /** Code for the template's `{{header}}` slot, such as functions and constants */
    header?: string;
    /** Code for the vertex stage's slots, keyed by slot name */
    vertex?: Partial<Record<VERTEX_TAGS[number], string>>;
    /** Code for the fragment stage's slots, keyed by slot name */
    fragment?: Partial<Record<FRAGMENT_TAGS[number], string>>;
  };
  /** The GLSL code for WebGL; {@link ShaderBitTemplate} says which slot each key fills */
  gl?: {
    /** Code for the `{{header}}` slot of both stages' templates, such as functions and constants */
    header?: string;
    /** Code for the vertex stage's slots, keyed by slot name */
    vertex?: Partial<Record<VERTEX_TAGS[number], string>>;
    /** Code for the fragment stage's slots, keyed by slot name */
    fragment?: Partial<Record<FRAGMENT_TAGS[number], string>>;
  };

  /** @internal */
  _identityChecked?: boolean;
  /** @internal */
  _contentSnapshot?: string;
};
