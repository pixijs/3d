import {
  ABSENT,
  AS_F32,
  AS_FRAME,
  AS_PACKED,
  AS_TINT,
  AS_UNORM8,
  CONSTANT,
  FROM_CLOCK,
  FROM_SPREAD,
  FROM_VELOCITY,
  FUNCTION,
  PAIR,
} from './spawnPlan';
import type { SpawnAttribute, SpawnFn, SpawnShape } from './spawnPlan';

/**
 * Generates a straight-line spawn function for one override pattern
 *
 * The attribute list is the declaration and the pattern of kinds is the
 * structure, so everything the polyfill dispatches on per particle (components,
 * source, store and kind) is a literal here. Spreads and lerps are inlined, the
 * spread offsets and element indices are literals, and the stamp across the
 * quad is unrolled. Per-system values (the capacity, the frame count and the
 * packed constants) come through the context, so systems with the same
 * attributes share one function. The same idea as pixi's uniform sync
 * generators, applied to a particle's birth record.
 *
 * Every byte or short it packs inlines `unorm8` or `unorm16`, clamp included.
 * Random draws happen in exactly the order `generateSpawnPolyfill` makes them,
 * which the parity test pins byte for byte.
 * @param attributes - The attributes a spawn writes, in the order it writes them
 * @param kinds - Each attribute's override kind for this pattern, parallel to `attributes`
 * @param positionKind - The position override's kind
 * @param shape - The stride, space and frame mode the function is built for
 * @returns The compiled spawn function.
 * @internal
 */
export function generateSpawn(
  attributes: readonly SpawnAttribute[],
  kinds: readonly number[],
  positionKind: number,
  shape: SpawnShape,
): SpawnFn {
  const { floatStride, world, randomFrames } = shape;
  const lines: string[] = [];
  const emit = (line: string): void => {
    lines.push(line);
  };

  emit(
    'const rng = ctx.rng, spreads = ctx.spreads, shape = ctx.shape, pos = ctx.pos, dir = ctx.dir, origin3 = ctx.origin3;',
  );
  emit('const wt = ctx.worldTransform, pf = ctx.packedFrames, f32 = ctx.f32, u32 = ctx.u32, u16 = ctx.u16;');
  emit('const capacity = ctx.capacity, frameCount = ctx.frameCount, packed = ctx.packed;');
  emit('const packedColor = plan.packedColor;');

  for (let i = 0; i < attributes.length; i++) {
    const kind = kinds[i];

    if (kind === CONSTANT || kind === FUNCTION) emit(`const raw${i} = plan.raw[${i}];`);
    if (kind === PAIR) emit(`const lo${i} = plan.lo[${i}], hi${i} = plan.hi[${i}];`);
    if (attributes[i].store === AS_PACKED) emit(`const pk${i} = packed[${i}];`);
  }

  if (positionKind === CONSTANT || positionKind === FUNCTION) emit('const posRaw = plan.positionRaw;');
  if (positionKind === PAIR) emit('const posLo = plan.positionLo, posHi = plan.positionHi;');

  emit('let index = first;');
  emit('for (let n = 0; n < count; n++) {');
  emit(
    `  const o0 = index * ${VERTS * floatStride}, o1 = o0 + ${floatStride}, o2 = o1 + ${floatStride}, o3 = o2 + ${floatStride};`,
  );

  emit('  shape.sample(rng, pos, dir);');

  if (positionKind === ABSENT) {
    if (world) emit('  pos.applyMatrix4(wt);');
  } else if (positionKind === CONSTANT) {
    emit('  pos.set(posRaw.x + pos.x, posRaw.y + pos.y, posRaw.z + pos.z);');
  } else if (positionKind === PAIR) {
    emit(
      '  origin3.set(posLo.x + (posHi.x - posLo.x) * rng(), posLo.y + (posHi.y - posLo.y) * rng(), posLo.z + (posHi.z - posLo.z) * rng());',
    );
    emit('  pos.set(origin3.x + pos.x, origin3.y + pos.y, origin3.z + pos.z);');
  } else {
    emit('  { const q = posRaw(rng, index); pos.set(q.x + pos.x, q.y + pos.y, q.z + pos.z); }');
  }

  if (world) emit('  dir.transformDirection(wt);');

  emit(stamp('f32', 0, 'pos.x') + stamp('f32', 1, 'pos.y') + stamp('f32', 2, 'pos.z'));

  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i];
    const kind = kinds[i];
    const at = a.index + a.offset;

    if (a.store === AS_FRAME) {
      emit(`  { const h0 = (o0 + ${at}) * 2, h1 = (o1 + ${at}) * 2, h2 = (o2 + ${at}) * 2, h3 = (o3 + ${at}) * 2;`);
      emit(randomFrames ? '    const w = (Math.floor(rng() * frameCount) % frameCount) * 4;' : '    const w = 0;');
      for (let c = 0; c < 4; c++) {
        emit(
          `    u16[h0 + ${c}] = pf[w + ${c}]; u16[h1 + ${c}] = pf[w + ${c}]; u16[h2 + ${c}] = pf[w + ${c}]; u16[h3 + ${c}] = pf[w + ${c}];`,
        );
      }
      emit('  }');
      continue;
    }

    if (a.store === AS_PACKED) {
      emit(stamp('u32', at, `pk${i}`));
      continue;
    }

    if (a.components === 1) {
      const value = scalarExpr(i, kind, a);

      if (a.store === AS_TINT) {
        emit(`  { const v = ${value}; const a8 = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;`);
        emit(`    const c = ((packedColor & 0xffffff) | (a8 << 24)) >>> 0;${stamp('u32', at, 'c')} }`);
      } else {
        emit(`  { const v = ${value};${stamp('f32', at, 'v')} }`);
      }
      continue;
    }

    const n = a.components;
    const names = ['x', 'y', 'z', 'w'].slice(0, n);

    emit('  {');
    if (kind === ABSENT) {
      if (a.source === FROM_VELOCITY) {
        emit(`    const mn = spreads[${SPEED_OFFSET}], mx = spreads[${SPEED_OFFSET + 1}];`);
        emit('    const speed = mn === mx ? mn : mn + (mx - mn) * rng();');
        emit('    const x = dir.x * speed, y = dir.y * speed, z = dir.z * speed;');
      } else {
        emit(`    const ${names.map((c) => `${c} = 0`).join(', ')};`);
      }
    } else if (kind === CONSTANT) {
      emit(`    const ${names.map((c) => `${c} = raw${i}.${c}`).join(', ')};`);
    } else if (kind === PAIR) {
      emit(`    const ${names.map((c) => `${c} = lo${i}.${c} + (hi${i}.${c} - lo${i}.${c}) * rng()`).join(', ')};`);
    } else {
      emit(`    const q = raw${i}(rng, index); const ${names.map((c) => `${c} = q.${c}`).join(', ')};`);
    }

    if (a.store === AS_F32) {
      for (let c = 0; c < n; c++) emit('  ' + stamp('f32', at + c, names[c]));
    } else if (a.store === AS_UNORM8) {
      for (const c of names) emit(`    const ${c}8 = ${c} <= 0 ? 0 : ${c} >= 1 ? 255 : (${c} * 255 + 0.5) | 0;`);
      emit('    const c = (x8 | (y8 << 8) | (z8 << 16) | (w8 << 24)) >>> 0;');
      emit('  ' + stamp('u32', at, 'c'));
    } else {
      emit(`    const h0 = (o0 + ${at}) * 2, h1 = (o1 + ${at}) * 2, h2 = (o2 + ${at}) * 2, h3 = (o3 + ${at}) * 2;`);
      for (let c = 0; c < 4; c++) {
        const v = names[c];

        emit(
          `    { const s = ${v} <= 0 ? 0 : ${v} >= 1 ? 65535 : (${v} * 65535 + 0.5) | 0; u16[h0 + ${c}] = s; u16[h1 + ${c}] = s; u16[h2 + ${c}] = s; u16[h3 + ${c}] = s; }`,
        );
      }
    }
    emit('  }');
  }

  emit('  index = index + 1 === capacity ? 0 : index + 1;');
  emit('}');
  emit('return index;');

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('ctx', 'plan', 'clock', 'first', 'count', lines.join('\n')) as SpawnFn;
}

