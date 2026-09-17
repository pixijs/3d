import { useCallback, useEffect, useMemo } from 'preact/hooks';

import { useSceneTree } from '../hooks/useSceneTree';
import { useUrlState } from '../hooks/useUrlState';
import { MiniBar } from '../panels/MiniBar';
import { Panel } from '../panels/Panel';
import { TreeView } from '../panels/TreeView';
import { discoverScenes } from '../scenes/sceneDiscovery';
import type { RenderType, SceneEntry } from '../types';
import { Viewer } from '../viewer/Viewer';

function sceneFrameUrl(entry: SceneEntry, renderer: RenderType): string {
  return `/scene-frame.html?type=${entry.type}&id=${encodeURIComponent(entry.id)}&renderer=${renderer}`;
}

export function App() {
  const [state, update] = useUrlState();
  const allScenes = useMemo(() => discoverScenes(), []);
  const tree = useSceneTree(allScenes, state.tab, state.search);

  const selectedEntry = useMemo(() => allScenes.find((e) => e.id === state.scene) ?? null, [allScenes, state.scene]);

  useEffect(() => {
    if (selectedEntry?.type !== 'playground' && selectedEntry?.type !== 'example') return undefined;

    const iframe = document.createElement('iframe');

    iframe.id = 'playground-frame';
    iframe.src = sceneFrameUrl(selectedEntry, state.renderer);
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;z-index:0;';
    document.body.appendChild(iframe);

    return () => {
      iframe.remove();
    };
  }, [selectedEntry, state.renderer]);

  const handleSelect = useCallback(
    (entry: SceneEntry) => {
      update({ scene: entry.id });
    },
    [update],
  );

  // Open the scene as a top-level window so the WebGPU inspector works — the nested
  // iframe used for the inline preview is an isolated browsing context the dev tools can't reach.
  const handleOpenExternal = useCallback(
    (entry: SceneEntry) => {
      window.open(sceneFrameUrl(entry, state.renderer), '_blank', 'noopener');
    },
    [state.renderer],
  );

  return (
    <>
      <MiniBar
        sceneName={selectedEntry?.name ?? null}
        sceneType={selectedEntry?.type ?? null}
        renderer={state.renderer}
        renderer2={state.renderer2}
        view={state.view}
        expanded={state.expanded}
        onRendererChange={(r) => update({ renderer: r })}
        onRenderer2Change={(r) => update({ renderer2: r })}
        onViewChange={(v) => update({ view: v })}
        onToggleExpanded={() => update({ expanded: !state.expanded })}
      />

      <Panel expanded={state.expanded}>
        <TreeView
          nodes={tree}
          selectedId={state.scene}
          tab={state.tab}
          search={state.search}
          onSelect={handleSelect}
          onOpenExternal={handleOpenExternal}
          onTabChange={(tab) => update({ tab })}
          onSearchChange={(search) => update({ search })}
        />
      </Panel>

      <Viewer entry={selectedEntry} renderer={state.renderer} renderer2={state.renderer2} view={state.view} />

      <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .scene-tree-scroll {
                    scrollbar-width: thin;
                    scrollbar-color: #262638 transparent;
                }
                .scene-tree-scroll::-webkit-scrollbar {
                    width: 6px;
                }
                .scene-tree-scroll::-webkit-scrollbar-track {
                    background: transparent;
                }
                .scene-tree-scroll::-webkit-scrollbar-thumb {
                    background: #262638;
                    border-radius: 3px;
                }
                .scene-tree-scroll::-webkit-scrollbar-thumb:hover {
                    background: #3a3a50;
                }
            `}</style>
    </>
  );
}
