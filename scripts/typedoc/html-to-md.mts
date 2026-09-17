import * as fs from 'node:fs';
import * as path from 'node:path';

import { globSync } from 'glob';

// Moves typedoc's markdown output next to the HTML pages as `<page>.html.md`, the URL that
// llms.txt and the pages' "Copy page" button fetch, then deletes the markdown output folder.
const root = path.resolve(import.meta.dirname, '../..');
const mdDir = path.join(root, '.s3_uploads/docs_md');
const htmlDir = path.join(root, '.s3_uploads/docs');
const mdFiles = globSync('**/*.html', { cwd: mdDir });

for (const file of mdFiles) {
  let content = fs.readFileSync(path.join(mdDir, file), 'utf-8');
  const headerIndex = content.indexOf('\n# ');

  if (headerIndex !== -1) {
    content = content.slice(headerIndex + 1);
  }

  content = content.replace(/\]\(([^)/:]+?)\.html\)/g, ']($1.html.md)');
  content = content.replace(/```[\s\S]*?```/g, (block) => block.replace(/^@(?:advanced|standard)\n?/gm, ''));

  fs.writeFileSync(path.join(htmlDir, `${file}.md`), content);
}

fs.rmSync(mdDir, { recursive: true, force: true });
console.log(`html-to-md: moved ${mdFiles.length} files from docs_md to docs`);
