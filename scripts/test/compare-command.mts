import fs from 'node:fs';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Plugin } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

const labelFont: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
};

function copyImage(source: PNG, target: PNG, targetX: number, targetY: number) {
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sourceIndex = (source.width * y + x) << 2;
      const targetIndex = (target.width * (targetY + y) + targetX + x) << 2;

      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
}

function fillImage(image: PNG, red: number, green: number, blue: number, alpha: number) {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (image.width * y + x) << 2;

      image.data[index] = red;
      image.data[index + 1] = green;
      image.data[index + 2] = blue;
      image.data[index + 3] = alpha;
    }
  }
}

function resizeImage(image: PNG, width: number, height: number): PNG {
  if (image.width === width && image.height === height) {
    return image;
  }

  const output = new PNG({ width, height });

  fillImage(output, 0, 0, 0, 255);
  copyImage(image, output, 0, 0);

  return output;
}

function drawLabel(image: PNG, label: string, x: number, y: number) {
  let cursorX = x;

  for (const character of label.toUpperCase()) {
    const glyph = labelFont[character];

    if (!glyph) {
      cursorX += 4;
      continue;
    }

    for (let glyphY = 0; glyphY < glyph.length; glyphY++) {
      const row = glyph[glyphY];

      for (let glyphX = 0; glyphX < row.length; glyphX++) {
        if (row[glyphX] !== '1') {
          continue;
        }

        const index = (image.width * (y + glyphY) + cursorX + glyphX) << 2;

        image.data[index] = 255;
        image.data[index + 1] = 255;
        image.data[index + 2] = 255;
        image.data[index + 3] = 255;
      }
    }

    cursorX += glyph[0].length + 1;
  }
}

function saveFailureArtifact(name: string, expected: PNG, actual: PNG, diff: PNG) {
  const gap = 4;
  const titleHeight = 20;
  const output = new PNG({
    width: expected.width * 3 + gap * 2,
    height: expected.height + titleHeight,
  });

  fillImage(output, 0, 0, 0, 255);

  drawLabel(output, 'Expected', 0, 2);
  drawLabel(output, 'Actual', expected.width + gap, 2);
  drawLabel(output, 'Diff', expected.width * 2 + gap * 2, 2);

  copyImage(expected, output, 0, titleHeight);
  copyImage(actual, output, expected.width + gap, titleHeight);
  copyImage(diff, output, expected.width * 2 + gap * 2, titleHeight);

  const artifactsPath = path.resolve(process.cwd(), '.pr_uploads/visual');

  fs.mkdirSync(artifactsPath, { recursive: true });
  fs.writeFileSync(path.resolve(artifactsPath, name), PNG.sync.write(output));
}

const removeFile: BrowserCommand<[filePath: string]> = ({ testPath }, filePath) => {
  const resolved = path.resolve(path.dirname(testPath!), filePath);
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
};

const compareScreenshot: BrowserCommand<[imagePath: string, pixelMatch?: number]> = (
  { testPath, project },
  imagePath,
  pixelMatch,
) => {
  // 'all' with --update (npm run test:update), 'new' locally, 'none' in CI —
  // so CI fails on a missing reference instead of silently self-seeding one.
  const updateSnapshot = project.config.snapshotOptions.updateSnapshot;

  // get the path to the image
  const imagePathResolved = path.resolve(path.dirname(testPath!), imagePath);
  const compareImage = path.resolve(process.cwd(), 'tests/snapshots', path.basename(imagePathResolved));

  // check if the compare image exists
  if (!fs.existsSync(compareImage)) {
    if (updateSnapshot === 'none') {
      throw new Error(
        `Missing reference snapshot ${path.basename(compareImage)}. Run \`npm run test:update\` locally and commit the result.`,
      );
    }

    fs.mkdirSync(path.dirname(compareImage), { recursive: true });
    fs.copyFileSync(imagePathResolved, compareImage);

    return { result: true, diff: 0 };
  }

  const actual = PNG.sync.read(fs.readFileSync(imagePathResolved));
  const expected = PNG.sync.read(fs.readFileSync(compareImage));
  const width = Math.max(actual.width, expected.width);
  const height = Math.max(actual.height, expected.height);
  const comparableActual = resizeImage(actual, width, height);
  const comparableExpected = resizeImage(expected, width, height);
  const diff = new PNG({ width, height });

  const res = pixelmatch(comparableActual.data, comparableExpected.data, diff.data, width, height, { threshold: 0.1 });

  if (res > (pixelMatch ?? 0)) {
    // In update mode, replace failing references instead of reporting them.
    // Passing snapshots are left alone so a full update run doesn't churn every PNG.
    if (updateSnapshot === 'all') {
      fs.copyFileSync(imagePathResolved, compareImage);

      return { result: true, diff: 0 };
    }

    console.error(`Image ${path.basename(imagePathResolved)} has a diff of ${res} pixels`);
    saveFailureArtifact(path.basename(imagePathResolved), comparableExpected, comparableActual, diff);
  }

  return { result: res === 0, diff: res };
};

export default function BrowserCommands(): Plugin {
  return {
    name: 'vitest:compare-screenshot',
    config() {
      return {
        test: {
          browser: {
            commands: {
              compareScreenshot,
              removeFile,
            },
          },
        },
      };
    },
  };
}

// if you are using TypeScript, you can augment the module
declare module 'vitest/browser' {
  interface BrowserCommands {
    compareScreenshot: (imagePath: string, pixelMatch?: number) => Promise<{ result: boolean; diff: number }>;
    removeFile: (filePath: string) => Promise<void>;
  }
}
