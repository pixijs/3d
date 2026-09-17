import { DefaultTheme } from 'typedoc';

/**
 * Folds `prefix:name` categories into one collapsible `prefix` folder, so `extras:camera` and
 * `extras:debug` show as `camera` and `debug` under `extras`. The folder takes the place of the
 * first category it absorbs.
 * @param nodes - the sidebar's top-level navigation nodes
 */
function nestCategories(nodes) {
  const folders = new Map();

  return nodes.flatMap((node) => {
    // Category nodes have no page, so a `path` means a real reflection whose name may contain `:`
    if (node.path || !node.text.includes(':')) return [node];

    const [prefix, name] = node.text.split(':');
    const child = { ...node, text: name };
    const folder = folders.get(prefix);

    if (folder) {
      folder.children.push(child);

      return [];
    }

    folders.set(prefix, { text: prefix, children: [child] });

    return [folders.get(prefix)];
  });
}

/**
 * The default HTML theme with nested categories in the sidebar. typedoc only builds sidebar
 * folders from `/` in module names, never from category titles.
 */
class PixiTheme extends DefaultTheme {
  buildNavigation(project) {
    return nestCategories(super.buildNavigation(project));
  }
}

/**
 * Registers the `pixi` HTML theme
 * @param app - the typedoc application
 */
export function load(app) {
  app.renderer.defineTheme('pixi', PixiTheme);
}
