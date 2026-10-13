// Renders the extension icon (extension/icons/icon.svg) to PNGs at the sizes the
// manifest needs, using the pre-installed Chromium via Playwright.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iconsDir = path.join(root, 'extension', 'icons');

const icon = await readFile(path.join(iconsDir, 'icon.svg'), 'utf8');
const svg = (size) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>
${icon}`;

await mkdir(iconsDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

for (const size of [48, 96, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(svg(size));
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(path.join(iconsDir, `icon-${size}.png`), buf);
  console.log(`wrote icon-${size}.png`);
}

await browser.close();