const VERTS = 4;
/** `SPREAD.speed` in the system's spread table; the one spread no attribute owns */
const SPEED_OFFSET = 2;

/**
 * Four stores of `value` at element `at` of each vertex, as one line
 * @param view - The vertex buffer view to write through
 * @param at - Element offset within a vertex
 * @param value - Source expression for the stored value
 * @returns The generated statements.
 */
function stamp(view: 'f32' | 'u32', at: number, value: string): string {
  return ` ${view}[o0 + ${at}] = ${value}; ${view}[o1 + ${at}] = ${value}; ${view}[o2 + ${at}] = ${value}; ${view}[o3 + ${at}] = ${value};`;
}

/**
 * The expression for one scalar attribute's value, by its baked kind and source
 * @param i - The attribute's position in the list
 * @param kind - Its override kind for this pattern
 * @param a - The attribute itself
 * @returns The generated expression.
 */
function scalarExpr(i: number, kind: number, a: SpawnAttribute): string {
  if (kind === CONSTANT) return `raw${i}`;
  if (kind === PAIR) return `lo${i} + (hi${i} - lo${i}) * rng()`;
  if (kind !== ABSENT) return `raw${i}(rng, index)`;
  if (a.source === FROM_SPREAD) {
    return `(spreads[${a.spread}] === spreads[${a.spread + 1}] ? spreads[${a.spread}] : spreads[${a.spread}] + (spreads[${a.spread + 1}] - spreads[${a.spread}]) * rng())`;
  }
  if (a.source === FROM_CLOCK) return 'clock';

  return '0';
}
