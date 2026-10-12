// Runs the extension's logic against the synthetic fixture in BOTH engines.
//
// Chromium loads the real unpacked extension. Playwright's Firefox cannot
// install extensions, so there the content script and stylesheet are injected
// at document_start via addInitScript — which still exercises the Gecko
// behaviour of the code that runs on the user's phone (the packaging itself
// is validated separately by `web-ext lint`).
import { chromium, firefox } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_HTML } from './fixture.mjs';
import { ROOT, EXTENSION_DIR, ARTIFACTS } from './lib.mjs';
import { mkdir } from 'node:fs/promises';

const MOBILE_UA =
  'Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0';
const contentJs = readFileSync(path.join(EXTENSION_DIR, 'content.js'), 'utf8');
const hideCss = readFileSync(path.join(EXTENSION_DIR, 'hide.css'), 'utf8');

let failures = 0;
function check(engine, name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${engine}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function openPage(engine) {
  await mkdir(ARTIFACTS, { recursive: true });
  if (engine === 'chromium') {
    const ctx = await chromium.launchPersistentContext(
      path.join(ARTIFACTS, `syn-chromium-${Date.now()}`),
      {
        headless: true,
        // Defaults to Playwright's own Chromium; the sandbox VM sets CHROMIUM_PATH.
        executablePath: process.env.CHROMIUM_PATH || undefined,
        channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
        viewport: { width: 412, height: 915 },
        userAgent: MOBILE_UA,
        isMobile: true,
        hasTouch: true,
        args: [
          `--disable-extensions-except=${EXTENSION_DIR}`,
          `--load-extension=${EXTENSION_DIR}`,
        ],
      }
    );
    return { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()) };
  }
  const browser = await firefox.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent: MOBILE_UA,
    hasTouch: true,
  });
  // Emulate the content script's document_start injection.
  await ctx.addInitScript(`(() => {
    const css = ${JSON.stringify(hideCss)};
    const inject = () => {
      if (document.getElementById('xpab-css')) return;
      const s = document.createElement('style');
      s.id = 'xpab-css';
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    inject();
    document.addEventListener('readystatechange', inject, true);
  })();`);
  await ctx.addInitScript(contentJs);
  return { ctx, page: await ctx.newPage(), browser };
}

async function run(engine) {
  const { ctx, page, browser } = await openPage(engine);
  await page.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: FIXTURE_HTML })
  );
  await page.goto('https://x.com/fixture', { timeout: 30000 });

  // Let every delayed lock/popup in the fixture fire.
  await page.waitForTimeout(3500);

  const state = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const bs = getComputedStyle(document.body);
    return {
      htmlOverflowY: cs.overflowY,
      bodyOverflowY: bs.overflowY,
      bodyPosition: bs.position,
      bodyTouchAction: bs.touchAction,
      obstruction: !!document.querySelector('[data-interaction="app-store-obstruction"]'),
      obstructionVisible: !!document.querySelector(
        '[data-interaction="app-store-obstruction"]'
      )?.offsetParent,
      cookieBanner: !!document.getElementById('cookie'),
      refuseClicked: window.__fixture.refuseClicked,
      tweetHref: document.getElementById('tweet')?.getAttribute('href'),
      unlockClass: document.documentElement.classList.contains('xpab-unlock'),
      loginBoxVisible: document.getElementById('login-box').getClientRects().length > 0,
      otherSidebarVisible: document.getElementById('relevant-people').getClientRects().length > 0,
      noticeShown: !!document.querySelector('.xpab-notice-visible'),
    };
  });

  check(engine, 'scroll not locked by utility class', state.htmlOverflowY !== 'hidden' && state.bodyOverflowY !== 'hidden',
    `html=${state.htmlOverflowY} body=${state.bodyOverflowY}`);
  check(engine, 'position:fixed body lock undone', state.bodyPosition !== 'fixed', `position=${state.bodyPosition}`);
  check(engine, 'touch-action restored', state.bodyTouchAction !== 'none', `touch-action=${state.bodyTouchAction}`);
  check(engine, 'unlock class applied', state.unlockClass);
  check(engine, 'app obstruction gone', !state.obstruction || !state.obstructionVisible);
  check(engine, 'cookie banner handled via refuse button', state.refuseClicked && !state.cookieBanner,
    `refuseClicked=${state.refuseClicked} bannerPresent=${state.cookieBanner}`);
  check(engine, 'no notice for popups the user did not click for', !state.noticeShown);
  check(engine, 'sidebar login box hidden', !state.loginBoxVisible);
  check(engine, 'rest of the sidebar kept', state.otherSidebarVisible);
  check(engine, 'tweet href de-poisoned', !!state.tweetHref && !/launch_app_store|m\.x\.com/.test(state.tweetHref),
    state.tweetHref);

  // Page must actually scroll, despite the fixture re-applying the lock.
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(800);
  const scrollY = await page.evaluate(() => window.scrollY);
  check(engine, 'page actually scrolls', scrollY > 0, `scrollY=${scrollY}`);

  // Tapping the tweet must not hand the app-store URL to the page's onclick.
  await page.click('#tweet', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const navs = await page.evaluate(() => window.__fixture.appNavigations);
  check(engine, 'tap does not reach app-store URL', !navs.some((u) => /launch_app_store|m\.x\.com/.test(u)),
    JSON.stringify(navs));

  // Clicking a post must open it, not X's "Don't miss what's happening" modal.
  for (const target of ['#reply-date', '#reply-body']) {
    await page.goto('https://x.com/fixture', { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.click(target, { timeout: 5000 });
    await page.waitForURL('**/someone/status/456', { timeout: 3000 }).catch(() => {});
    check(engine, `clicking a post (${target}) opens it`,
      new URL(page.url()).pathname === '/someone/status/456', page.url());
  }

  // Clicks X still hijacks (e.g. Like, which needs an account) must not leave
  // the modal on screen.
  await page.goto('https://x.com/fixture', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.click('#reply-like', { timeout: 5000 });
  await page.waitForTimeout(800);
  const engagement = await page.evaluate(() => ({
    shown: window.__fixture.engagementModals,
    open: document.querySelectorAll('[data-engagement-modal]').length,
    notice: document.querySelector('.xpab-notice-visible[role="status"]')?.textContent ?? null,
  }));
  // Closed (not merely hidden), and promptly: recognised as a nag straight
  // away rather than by the "no recent gesture" fallback.
  check(engine, 'engagement modal dismissed', engagement.shown > 0 && engagement.open === 0,
    JSON.stringify(engagement));
  check(engine, 'notice explains the login-only click', /account/i.test(engagement.notice ?? ''),
    String(engagement.notice));
  check(engine, 'Like click does not navigate', new URL(page.url()).pathname === '/fixture', page.url());

  await page.screenshot({ path: path.join(ARTIFACTS, `synthetic-${engine}.png`) });
  await ctx.close();
  if (browser) await browser.close();
}

const engines = (process.env.ENGINES ?? 'chromium,firefox').split(',');
for (const engine of engines) await run(engine);
console.log(failures ? `\n${failures} synthetic check(s) FAILED` : '\nall synthetic checks passed');
process.exit(failures ? 1 : 0);
