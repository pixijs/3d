import type { ShaderBit } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

/**
 * The bit that owns each name, for the whole page
 *
 * A `ShaderDescriptor` key joins its bits' names, so two different bits with one name would get
 * each other's compiled shaders from the cache. Every bit is checked here before it joins a key.
 */
const registry = new Map<string, ShaderBit>();

/**
 * The bit's content as JSON, built once and only when two bits claim one name
 *
 * It leaves out the `_` fields this module stamps, so it reads the same whenever it is taken.
 * @param bit - The bit to snapshot
 */
function contentSnapshot(bit: ShaderBit): string {
  return ((bit._contentSnapshot as string | undefined) ??= JSON.stringify(bit, (key, value) =>
    key.startsWith('_') ? undefined : value,
  ));
}

/**
 * Registers `bit` as the owner of its name, and throws if a different bit already owns it
 *
 * Two bits with the same name and the same content are the same module evaluated twice, after a
 * hot reload or with a library bundled twice. They are interchangeable, so the newer one takes the
 * name without an error, and its own later checks stay a single read.
 *
 * After a bit's first check, each check costs one property read.
 * @param bit - The bit whose name identity to verify and register
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
 * Forgets every registered name, so a test can build colliding bits without breaking later tests
 * @internal
 */
export function resetBitRegistry(): void {
  registry.clear();
}

/**
 * Fails a compile whose template declares a `camera` bind group that no bit fills
 *
 * The camera group is bound at 1 by every draw. A template that lists `'camera'` in its
 * `bindGroups` but assembles no bit declaring that group would compile, then fail at draw
 * with a bind-group mismatch that names nothing. Catch it here, and name the flag.
 * @param bits - The final bit list the shader is compiled from.
 * @param template - The template it is compiled against.
 * @internal
 */
export function assertCameraGroupProvided(bits: readonly ShaderBit[], template: ShaderBitTemplate): void {
  if (!template.bindGroups.includes('camera')) return;
  for (let i = 0; i < bits.length; i++) if (bits[i].bindings?.camera) return;
  throw new Error(
    "The shader template declares a 'camera' bind group but no bit provides it. " +
      'Leave `includeCamera` on (the default), or list `cameraBit` in the descriptor.',
  );
}
