import { ForwardRenderPass, Pass3D, passBitRegistry } from '@pixi/3d';
import type { PassContext, RenderGraph } from '@pixi/3d';
import { solidMeshDescriptor } from '@pixi/3d/extras';

/** A key-sorted custom pass whose cache policy the adverse benchmarks can control. */
export class MembershipPass extends Pass3D {
  public readonly stage = 'afterOpaque';
  public readonly bit: number;
  private readonly _name: string;
  private readonly _cache: 'auto' | 'never';

  constructor(name: string, cache: 'auto' | 'never') {
    super();
    this._name = name;
    this._cache = cache;
    this.bit = passBitRegistry.getOrAllocate(name);
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new ForwardRenderPass({
        renderer: ctx.renderer,
        name: this._name,
        sort: 'key',
        cache: this._cache,
        descriptor: { shaderDescriptor: solidMeshDescriptor({ color: 0x62b9dc }) },
      }),
    );
  }
}
