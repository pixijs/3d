import type { FragmentOutputType, ShaderBit } from '../ShaderBit';
import { assertOutputName } from './assertOutputName';

/**
 * Compared by identity, which leaves the default out of descriptor cache keys
 * @internal
 */
export const DEFAULT_OUTPUT_LOCATIONS: readonly string[] = Object.freeze(['color']);

/** @internal */
export function collectFragmentOutputs(bits: readonly ShaderBit[]): Record<string, FragmentOutputType> {
  const declared: Record<string, FragmentOutputType> = Object.create(null);
  const declaredBy: Record<string, string> = Object.create(null);

  for (const bit of bits) {
    if (!bit.outputs) continue;

    for (const [name, type] of Object.entries(bit.outputs)) {
      const existing = declared[name];

      if (existing === undefined) {
        assertOutputName(name, `Bit '${bit.name}'`);
        declared[name] = type;
        declaredBy[name] = bit.name;
      } else if (existing !== type) {
        throw new Error(
          `[collectFragmentOutputs] Output "${name}" is "${existing}" in bit "${declaredBy[name]}" ` +
            `and "${type}" in bit "${bit.name}". Bits that share an output must agree on its type.`,
        );
      }
    }
  }

  return declared;
}
