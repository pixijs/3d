// Load the package entry before every test file: registers the render
// pipes/systems, applies the events mixins, installs the uniform parsers.
// Without it, tests that deep-import `~/...` modules miss those side effects.
import '../src/index';
import { GlobalResourceRegistry } from 'pixi.js';
import { beforeAll } from 'vitest';

// Test files share a long-lived iframe (`isolate: false` in vitest.config.ts),
// so module state persists across files. Start every file from a fresh world
// via the engine's global reset seam: shared pools and caches drop their
// contents (geometry atlas offsets restart at 0, batch bind-group caches
// empty), the `warnOnce` dedupe set re-arms, and the per-file warn cap
// (`pixi-warn-per-file-cap` in vitest.config.ts) rewinds — everything that is
// page-global registers a `clear()` with the registry. Vitest re-runs this
// hook before each test file.
beforeAll(() => {
  GlobalResourceRegistry.release();
});
