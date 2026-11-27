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

/**
 * Throws, naming the bit and the rule it breaks, unless a geometry may carry `bit`; the rules are on
 * `Geometry3DOptions.extraBits`
 * @internal
 */
export function assertGeometryBit(bit: ShaderBit): void {
  if (bit._geometryChecked) return;

  if (bit.level !== 'shape') {
    throw new Error(
      `[Geometry3D] The shader bit '${bit.name}' in a geometry's extraBits has level '${bit.level ?? 'color'}'. ` +
        "A geometry bit only moves vertices, so give it `level: 'shape'`.",
    );
  }

  assertShapeOnly(bit, `The shader bit '${bit.name}' in a geometry's extraBits`);
  bit._geometryChecked = true;
}

/** Also checks the bits `bit` requires, since the compiler adds them wherever `bit` is kept, whatever their level */
function assertShapeOnly(bit: ShaderBit, subject: string): void {
  const fragmentSlot = Object.keys(bit.gpu?.fragment ?? {})[0] ?? Object.keys(bit.gl?.fragment ?? {})[0];

  if (fragmentSlot) {
    throw new Error(
      `[Geometry3D] ${subject} writes the fragment slot '${fragmentSlot}'. A geometry bit only moves vertices, ` +
        'so its code goes in vertex slots and `header`, and the material colours the surface.',
    );
  }

  const group = bit.bindings?.material ? 'material' : bit.bindings?.instance ? 'instance' : undefined;

  if (group) {
    throw new Error(
      `[Geometry3D] ${subject} declares '${group}' bindings. Those live in a material's storage, and a geometry ` +
        'is shared across materials, so pass the values through a vertex attribute instead.',
    );
  }

  if (bit.textures?.length) {
    throw new Error(
      `[Geometry3D] ${subject} declares textures. A material binds textures, and a geometry is shared across ` +
        'materials, so a geometry bit samples none.',
    );
  }

  const required = bit.requires;
  if (!required) return;

  for (let i = 0; i < required.length; i++) {
    assertShapeOnly(required[i], `The shader bit '${required[i].name}', which '${bit.name}' requires,`);
  }
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
