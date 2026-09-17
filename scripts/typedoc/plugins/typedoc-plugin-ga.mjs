import { JSX, ParameterType } from 'typedoc';

/**
 * Adds a `gaID` option and injects the Google Analytics gtag snippet at the end of every HTML page
 * when it is set. A local copy of `typedoc-plugin-ga`, whose published version peers typedoc 0.27.
 * @param app - the typedoc application
 */
export function load(app) {
  app.options.addDeclaration({
    name: 'gaID',
    help: 'Set the Google Analytics tracking ID and activate tracking code',
    type: ParameterType.String,
  });

  app.renderer.hooks.on('body.end', () => {
    const id = app.options.getValue('gaID');

    if (!id) return JSX.createElement(JSX.Fragment, null);

    const init = [
      'window.dataLayer = window.dataLayer || [];',
      'function gtag(){dataLayer.push(arguments);}',
      "gtag('js', new Date());",
      `gtag('config', '${id}');`,
    ].join('\n');

    return JSX.createElement(JSX.Fragment, null, [
      JSX.createElement('script', { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` }),
      JSX.createElement('script', null, JSX.createElement(JSX.Raw, { html: init })),
    ]);
  });
}
