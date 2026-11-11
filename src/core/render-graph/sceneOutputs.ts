import type { Pass3D } from '../../post-processing/Pass3D';
import type { RenderPass } from '../render-passes/RenderPass';
import type { ShaderBit } from '../shader/ShaderBit';
import { assertSceneOutput, sameSceneOutput } from './SceneOutput';
import type { SceneOutput, SceneOutputPass } from './SceneOutput';

/**
 * Sorted by name, so the same set of outputs always gives the same attachments and material shaders
 * @internal
 */
export function collectSceneOutputs(passes: readonly Pass3D[], extra: readonly SceneOutput[] = []): SceneOutput[] {
  const outputs: SceneOutput[] = [];
  const add = (output: SceneOutput, user: string): void => {
    assertSceneOutput(output);
    const named = outputs.find((o) => o.name === output.name);
    if (named && sameSceneOutput(named, output)) return;
    if (named) {
      throw new Error(
        `${user} uses a scene output named '${output.name}', and another pass uses a ` +
          'different one with that name. Share one definition between them, or rename one.',
      );
    }
    outputs.push(output);
  };

  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    const used = pass.enabled ? pass.requiredOutputs : undefined;
    if (!used) continue;
    for (let r = 0; r < used.length; r++) add(used[r], pass.constructor.name);
  }
  for (let i = 0; i < extra.length; i++) add(extra[i], "createDefaultGraph3D's `sceneOutputs`");

  return outputs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** @internal */
export function materialBitsFor(outputs: readonly SceneOutput[], pass: string): ShaderBit[] {
  const bits: ShaderBit[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const bit = outputs[i].bits?.[pass as SceneOutputPass];
    if (bit) bits.push(bit);
  }
  return bits;
}

/**
 * Returns `undefined`, which compiles the colour alone, when there's no `pass` yet or `ownTemplate` is set
 * @internal
 */
export function addPassMaterialBits(
  bits: ShaderBit[],
  pass: RenderPass | undefined,
  ownTemplate: boolean,
): readonly string[] | undefined {
  if (!pass || ownTemplate) return undefined;

  const materialBits = pass.materialBits;
  for (let i = 0; i < materialBits.length; i++) bits.push(materialBits[i]);

  return pass.outputLocations;
}
