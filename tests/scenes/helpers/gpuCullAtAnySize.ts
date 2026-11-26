import type { TestContext } from 'vitest';

import { gpuCull } from '~/core/cull';

/** Sets {@link gpuCull}'s minimum to 0 for one test, so a scene under the default still covers the compute kernel */
export function gpuCullAtAnySize(context: TestContext): void {
  gpuCull.minInstances = 0;
  context.onTestFinished(() => {
    delete gpuCull.minInstances;
  });
}
