import type { RgbaArray, TEXTURE_FORMATS } from 'pixi.js';

import { assertOutputName } from '../shader/codegen/assertOutputName';
import type { ShaderBit } from '../shader/ShaderBit';

/**
 * The scene passes a {@link SceneOutput#bits | scene output's bits} can name
 * @category rendering
 * @advanced
 */
export type SceneOutputPass = 'opaque' | 'transmission' | 'transparent';

const BIT_PASSES = Object.keys({
  opaque: true,
  transmission: true,
  transparent: true,
} satisfies Record<SceneOutputPass, true>) as SceneOutputPass[];

const checked = new WeakSet<SceneOutput>();

/**
 * A texture the scene draw writes besides its colour, such as object IDs, for passes to read
 *
 * A plain object known by its name, like a {@link ShaderBit}: two with the same name and content
 * count as one, and two that differ throw when a view collects them. A view creates and writes the
 * texture only while an enabled pass lists the output in {@link Pass3D#requiredOutputs}, or
 * {@link DefaultGraph3DOptions#sceneOutputs} does, and passes reach it with
 * {@link RenderGraph#getSceneOutput}. Three things write it: its {@link SceneOutput#bits | bits}, a
 * material's own bits that declare it in `outputs`, and a pass that draws into it.
 *
 * Each frame it starts cleared to its {@link SceneOutput#clearValue | clearValue}, and a draw that
 * doesn't write it leaves it alone. It lasts only for the frame: to keep it past `render()`, copy
 * it into a texture the app owns, for example with a {@link FullscreenPass} running
 * {@link passthroughFragment}. A pass that only reads it, such as a readback to the CPU, needs
 * {@link PassBuilder#sideEffect}.
 *
 * Each output is one more colour attachment on the scene passes, and GPUs cap those. WebGPU allows 8,
 * and 32 bytes per pixel across the colour and every output, where `rgba8unorm` counts 8 bytes, as
 * `rgba16float` does. WebGL allows at least 4. Pick the smallest format that holds the value; a
 * view over the cap throws when it renders.
 *
 * On a canvas with `antialias`, the output is multisampled with the scene, which takes four times
 * its texture's memory, and an edge pixel reads the average of its samples, the clear value
 * included where nothing drew. An integer or 32-bit float format turns that off, and so does
 * `rgba8unorm` on WebGL: while one is attached, the view draws its scene single-sample and its
 * edges go jagged.
 * @example
 * ```ts
 * const objectIdOutput: SceneOutput = { name: 'objectId', format: 'r32uint', clearValue: [0xffffffff, 0, 0, 0] };
 *
 * class MyPickingPass extends Pass3D {
 *   public readonly stage = 'afterTransparent';
 *   public readonly requiredOutputs = [objectIdOutput];
 *
 *   public build(graph: RenderGraph): void {
 *     graph.addPass(new MyPickReadbackPass(graph.getSceneOutput(objectIdOutput)));
 *   }
 * }
 * ```
 * @category rendering
 * @advanced
 */
export interface SceneOutput {
  /**
   * The field material shaders write as `outputs.<name>`, and the texture's label
   *
   * A lowercase letter, then letters and digits, such as `objectId`. Not `color`, which is the scene
   * colour's, or a word WGSL or GLSL reserves.
   */
  readonly name: string;
  /** Format of the output's texture; some formats turn the view's MSAA off, see {@link SceneOutput} */
  readonly format: TEXTURE_FORMATS;
  /**
   * The bit each scene pass gives its materials so they write the output, keyed by pass name; see
   * {@link RenderPass#materialBits}
   *
   * `{ opaque: myBit }` is the usual form: opaque surfaces write it, and transparent and glass
   * surfaces leave what is behind them. Add `transparent` or `transmission` for those surfaces to
   * write it too. Leave `bits` out for an output only some materials write, through their own bits,
   * or one a pass draws into. Each bit must declare the output in its `outputs`.
   *
   * Blended surfaces blend what they write, so a `transparent` bit must write a float or normalized
   * output as a `vec4`, or the view throws. Integer formats such as `r32uint` never blend, so a
   * blended surface overwrites what is behind it: use one for IDs and masks.
   *
   * A material with a template of its own, or a pass with a shader of its own such as a
   * {@link MeshPass}, leaves every output as it was.
   */
  readonly bits?: Readonly<Partial<Record<SceneOutputPass, ShaderBit>>>;
  /**
   * What the texture holds before anything draws into it each frame, as four numbers in the
   * format's channel order; integer formats take them as integers
   *
   * Pick a value no writer produces, so a reader can tell where nothing drew, such as the far
   * distance for a depth-like output or `0xffffffff` for an object ID.
   * @default [0, 0, 0, 0]
   */
  readonly clearValue?: RgbaArray;
}

/** @internal */
export function assertSceneOutput(output: SceneOutput): void {
  if (checked.has(output)) return;

  const { name, bits } = output;
  assertOutputName(name, 'SceneOutput');
  if (name === 'color') {
    throw new Error("SceneOutput: 'color' is the scene colour's own output. Give the output another name.");
  }
  for (const pass in bits) {
    const bit = bits[pass as SceneOutputPass]!;
    const type = bit.outputs?.[name];
    if (!type) {
      throw new Error(
        `SceneOutput '${name}': bit '${bit.name}' for the ${pass} pass doesn't declare it. Add \`${name}\` ` +
          "to the bit's `outputs`.",
      );
    }
    if (pass === 'transparent' && type !== 'vec4<f32>' && !output.format.includes('int')) {
      throw new Error(
        `SceneOutput '${name}': bit '${bit.name}' for the transparent pass writes it as ${type}. A blended ` +
          "surface blends what it writes, and WebGPU's blend reads the alpha, so write a float output as " +
          'vec4<f32>, or give the output an integer format, which never blends.',
      );
    }
  }

  checked.add(output);
}

/**
 * Compares bits by name, their identity across the engine
 * @internal
 */
export function sameSceneOutput(a: SceneOutput, b: SceneOutput): boolean {
  if (a === b) return true;
  if (a.name !== b.name || a.format !== b.format) return false;

  const ca = a.clearValue;
  const cb = b.clearValue;
  if (ca !== cb && (!ca || !cb || ca[0] !== cb[0] || ca[1] !== cb[1] || ca[2] !== cb[2] || ca[3] !== cb[3])) {
    return false;
  }

  for (let i = 0; i < BIT_PASSES.length; i++) {
    const pass = BIT_PASSES[i];
    if (a.bits?.[pass]?.name !== b.bits?.[pass]?.name) return false;
  }
  return true;
}
