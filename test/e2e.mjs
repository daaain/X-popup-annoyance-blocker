// End-to-end test: loads the extension into Chromium and verifies against the
// real (logged-out) x.com that:
//  1. the "Continue to X" content wall and "Scan to get the app" QR popup are
//     removed, and the page scrolls;
//  2. a spontaneously appearing login dialog (simulated) is removed and the
//     `overflow: hidden` scroll-lock on <body> is undone;
//  3. a login dialog the user explicitly opened (clicking a "Log in" control)
//     is NOT dismissed.
import path from 'node:path';
import { launch, ARTIFACTS } from './lib.mjs';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const context = await launch({ withExtension: true });
const page = context.pages()[0] ?? (await context.newPage());

// ---------------------------------------------------------------- scenario 1
await page.goto('https://x.com/elonmusk', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);

const s1 = await page.evaluate(() => ({
  wall: !!document.querySelector('aside.fixed.bottom-0'),
  qr: !!document.querySelector('button.fixed[class~="z-1000"]'),
  jetfuel: !document.getElementById('react-root'),
}));
check('content wall removed', !s1.wall);
check('QR app popup removed', !s1.qr);
console.log(`(page flavor: ${s1.jetfuel ? 'jetfuel SSR' : 'legacy React'})`);

const scrollBefore = await page.evaluate(() => window.scrollY);
await page.mouse.wheel(0, 2000);
await page.waitForTimeout(1000);
const scrollAfter = await page.evaluate(() => window.scrollY);
check('page scrolls', scrollAfter > scrollBefore, `scrollY ${scrollBefore} -> ${scrollAfter}`);
await page.screenshot({ path: path.join(ARTIFACTS, 'e2e-1-clean-page.png') });

// ---------------------------------------------------------------- scenario 2
// Simulate the spontaneous login modal + scroll-lock (the case uBlock's
// element-hiding leaves broken). Injected >1.5s after the last gesture, with
// no close button and immune to Escape — exercises the forcible-removal path.
await page.waitForTimeout(1600);
await page.evaluate(() => {
  document.body.style.overflow = 'hidden';
  const backdrop = document.createElement('div');
  backdrop.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Log in to X');
  dialog.style.cssText =
    'position:fixed;inset:0;margin:auto;height:300px;width:400px;background:#fff;z-index:9999;';
  dialog.innerHTML = '<h2>See what&#8217;s happening</h2><p>Sign up now</p>';
  document.body.append(backdrop, dialog);
});
await page.waitForTimeout(1500);

const s2 = await page.evaluate(() => ({
  dialog: !!document.querySelector('[role="dialog"]'),
  bodyOverflow: document.body.style.overflow,
}));
check('spontaneous dialog removed', !s2.dialog);
check('scroll-lock lifted', s2.bodyOverflow !== 'hidden', `body overflow: "${s2.bodyOverflow}"`);

const scroll2a = await page.evaluate(() => window.scrollY);
await page.mouse.wheel(0, 600);
await page.waitForTimeout(800);
const scroll2b = await page.evaluate(() => window.scrollY);
check('page scrolls after unlock', scroll2b !== scroll2a, `scrollY ${scroll2a} -> ${scroll2b}`);
await page.screenshot({ path: path.join(ARTIFACTS, 'e2e-2-after-unlock.png') });

// ---------------------------------------------------------------- scenario 3
// Intent handling. Playwright clicks are trusted input events, so wire up two
// buttons that open a login-style dialog: one labeled "Log in" (user intent —
// dialog must survive) and one labeled "View photo" (X hijacking a click —
// dialog must be dismissed).
await page.goto('https://x.com/elonmusk', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  const openLoginDialog = () => {
    document.body.style.overflow = 'hidden';
    const dialog = document.createElement('div');
    dialog.id = 'test-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Log in to X');
    dialog.style.cssText =
      'position:fixed;inset:0;margin:auto;height:200px;width:300px;background:#fff;z-index:9999;';
    dialog.textContent = 'Sign in to X';
    document.body.append(dialog);
  };
  for (const [id, label] of [['intent-login', 'Log in'], ['intent-other', 'View photo']]) {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.style.cssText = 'position:fixed;top:4px;z-index:10000;' + (id === 'intent-login' ? 'left:4px' : 'left:100px');
    b.addEventListener('click', openLoginDialog);
    document.body.append(b);
  }
});

