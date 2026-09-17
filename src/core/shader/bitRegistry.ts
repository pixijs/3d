import type { ShaderBit } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

/**
 * Process-wide bit identity registry: `bit.name` → the bit that owns it
 *
 * Bit names are the shader cache's identity (`ShaderDescriptor` keys are
 * joined names), so two *different* bits sharing a name would silently serve
 * each other's compiled shaders out of the cache. Every bit that flows into
 * a descriptor key is checked here first, and a genuine collision throws —
 * the same rule Unreal's shader-type registry and Unity's shader paths
 * enforce at registration time.
 */
const registry = new Map<string, ShaderBit>();

/**
 * Content snapshot used only to adjudicate name collisions
 *
 * `_`-prefixed fields are bookkeeping stamped by this module and excluded so
 * the snapshot is stable regardless of when it is taken.
 * @param bit - The bit to snapshot
 */
function contentSnapshot(bit: ShaderBit): string {
  return ((bit._contentSnapshot as string | undefined) ??= JSON.stringify(bit, (key, value) =>
    key.startsWith('_') ? undefined : value,
  ));
}

/**
 * Registers `bit`'s name as its identity, throwing if a *different* bit already owns it
 *
 * A collision between byte-identical bits is accepted silently — that is
 * the same module evaluated twice (hot reload, a library bundled twice),
 * where the two objects are interchangeable. Only same-name-different-content
 * is an error, because it is the case the shader cache would mis-serve.
 *
 * Cost: one property read per bit after its first check; the content
 * snapshot is built lazily and only on the (never-in-a-healthy-app)
 * collision path.
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
    // Same content, new object — the recreated-module case. Adopt the new
    // instance as the name's owner so subsequent identity checks are O(1).
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
 * Drops all registrations
 *
 * Test-only — lets suites construct deliberately colliding bits without
 * poisoning the process-wide registry.
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
