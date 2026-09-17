import { Converter } from 'typedoc';

function removeStandardTag(_context, reflection) {
  reflection?.comment?.removeTags('@standard');
}

export function load(app) {
  app.converter.on(Converter.EVENT_CREATE_DECLARATION, removeStandardTag);
  // A function's comment lives on its signature, not its declaration
  app.converter.on(Converter.EVENT_CREATE_SIGNATURE, removeStandardTag);
}
