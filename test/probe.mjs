// Diagnostic: load x.com logged-out WITHOUT the extension, provoke the
// popups, and dump their DOM so we can verify selectors.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, ARTIFACTS } from './lib.mjs';

const context = await launch({ withExtension: false });
const page = context.pages()[0] ?? (await context.newPage());

console.log('navigating…');
await page.goto('https://x.com/elonmusk', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);

for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(800);
}
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const layers = document.getElementById('layers');
  const dialogs = [...document.querySelectorAll('[role="dialog"], [data-testid="sheetDialog"]')];
  return {
    url: location.href,
    title: document.title,
    htmlStyle: document.documentElement.getAttribute('style'),
    bodyStyle: document.body.getAttribute('style'),
    scrollY: window.scrollY,
    layersChildren: layers ? [...layers.children].map((c) => c.outerHTML.slice(0, 4000)) : null,
    dialogCount: dialogs.length,
    bottomBar: document.querySelector('[data-testid="BottomBar"]')?.outerHTML.slice(0, 2000) ?? null,
    testids: [...document.querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid'))
      .filter((v, i, a) => a.indexOf(v) === i),
  };
});

await writeFile(path.join(ARTIFACTS, 'probe.json'), JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(ARTIFACTS, 'probe.png') });
console.log('title:', info.title);
console.log('scrollY:', info.scrollY);
console.log('html style:', info.htmlStyle);
console.log('body style:', info.bodyStyle);
console.log('dialogs:', info.dialogCount, '| layers children:', info.layersChildren?.length);
console.log('bottomBar present:', !!info.bottomBar);
console.log('saved probe.json + probe.png');

await context.close();
