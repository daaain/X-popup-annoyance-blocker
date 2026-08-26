// Deeper diagnostic: capture the full DOM of the logged-out page, wait for
// timed popups, and also probe a tweet-detail page.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, ARTIFACTS } from './lib.mjs';

const context = await launch({ withExtension: false });
const page = context.pages()[0] ?? (await context.newPage());

async function capture(name, url, { waitMs = 15000 } = {}) {
  console.log(`\n=== ${name}: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(waitMs);

  const info = await page.evaluate(() => ({
    url: location.href,
    htmlStyle: document.documentElement.getAttribute('style'),
    bodyStyle: document.body.getAttribute('style'),
    htmlComputedOverflow: getComputedStyle(document.documentElement).overflow,
    bodyComputedOverflow: getComputedStyle(document.body).overflow,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: innerHeight,
    hasLayers: !!document.getElementById('layers'),
    reactRoot: !!document.getElementById('react-root'),
    dialogs: [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].map((d) =>
      d.outerHTML.slice(0, 1500)
    ),
    fixedOverlays: [...document.querySelectorAll('body *')]
      .filter((e) => {
        const s = getComputedStyle(e);
        return (s.position === 'fixed' || s.position === 'sticky') && e.offsetHeight > 40 && e.offsetWidth > 40;
      })
      .slice(0, 20)
      .map((e) => ({
        tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 120),
        text: (e.textContent || '').slice(0, 120),
        rect: e.getBoundingClientRect().toJSON(),
      })),
  }));
  console.log(JSON.stringify({ ...info, dialogs: info.dialogs.length, fixedOverlays: info.fixedOverlays.length }, null, 1).slice(0, 800));

  const html = await page.content();
  await writeFile(path.join(ARTIFACTS, `${name}.html`), html);
  await writeFile(path.join(ARTIFACTS, `${name}.json`), JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
  return info;
}

await capture('profile', 'https://x.com/elonmusk');
const statusUrl = await page.evaluate(() => {
  const a = document.querySelector('a[href*="/status/"]');
  return a ? a.href : null;
});
console.log('\nstatus link found:', statusUrl);
if (statusUrl) await capture('status', statusUrl);
await context.close();
console.log('\ndone');
