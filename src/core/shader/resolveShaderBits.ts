import type { ShaderBit } from './ShaderBit';

/** Marks `bit` seen before walking its requirements, so two bits that require each other land once */
function addWithRequired(bit: ShaderBit, resolved: ShaderBit[], seen: Set<ShaderBit>): void {
  if (seen.has(bit)) return;
  seen.add(bit);

  const requires = bit.requires;

  if (requires) {
    for (let i = 0; i < requires.length; i++) addWithRequired(requires[i], resolved, seen);
  }

  resolved.push(bit);
}

/** @internal */
export function resolveShaderBits(bits: ShaderBit[]): ShaderBit[] {
  const resolved: ShaderBit[] = [];
  const seen = new Set<ShaderBit>();

  for (let i = 0; i < bits.length; i++) addWithRequired(bits[i], resolved, seen);

  return resolved;
}
