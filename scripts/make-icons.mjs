// Renders the extension icon (an SVG defined inline) to PNGs at the sizes the
// manifest needs, using the pre-installed Chromium via Playwright.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iconsDir = path.join(root, 'extension', 'icons');

const svg = (size) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#0f1419"/>
  <!-- popup window being crossed out -->
  <rect x="26" y="34" width="76" height="60" rx="8" fill="#fff"/>
  <rect x="26" y="34" width="76" height="16" rx="8" fill="#536471"/>
  <rect x="26" y="42" width="76" height="8" fill="#536471"/>
  <circle cx="36" cy="42" r="3.5" fill="#fff"/>
  <circle cx="47" cy="42" r="3.5" fill="#fff"/>
  <!-- red cross over it -->
  <g stroke="#f4212e" stroke-width="14" stroke-linecap="round">
    <line x1="34" y1="36" x2="94" y2="96"/>
    <line x1="94" y1="36" x2="34" y2="96"/>
  </g>
</svg>`;

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
