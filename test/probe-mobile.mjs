// Diagnostic: mobile-UA logged-out x.com WITHOUT the extension.
// Capture the "Get the full app experience" popups (on-load closable variant,
// post-scroll non-closable variant) and the tweet-tap app redirect mechanism.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, ARTIFACTS } from './lib.mjs';

const context = await launch({ withExtension: false, mobile: true });
const page = context.pages()[0] ?? (await context.newPage());

const navigations = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

async function dump(name) {
  const info = await page.evaluate(() => ({
    url: location.href,
    htmlStyle: document.documentElement.getAttribute('style'),
    bodyStyle: document.body.getAttribute('style'),
    scrollY: window.scrollY,
    dialogs: [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog')].map(
      (d) => d.outerHTML.slice(0, 4000)
    ),
    // any fixed overlay large enough to be a popup card
    overlays: [...document.querySelectorAll('body *')]
      .filter((e) => {
        const s = getComputedStyle(e);
        return s.position === 'fixed' && e.offsetHeight > 100 && e.offsetWidth > 200;
      })
      .slice(0, 12)
      .map((e) => ({
        tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 200),
        text: (e.textContent || '').slice(0, 150),
        html: e.outerHTML.slice(0, 2500),
      })),
  }));
  await writeFile(path.join(ARTIFACTS, `${name}.json`), JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
  console.log(`--- ${name}: scrollY=${info.scrollY} bodyStyle=${JSON.stringify(info.bodyStyle)} dialogs=${info.dialogs.length} overlays=${info.overlays.length}`);
  for (const o of info.overlays) console.log('   overlay:', o.tag, '|', o.text.slice(0, 70).replace(/\s+/g, ' '));
  return info;
}

console.log('navigating…');
await page.goto('https://x.com/exolabs', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);
await dump('m1-onload');

// Tweet links: how would a tap open the app?
const linkInfo = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a[href*="/status/"]')].slice(0, 3).map((a) => ({
    href: a.getAttribute('href'),
    onclick: !!a.onclick,
  }));
  const appLinks = [...document.querySelectorAll('a')].filter((a) =>
    /twitter:\/\/|intent:|app\.link|onelink|play\.google/.test(a.href)
  ).slice(0, 5).map((a) => ({ href: a.href.slice(0, 150), text: (a.textContent || '').slice(0, 40) }));
  return { links, appLinks };
});
console.log('status links:', JSON.stringify(linkInfo, null, 1));

// Scroll to provoke the second (non-closable) popup.
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(700);
}
await page.waitForTimeout(6000);
await dump('m2-after-scroll');

// Try tapping a tweet to see the redirect behavior.
const target = page.locator('a[href*="/status/"]').first();
if (await target.count()) {
  await target.click({ timeout: 5000, force: true }).catch((e) => console.log('tap failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(4000);
  console.log('navigations so far:', JSON.stringify(navigations.slice(-3)));
  await dump('m3-after-tap');
}

await context.close();
console.log('done');
