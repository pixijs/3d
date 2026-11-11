import type { ShaderBit } from './ShaderBit';
import { resolveBindGroups } from './ShaderBitTemplate';
import type { ResolvedBindGroup, ShaderBitTemplate } from './ShaderBitTemplate';

const registry = new Map<string, ShaderBit>();

/** Leaves out the `_` fields stamped on a bit, which differ between a checked bit and its copy */
function contentSnapshot(bit: ShaderBit): string {
  return (bit._contentSnapshot ??= JSON.stringify(bit, (key, value) => (key.startsWith('_') ? undefined : value)));
}

/**
 * Throws when a different bit owns `bit`'s name, since cache keys hold bit names; a bit with the same
 * content is one module loaded twice, such as after a hot reload, and takes the name over
 * @internal
 */
export function assertBitIdentity(bit: ShaderBit): void {
  if (bit._identityChecked) return;

  const existing = registry.get(bit.name);

  if (existing === undefined || existing === bit) {
    registry.set(bit.name, bit);
    bit._identityChecked = true;
    return;
  }

  if (contentSnapshot(existing) === contentSnapshot(bit)) {
    registry.set(bit.name, bit);
    bit._identityChecked = true;
    return;
  }

  throw new Error(
    `[bitRegistry] Two different shader bits share the name '${bit.name}'. Bit names are shader-cache ` +
      `identities, so this would silently serve one bit's compiled shader for the other. Rename one of ` +
      `them — or, if you didn't define a second '${bit.name}', two copies of a module/library are loaded.`,
  );
}

const ENGINE_BIND_GROUPS: readonly ResolvedBindGroup[] = [
  { name: 'global', ubo: true },
  { name: 'camera', ubo: false },
  { name: 'batch', ubo: false },
];

function templateEntry(group: ResolvedBindGroup): string {
  return group.ubo ? `\`{ name: '${group.name}', ubo: true }\`` : `\`'${group.name}'\``;
}

/**
 * Throws, naming the fix, where a template and its bits disagree about the engine's bind groups;
 * each case otherwise fails later with an error that names nothing
 * @internal
 */
export function assertBindGroups(bits: readonly ShaderBit[], template: ShaderBitTemplate): void {
  const groups = resolveBindGroups(template);

  for (const engineGroup of ENGINE_BIND_GROUPS) {
    const { name, ubo } = engineGroup;
    const listed = groups.find((group) => group.name === name);
    const declaredBy = bits.find((bit) => bit.bindings?.[name]);

    if (declaredBy && !listed) {
      throw new Error(
        `The shader bit '${declaredBy.name}' declares the '${name}' bind group, but the shader template ` +
          `doesn't list it. Add ${templateEntry(engineGroup)} to the template's \`bindGroups\`.`,
      );
    }
    if (name === 'camera' && listed && !declaredBy) {
      throw new Error(
        "The shader template lists a 'camera' bind group but no bit declares it. " +
          'Leave `includeCamera` on (the default), or list `cameraBit` in the descriptor.',
      );
    }
    if (listed && listed.ubo !== ubo) {
      throw new Error(
        `The shader template lists the '${name}' bind group ${ubo ? 'without' : 'with'} \`ubo: true\`. ` +
          `List it as ${templateEntry(engineGroup)} in \`bindGroups\`, because the engine binds '${name}' as ` +
          `${ubo ? 'one uniform block' : 'plain uniforms'} on WebGL.`,
      );
    }
  }
}
