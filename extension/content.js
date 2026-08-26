// X Popup Annoyance Blocker
//
// x.com currently serves two different frontends:
//  - Logged-out visitors get a server-rendered "jetfuel" page (Tailwind-style
//    classes, Base UI dialogs, no #react-root). Its annoyances: a fixed
//    "Continue to X" content wall, a "Scan to get the app" QR popup, and a
//    login/sign-up modal that locks scrolling with `overflow: hidden` on
//    <body> — which is why hiding the modal with an element-hiding filter
//    leaves the page unscrollable.
//  - The classic React app (#react-root, data-testid attributes) used when
//    logged in and in some other buckets, with its sheetDialog popups,
//    BottomBar, etc.
//
// Strategy, in order of preference, for dialogs:
//  1. Never dismiss a dialog the user just asked for (they clicked a
//     "Log in" / "Sign up" control) — otherwise logging in becomes impossible.
//  2. Dismiss via the page's own mechanisms first (cookie-refuse button,
//     close button, Escape key) so the page unlocks scrolling itself.
//  3. Fall back to removing the dialog + backdrop from the DOM and restoring
//     `overflow` on <html>/<body> ourselves.
// Static nags (wall, QR popup, bottom bar) are hidden by hide.css instantly
// and removed here as well.

(() => {
  'use strict';

  const LOG_PREFIX = '[x-popup-annoyance-blocker]';
  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log(LOG_PREFIX, ...args); };

  // ---------------------------------------------------------------- intent —
  // Track the user's last real gesture so dialogs they asked for are spared.
  const lastGesture = { ts: 0, loginIntent: false };

  const LOGIN_INTENT_RE =
    /\b(log ?in|sign ?(up|in)|continue (with|to)|create (an )?account|join now)\b/i;

  function looksLikeLoginControl(el) {
    const control = el.closest('a, button, [role="button"], input, label');
    if (!control) return false;
    const href = control.getAttribute && (control.getAttribute('href') || '');
    if (/\/(i\/flow\/)?(login|signup)/.test(href)) return true;
    const label =
      (control.getAttribute('aria-label') || '') + ' ' + (control.textContent || '');
    return LOGIN_INTENT_RE.test(label.slice(0, 300));
  }

  function recordGesture(e) {
    if (!e.isTrusted) return;
    lastGesture.ts = Date.now();
    lastGesture.loginIntent =
      e.target instanceof Element ? looksLikeLoginControl(e.target) : false;
  }
  document.addEventListener('pointerdown', recordGesture, true);
  document.addEventListener('click', recordGesture, true);

  // -------------------------------------------------------------- selectors —
  const isJetfuelPage = () => !document.getElementById('react-root');

  // Legacy React app: links / test ids that mark a dialog as a nag.
  const LEGACY_ANNOYANCE_SELECTORS = [
    'a[href^="/i/flow/signup"]',
    'a[href^="/i/flow/login"]',
    '[data-testid="loginButton"]',
    '[data-testid="signupButton"]',
    '[data-testid="google_sign_in_container"]',
    '[data-testid="apple_sign_in_button"]',
    'a[href*="app.link"]',
    'a[href*="play.google.com/store/apps"]',
    'a[href*="apps.apple.com"]',
  ].join(', ');

  const ANNOYANCE_TEXT =
    /\b(open (the )?app|switch to the app|use the app|get the (full )?app|full app experience|not on x yet|don.t miss what.s happening|see what.s happening|people on x are the first to know)\b/i;

  const CLOSE_BUTTON_SELECTORS = [
    '[data-testid="app-bar-close"]',
    '[aria-label="Close"][role="button"]',
    'button[aria-label="Close"]',
  ].join(', ');

  const COOKIE_REFUSE_TEXT = /refuse non-essential cookies/i;

  function isAnnoyanceDialog(dialog) {
    // Mobile "Get the full app experience" modal — X's own code calls it an
    // obstruction (data-interaction="app-store-obstruction").
    if (/app-store-obstruction/.test(dialog.getAttribute('data-interaction') || '')) return true;
    if (dialog.querySelector('[data-interaction*="app-store-obstruction"]')) return true;
    if (dialog.querySelector('a[href*="launch_app_store"]')) return true;
    const ariaLabel = dialog.getAttribute('aria-label') || '';
    if (/\b(log ?in|sign ?up)\b/i.test(ariaLabel)) return true;
    if (dialog.querySelector(LEGACY_ANNOYANCE_SELECTORS)) return true;
    if (dialog.querySelector('[data-icon="icon-google"], [data-icon="icon-apple"]')) return true;
    const text = dialog.textContent || '';
    return text.length < 3000 && ANNOYANCE_TEXT.test(text);
  }

  // --------------------------------------------------------------- dismissal —
  const attempts = new WeakMap();
  let dismissedSomething = false;

  function pressEscape(target) {
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }

  // The overlay's top-level container: direct child of <body> (jetfuel
  // portals) or of #layers (legacy app).
  function topLayerOf(el) {
    const layers = document.getElementById('layers');
    const root = layers && layers.contains(el) ? layers : document.body;
    let node = el;
    while (node.parentElement && node.parentElement !== root) node = node.parentElement;
    return node;
  }

  function removeBackdrops() {
    for (const child of [...document.body.children]) {
      if (child.querySelector('[role="dialog"]')) continue;
      const s = getComputedStyle(child);
      if (s.position !== 'fixed' || s.display === 'none') continue;
      const r = child.getBoundingClientRect();
      const coversViewport =
        r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
      const inert = !(child.textContent || '').trim();
      if (coversViewport && inert) {
        log('removing backdrop');
        child.remove();
      }
    }
  }

  function restoreScroll() {
    if (document.querySelector('[role="dialog"], [data-testid="sheetDialog"]')) return;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const s = el.style;
      if (s.overflow === 'hidden' || s.overflowY === 'hidden') {
        s.overflow = '';
        s.overflowY = '';
        s.marginRight = '';
        s.paddingRight = '';
        log('restored scroll on', el.tagName);
      }
      if (s.position === 'fixed') s.position = '';
      if (s.overscrollBehaviorY === 'none') s.overscrollBehaviorY = '';
    }
  }

  function forciblyRemove(dialog) {
    log('forcibly removing dialog');
    topLayerOf(dialog).remove();
    removeBackdrops();
    restoreScroll();
  }

  function dismissDialog(dialog) {
    const tried = attempts.get(dialog) || 0;
    if (tried >= 3) return;
    attempts.set(dialog, tried + 1);
    dismissedSomething = true;

    // The mobile app-install obstruction has no meaningful state to unwind
    // (and its "unclosable" variant ignores Escape) — remove it outright.
    if (
      /app-store-obstruction/.test(dialog.getAttribute('data-interaction') || '') ||
      dialog.querySelector('[data-interaction*="app-store-obstruction"]')
    ) {
      // The wrapper carries its own backdrop, so removing just the dialog
      // element is complete — and safer than walking up to a body-level
      // container, in case it isn't rendered through a portal.
      log('removing app-store obstruction');
      dialog.remove();
      restoreScroll();
      return;
    }

    // Cookie banner: click "Refuse non-essential cookies" so the choice
    // persists and the banner never returns.
    for (const btn of dialog.querySelectorAll('[role="button"], button')) {
      if (COOKIE_REFUSE_TEXT.test(btn.textContent || '')) {
        log('clicking cookie refuse button');
        btn.click();
        return;
      }
    }

    const closeButton = dialog.querySelector(CLOSE_BUTTON_SELECTORS);
    if (closeButton) {
      log('clicking close button');
      closeButton.click();
    } else {
      log('sending Escape');
      pressEscape(dialog);
    }

    // Verify it actually went away; if not, tear it out of the DOM.
    setTimeout(() => {
      if (dialog.isConnected) forciblyRemove(dialog);
      else restoreScroll();
    }, 400);
  }

  function shouldDismiss(dialog) {
    const sinceGesture = Date.now() - lastGesture.ts;
    if (sinceGesture < 1500 && lastGesture.loginIntent) return false; // user asked for it
    if (isAnnoyanceDialog(dialog)) return true;
    // A dialog that opens with no recent user gesture on the logged-out page
    // is a nag even if we can't parse its (possibly localized) content.
    return sinceGesture >= 1500 && isJetfuelPage();
  }

  // ------------------------------------------------------------- app links —
  // On the mobile page, tweet links are poisoned so a tap opens the app or
  // app store instead of the post:
  //   https://m.x.com/<user>/status/<id>?launch_app_store=true&ct=...
  // Rewrite them back to plain x.com URLs.
  function cleanUrl(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return null;
    }
    let changed = false;
    if (url.hostname === 'm.x.com' || url.hostname === 'm.twitter.com') {
      url.hostname = url.hostname === 'm.x.com' ? 'x.com' : 'twitter.com';
      changed = true;
    }
    for (const param of ['launch_app_store', 'ct']) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    }
    return changed ? url.href : null;
  }

  function cleanAppLinks(root) {
    for (const a of root.querySelectorAll(
      'a[href*="launch_app_store"], a[href^="https://m.x.com/"], a[href^="https://m.twitter.com/"]'
    )) {
      const cleaned = cleanUrl(a.getAttribute('href'));
      if (cleaned) {
        log('cleaning app link', a.getAttribute('href'));
        a.setAttribute('href', cleaned);
      }
    }
  }

  // Safety net for hrefs poisoned at tap time: fix the link during the
  // capture phase, before the page's own handlers read it.
  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Element)) return;
      const a = e.target.closest('a[href]');
      if (!a) return;
      const cleaned = cleanUrl(a.getAttribute('href'));
      if (cleaned) a.setAttribute('href', cleaned);
    },
    true
  );

  // ------------------------------------------------------------------- scan —
  function scan() {
    cleanAppLinks(document);
    for (const dialog of document.querySelectorAll(
      '[role="dialog"], [data-testid="sheetDialog"], [data-testid="confirmationSheetDialog"]'
    )) {
      if (shouldDismiss(dialog)) dismissDialog(dialog);
    }

    // Static nags on the logged-out page (also hidden instantly by hide.css).
    for (const el of document.querySelectorAll(
      'aside.fixed.bottom-0, button.fixed[class~="z-1000"]'
    )) {
      // The content wall is an <aside>; the QR popup is a fixed button with
      // an <img>. Don't touch anything else that happens to match.
      if (el.tagName === 'BUTTON' && !el.querySelector('img')) continue;
      log('removing static nag', el.tagName);
      el.remove();
      dismissedSomething = true;
    }

    // Google one-tap sign-in iframe popup (legacy app).
    for (const iframe of document.querySelectorAll('iframe[src*="accounts.google.com/gsi/"]')) {
      const container = iframe.closest('#layers > div') || iframe.parentElement;
      log('removing Google sign-in popup');
      (container || iframe).remove();
      dismissedSomething = true;
    }

    // X re-applies the scroll-lock on re-render; keep undoing it as long as
    // we've dismissed something and no dialog remains.
    if (dismissedSomething) restoreScroll();
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  function start() {
    document.documentElement.setAttribute('data-x-popup-annoyance-blocker', 'active');
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-open', 'data-state', 'href'],
    });
    scan();
    log('watching for popups');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