await page.click('#intent-login');
await page.waitForTimeout(1500);
const s3a = await page.evaluate(() => !!document.getElementById('test-dialog'));
check('user-requested login dialog survives', s3a);
await page.evaluate(() => {
  document.getElementById('test-dialog')?.remove();
  document.body.style.overflow = '';
});

await page.waitForTimeout(1600);
await page.click('#intent-other');
await page.waitForTimeout(1500);
const s3b = await page.evaluate(() => ({
  dialog: !!document.getElementById('test-dialog'),
  overflow: document.body.style.overflow,
}));
check('click-hijack login dialog dismissed', !s3b.dialog && s3b.overflow !== 'hidden');

// The real "Log in with username or email" flow navigates to a dedicated
// page — make sure the extension doesn't interfere with reaching it.
const loginLink = page.locator('a:visible', { hasText: /log in with username/i }).first();
if (await loginLink.count()) {
  await loginLink.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  check('real login page reachable', /login/.test(page.url()), `url: ${page.url()}`);
  await page.screenshot({ path: path.join(ARTIFACTS, 'e2e-3-login-page.png') });
} else {
  console.log('SKIP  no visible "Log in with username" link');
}

await context.close();

// ---------------------------------------------------------------- scenario 4
// Mobile: the "Get the full app experience" obstruction modal must be gone,
// the page must scroll, and tweet links must not be poisoned with
// m.x.com / launch_app_store app redirects.
const mctx = await launch({ withExtension: true, mobile: true });
const mpage = mctx.pages()[0] ?? (await mctx.newPage());
await mpage.goto('https://x.com/exolabs', { waitUntil: 'domcontentloaded', timeout: 90000 });
await mpage.waitForTimeout(6000);

const m1 = await mpage.evaluate(() => ({
  obstruction: !!document.querySelector('[data-interaction*="app-store-obstruction"]'),
  dialogs: document.querySelectorAll('[role="dialog"]').length,
  poisoned: [...document.querySelectorAll('a[href]')].filter((a) =>
    /launch_app_store|^https:\/\/m\.(x|twitter)\.com\//.test(a.getAttribute('href') || '')
  ).length,
}));
check('mobile: app obstruction popup removed', !m1.obstruction && m1.dialogs === 0, `dialogs=${m1.dialogs}`);
check('mobile: no poisoned app links', m1.poisoned === 0, `${m1.poisoned} poisoned`);

// mouse.wheel is inert under Playwright's touch emulation, so assert
// scrollability directly: no overflow lock and a working scroll.
await mpage.evaluate(() => window.scrollTo(0, 1200));
await mpage.waitForTimeout(1000);
await mpage.evaluate(() => window.scrollTo(0, 2400));
await mpage.waitForTimeout(3000); // give the post-scroll popup a chance to appear
const m2 = await mpage.evaluate(() => ({
  scrollY: window.scrollY,
  htmlOverflow: getComputedStyle(document.documentElement).overflow,
  bodyOverflow: getComputedStyle(document.body).overflow,
  obstruction: !!document.querySelector('[data-interaction*="app-store-obstruction"]'),
}));
check(
  'mobile: page scrolls (no overflow lock)',
  m2.scrollY > 0 && m2.htmlOverflow !== 'hidden' && m2.bodyOverflow !== 'hidden',
  `scrollY=${m2.scrollY} html=${m2.htmlOverflow} body=${m2.bodyOverflow}`
);
check('mobile: post-scroll popup also gone', !m2.obstruction);
await mpage.screenshot({ path: path.join(ARTIFACTS, 'e2e-4-mobile-clean.png') });

// Tapping a tweet must open the post on x.com, not bounce to the app store.
const tweet = mpage.locator('a[href*="/status/"]').first();
if (await tweet.count()) {
  const href = await tweet.getAttribute('href');
  await tweet.click({ timeout: 8000 }).catch((e) => console.log('tap failed:', e.message.split('\n')[0]));
  await mpage.waitForTimeout(4000);
  const url = mpage.url();
  check(
    'mobile: tapping a tweet stays on x.com',
    /https:\/\/x\.com\/.+\/status\//.test(url) && !/launch_app_store|m\.x\.com/.test(url),
    `href=${href} -> ${url}`
  );
  await mpage.screenshot({ path: path.join(ARTIFACTS, 'e2e-4-mobile-status.png') });
} else {
  console.log('SKIP  no tweet link found on mobile profile');
}
await mctx.close();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
