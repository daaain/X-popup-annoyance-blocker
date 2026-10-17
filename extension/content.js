// X Popup Annoyance Blocker
//
// x.com currently ships two frontends, and the mobile variants are the most
// aggressive:
//  - Logged-out visitors get a server-rendered page (utility CSS classes,
//    Base UI dialogs, no #react-root). Annoyances: a "Continue to X" content
//    wall, a "Scan to get the app" QR popup, a login modal, a cookie banner,
//    clicks on posts hijacked to show a "Don't miss what's happening"
//    engagement modal, photos and video controls that link to a page that is
//    just the post again, and on mobile a "Get the full app experience"
//    app-store obstruction plus tweet links rewritten to bounce into the app
//    store.
//  - The classic React app (#react-root, data-testid) when logged in.
//
// Design notes, learned the hard way:
//  * Scrolling is never "detected and repaired" by matching whichever
//    property X used this week. hide.css carries !important unlock rules
//    keyed on an .xpab-unlock class that we keep on <html> at all times
//    unless a dialog the user actually asked for is open. That beats inline
//    styles AND utility classes, in whatever combination.
//  * Everything runs on a repeating heal() loop, not just on mutations: X
//    re-applies locks and re-poisons links after hydration and on client-side
//    navigation, and some of that happens without a mutation we observe.
//  * Link de-poisoning cannot rely on click handlers alone (the page's own
//    onclick may navigate first), so rules.json also strips the app-store
//    redirect at the network layer.

(() => {
  'use strict';

  const PREFIX = '[x-popup-annoyance-blocker]';
  // Diagnostics can be switched on from a phone with no console or USB
  // debugging: just append #xpab-debug to any x.com URL in the address bar.
  let DEBUG = false;
  try { DEBUG = localStorage.getItem('xpab-debug') === '1'; } catch { /* private mode */ }
  if (location.hash.includes('xpab-debug')) DEBUG = true;
  const log = (...args) => { if (DEBUG) console.log(PREFIX, ...args); };

  const stats = { dialogs: 0, nags: 0, links: 0, cookies: 0, unlocks: 0 };

  // ---------------------------------------------------------------- intent —
  // Track the user's last real gesture so dialogs they asked for are spared.
  const lastGesture = { ts: 0, clickTs: 0, loginIntent: false };
  const keptDialogs = new WeakSet();

  const LOGIN_INTENT_RE =
    /\b(log ?in|sign ?(up|in)|continue (with|to)|create (an )?account|join now)\b/i;

  function looksLikeLoginControl(el) {
    const control = el.closest && el.closest('a, button, [role="button"], input, label');
    if (!control) return false;
    const href = (control.getAttribute && control.getAttribute('href')) || '';
    if (/\/(i\/flow\/)?(login|signup)|onboarding/.test(href)) return true;
    const label =
      (control.getAttribute('aria-label') || '') + ' ' + (control.textContent || '');
    return LOGIN_INTENT_RE.test(label.slice(0, 300));
  }

  function recordGesture(e) {
    if (!e.isTrusted) return;
    lastGesture.ts = Date.now();
    if (e.type === 'click') lastGesture.clickTs = lastGesture.ts;
    lastGesture.loginIntent =
      e.target instanceof Element ? looksLikeLoginControl(e.target) : false;
  }

  // --------------------------------------------------------- scroll unlock —
  // A dialog we deliberately kept, still on screen, is the only reason to let
  // X lock scrolling. Note this checks *kept* dialogs only: a cookie banner
  // or a nag we have not managed to remove yet must never keep the page
  // frozen (that bug made the whole extension useless on mobile).
  function keptDialogOpen() {
    for (const d of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
      if (keptDialogs.has(d) && d.isConnected && d.offsetParent !== null) return true;
    }
    return false;
  }

  function applyUnlock() {
    const html = document.documentElement;
    if (!html) return;
    const shouldUnlock = !keptDialogOpen();
    if (html.classList.contains('xpab-unlock') !== shouldUnlock) {
      html.classList.toggle('xpab-unlock', shouldUnlock);
      if (shouldUnlock) stats.unlocks++;
      log(shouldUnlock ? 'scroll unlocked' : 'scroll lock allowed (user dialog open)');
    }
    if (!shouldUnlock) return;

    // The CSS handles the visual lock; also clear the inline properties so
    // X's own bookkeeping doesn't fight us, and restore the offset stashed by
    // the position:fixed lock technique.
    for (const el of [document.documentElement, document.body]) {
      if (!el || !el.style) continue;
      const s = el.style;
      if (s.position === 'fixed') {
        const top = parseInt(s.top, 10);
        s.position = '';
        s.top = '';
        s.left = '';
        s.width = '';
        if (Number.isFinite(top) && top < 0) window.scrollTo(0, -top);
      }
      for (const prop of ['overflow', 'overflowY', 'overscrollBehaviorY', 'touchAction']) {
        if (s[prop] && /hidden|none/.test(s[prop])) s[prop] = '';
      }
      if (s.marginRight) s.marginRight = '';
      if (s.paddingRight) s.paddingRight = '';
    }
  }

  // ------------------------------------------------------------- selectors —
  const isJetfuelPage = () => !document.getElementById('react-root');

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
    'button[aria-label="Dismiss"]',
  ].join(', ');

  const isAppStoreObstruction = (el) =>
    /app-store-obstruction/.test(el.getAttribute('data-interaction') || '') ||
    !!el.querySelector('[data-interaction*="app-store-obstruction"]') ||
    !!el.querySelector('a[href*="launch_app_store"]');

  // textContent runs adjacent elements together ("…happeningPeople on X…"),
  // which defeats the \b word boundaries in ANNOYANCE_TEXT.
  function readableText(el) {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
    return parts.join(' ');
  }

  function isAnnoyanceDialog(dialog) {
    if (isAppStoreObstruction(dialog)) return true;
    if (dialog.hasAttribute('data-engagement-modal')) return true;
    const ariaLabel = dialog.getAttribute('aria-label') || '';
    if (/\b(log ?in|sign ?up)\b/i.test(ariaLabel)) return true;
    if (dialog.querySelector(LEGACY_ANNOYANCE_SELECTORS)) return true;
    if (dialog.querySelector('[data-icon="icon-google"], [data-icon="icon-apple"]')) return true;
    const text = readableText(dialog);
    return text.length < 3000 && ANNOYANCE_TEXT.test(text);
  }

  // ------------------------------------------------------- cookie consent —
  // Geo-gated (EU/UK), so this cannot be exercised from a US test runner —
  // written defensively and matched on several phrasings. Clicking X's own
  // refuse button is preferred because it persists the choice; removal is the
  // fallback so the banner at least stops covering the page.
  const COOKIE_RE = /cookie/i;
  const REFUSE_RE =
    /\b(refuse|reject|decline|deny)\b|only (strictly )?necessary|(strictly )?necessary only|essential (cookies )?only|only essential|non-essential/i;
  const ACCEPT_RE = /\b(accept|allow|agree|got it|ok)\b/i;
  const cookieAttempts = new WeakMap();

  function handleCookieBanner() {
    const candidates = new Set();
    for (const el of document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [id*="consent" i], [class*="consent" i], [data-testid*="cookie" i], [aria-label*="cookie" i]'
    )) {
      candidates.add(el);
    }
    // Fixed-position containers that talk about cookies (X's banner is a
    // bottom sheet that is not always a dialog).
    for (const el of document.querySelectorAll('body > div, body > section, body > aside')) {
      const s = getComputedStyle(el);
      if (s.position === 'fixed' && COOKIE_RE.test(el.textContent || '')) candidates.add(el);
    }

    for (const banner of candidates) {
      const text = banner.textContent || '';
      if (!COOKIE_RE.test(text) || text.length > 4000) continue;
      const tried = cookieAttempts.get(banner) || 0;
      if (tried >= 3) continue;
      cookieAttempts.set(banner, tried + 1);

      const buttons = [...banner.querySelectorAll('button, [role="button"], a')];
      const refuse = buttons.find((b) => {
        const label = (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '');
        return REFUSE_RE.test(label) && !ACCEPT_RE.test(label.replace(REFUSE_RE, ''));
      });
      if (refuse) {
        log('cookie banner: clicking refuse ->', (refuse.textContent || '').trim().slice(0, 40));
        stats.cookies++;
        refuse.click();
        // If the click did nothing (or X ignored it), take the banner out.
        setTimeout(() => {
          if (banner.isConnected && COOKIE_RE.test(banner.textContent || '')) {
            log('cookie banner survived the click; removing');
            banner.remove();
            applyUnlock();
          }
        }, 600);
      } else if (tried >= 1) {
        // No refuse control we recognise (localised UI?) — stop it blocking
        // the page rather than leaving it there forever.
        log('cookie banner: no refuse button found; removing');
        stats.cookies++;
        banner.remove();
      }
      applyUnlock();
    }
  }

  // ---------------------------------------------------------- app links —
  // Mobile tweet links are rewritten to
  //   https://m.x.com/<user>/status/<id>?launch_app_store=true&ct=...
  // so a tap bounces into the app store instead of opening the post.
  function cleanUrl(href) {
    if (!href) return null;
    if (/^(twitter|x|intent):/i.test(href)) return 'about:blank#xpab-blocked';
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return null;
    }
    let changed = false;
    if (url.hostname === 'm.x.com' || url.hostname === 'm.twitter.com') {
      url.hostname = url.hostname.slice(2);
      changed = true;
    }
    for (const param of ['launch_app_store', 'ct', 'mx']) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    }
    return changed ? url.href : null;
  }

  const POISONED_SELECTOR =
    'a[href*="launch_app_store"], a[href^="https://m.x.com/"], a[href^="https://m.twitter.com/"], a[href^="twitter://"], a[href^="intent:"]';

  function cleanAppLinks(root = document) {
    for (const a of root.querySelectorAll(POISONED_SELECTOR)) {
      const cleaned = cleanUrl(a.getAttribute('href'));
      if (cleaned) {
        log('cleaning app link', a.getAttribute('href'));
        stats.links++;
        a.setAttribute('href', cleaned);
      }
    }
  }

  // Safety net for links poisoned at tap time: fix the href during the
  // capture phase of the earliest events, before the page's own handlers run.
  function guardTap(e) {
    if (!(e.target instanceof Element)) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    const cleaned = cleanUrl(a.getAttribute('href'));
    if (cleaned) {
      log('cleaning app link at tap time');
      stats.links++;
      a.setAttribute('href', cleaned);
    }
  }

  // ---------------------------------------------- post and profile clicks —
  // Logged out, X's in-page navigation is broken for the pages people open
  // most, while a full page load of the same URL works:
  //  - clicks on a post (its date or its body, the whole card being a
  //    [role="link"][data-href]) are cancelled to show the engagement modal;
  //  - opening a profile fetches its timeline from an API that returns 404,
  //    leaving "Something went wrong" instead of posts.
  // So open these ourselves, as a normal page load, before X's handlers see
  // the click. Buttons (Like, Reply, ...), media and other links are left to X
  // (photos and video controls are handled by openPhoto and videoControl).
  const POST_PATH_RE = /^\/[^/]+\/status\/\d+/;
  const PROFILE_PATH_RE = /^\/[A-Za-z0-9_]{1,15}\/?$/; // X handles: up to 15 word characters
  const CLICKABLE_SELECTOR =
    'a[href], [role="link"][data-href], button, [role="button"], video, input, textarea, select, label';

  function pageUrlFor(target) {
    const clickable = target.closest(CLICKABLE_SELECTOR);
    if (!clickable) return null;
    const href = clickable.getAttribute('href') ?? clickable.getAttribute('data-href');
    if (!href) return null;
    let url;
    try {
      url = new URL(cleanUrl(href) ?? href, location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;
    return POST_PATH_RE.test(url.pathname) || PROFILE_PATH_RE.test(url.pathname) ? url : null;
  }

  // A plain left click on the logged-out page: the only clicks we take over.
  // With a modifier (new tab etc.) the browser's default is left alone.
  function plainClick(e) {
    return e.isTrusted && !e.defaultPrevented && e.button === 0 &&
      !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) &&
      isJetfuelPage() && e.target instanceof Element;
  }

  function openPageDirectly(e) {
    if (!plainClick(e)) return;
    if (!window.getSelection().isCollapsed) return; // the user was selecting text
    const url = pageUrlFor(e.target);
    if (!url || url.pathname === location.pathname) return;
    log('opening page directly', url.pathname);
    e.preventDefault();
    e.stopImmediatePropagation();
    location.assign(url.href);
  }

  // --------------------------------------------------------------- photos —
  // A photo in a post is an <img> (in an inert wrapper) with an empty
  // "View media" link laid over it, pointing at /<user>/status/<id>/photo/<n>.
  // Logged out, that page is just the post again, so show the image in an
  // overlay of our own instead: one click opens it, another anywhere closes it.
  // A post with several photos (a carousel of such cells) can be paged through
  // with the arrow buttons, the arrow keys or a swipe.
  //
  // Back closes the overlay rather than leaving the page: opening it adds a
  // history entry for the same URL, and the popstate that removes it again is
  // stopped before X's router can react to it.
  const PHOTO_PATH_RE = /^\/[^/]+\/status\/(\d+)\/photo\/(\d+)\/?$/;
  const SWIPE_PX = 50;
  let photoOverlay = null;
  let photoStep = null;
  let photoHistoryEntry = false;

  // pbs.twimg.com picks the size from the `name` param; 4096x4096 is the
  // largest it serves in any format ('orig' only exists in the upload's own).
  function fullSizeUrl(src) {
    try {
      const url = new URL(src);
      if (url.hostname !== 'pbs.twimg.com' || !url.searchParams.has('name')) return src;
      url.searchParams.set('name', '4096x4096');
      return url.href;
    } catch {
      return src;
    }
  }

  function photoLinkInfo(link) {
    let url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch {
      return null;
    }
    const m = url.origin === location.origin && PHOTO_PATH_RE.exec(url.pathname);
    if (!m) return null;
    const thumb = link.parentElement && link.parentElement.querySelector('img');
    const src = thumb && (thumb.currentSrc || thumb.src); // lazy images still have src
    return src ? { statusId: m[1], n: Number(m[2]), src, alt: thumb.alt } : null;
  }

  // Every photo of the post, in order. The page can render a post more than
  // once (e.g. for different layouts), so keep one per photo number.
  function photosOfPost(statusId) {
    const byNumber = new Map();
    for (const link of document.querySelectorAll(`a[href*="/status/${statusId}/photo/"]`)) {
      const info = photoLinkInfo(link);
      if (info && info.statusId === statusId && !byNumber.has(info.n)) byNumber.set(info.n, info);
    }
    return [...byNumber.values()].sort((a, b) => a.n - b.n);
  }

  function closePhoto() {
    if (!photoOverlay) return;
    photoOverlay.remove();
    photoOverlay = null;
    photoStep = null;
    document.removeEventListener('keydown', photoKeys, true);
    if (photoHistoryEntry) history.back(); // its popstate goes to photoBack
  }

  function photoBack(e) {
    if (!photoHistoryEntry) return;
    photoHistoryEntry = false;
    e.stopImmediatePropagation();
    closePhoto();
  }

  function photoKeys(e) {
    const step = { Escape: 0, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step === undefined) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (step) photoStep(step);
    else closePhoto();
  }

  function photoButton(label, text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.textContent = text;
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // a click anywhere else closes the overlay
      onClick();
    });
    return button;
  }

  function showPhotos(photos, start) {
    let index = start;
    const overlay = (photoOverlay = document.createElement('div'));
    overlay.className = 'xpab-photo';
    overlay.tabIndex = -1;
    const img = document.createElement('img');
    overlay.appendChild(img);

    const multiple = photos.length > 1;
    const prev = photoButton('Previous photo', '‹', () => step(-1));
    const next = photoButton('Next photo', '›', () => step(1));
    const counter = document.createElement('div');
    prev.className = 'xpab-photo-prev';
    next.className = 'xpab-photo-next';
    counter.className = 'xpab-photo-counter';
    if (multiple) overlay.append(prev, next, counter);

    function show() {
      const photo = photos[index];
      img.alt = photo.alt;
      img.src = photo.src; // usually already loaded: shows at once, then swaps to full size
      const full = fullSizeUrl(photo.src);
      if (full !== photo.src) {
        const loader = new Image();
        loader.onload = () => {
          if (photos[index] === photo) img.src = full;
        };
        loader.src = full;
      }
      prev.hidden = index === 0;
      next.hidden = index === photos.length - 1;
      counter.textContent = `${index + 1} / ${photos.length}`;
    }
    function step(delta) {
      const to = index + delta;
      if (to < 0 || to >= photos.length) return;
      index = to;
      show();
    }
    photoStep = step;

    let touch = null;
    overlay.addEventListener('touchstart', (e) => {
      touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      if (!touch || !multiple) return;
      const dx = e.changedTouches[0].clientX - touch.x;
      const dy = e.changedTouches[0].clientY - touch.y;
      touch = null;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    });

    overlay.addEventListener('click', closePhoto);
    document.addEventListener('keydown', photoKeys, true);
    show();
    document.body.appendChild(overlay);
    overlay.focus();
    history.pushState(history.state, '');
    photoHistoryEntry = true;
  }

  function openPhoto(e) {
    if (!plainClick(e) || photoOverlay) return;
    const link = e.target.closest('a[href]');
    const clicked = link && photoLinkInfo(link);
    if (!clicked) return;
    const photos = photosOfPost(clicked.statusId);
    const start = photos.findIndex((p) => p.n === clicked.n);
    if (start === -1) return;
    photos[start] = clicked; // the copy actually clicked
    log('showing photo', clicked.n, 'of', photos.length);
    e.preventDefault();
    e.stopImmediatePropagation();
    showPhotos(photos, start);
  }

  // ------------------------------------------------------- video controls —
  // The player's Picture-in-Picture and Full screen buttons are inert, each
  // with an empty link to /<user>/status/<id>/video/<n> laid over it, which
  // logged out is just the post again. Do what the buttons say instead,
  // telling them apart by icon rather than by (localised) label. Full screen
  // takes the whole player, so X's own controls keep working in it.
  const VIDEO_PATH_RE = /^\/[^/]+\/status\/\d+\/video\/\d+\/?$/;
  const VIDEO_CONTROL_ICONS = {
    'icon-media-expand': 'fullscreen',
    'icon-media-collapse': 'fullscreen', // the same button while full screen
    'icon-media-dock': 'pip',
  };

  function toggleFullscreen(player, video) {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (player.requestFullscreen) {
      player.requestFullscreen().catch((err) => log('full screen refused', err));
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen(); // iOS Safari: only a <video> can go full screen
    }
  }

  function togglePictureInPicture(video) {
    if (!document.pictureInPictureEnabled) {
      // Firefox has no API for it, only its own control on the video.
      showNotice("Use the browser's own picture-in-picture control");
    } else if (document.pictureInPictureElement === video) {
      document.exitPictureInPicture();
    } else {
      video.disablePictureInPicture = false;
      video.requestPictureInPicture().catch((err) => log('picture-in-picture refused', err));
    }
  }

  function videoControl(e) {
    if (!plainClick(e)) return;
    const link = e.target.closest('a[href]');
    if (!link) return;
    let url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin || !VIDEO_PATH_RE.test(url.pathname)) return;
    const icon = link.parentElement.querySelector('[data-icon]');
    const action = icon && VIDEO_CONTROL_ICONS[icon.getAttribute('data-icon')];
    let player = link.parentElement;
    while (player && !player.querySelector('video')) player = player.parentElement;
    if (!action || !player) return;
    const video = player.querySelector('video');
    log('video control', action);
    e.preventDefault();
    e.stopImmediatePropagation();
    if (action === 'fullscreen') toggleFullscreen(player, video);
    else togglePictureInPicture(video);
  }

  // --------------------------------------------------------------- notice —
  // Login-only actions (Like, Download video, ...) make X open a full-screen
  // popup. We close it, so say briefly why the click did nothing.
  const NOTICE_MS = 3000;
  let notice = null;
  let noticeTimer = 0;

  function showNotice(text) {
    if (!document.body) return;
    if (!notice || !notice.isConnected) {
      notice = document.createElement('div');
      notice.className = 'xpab-notice';
      notice.setAttribute('role', 'status');
      document.body.appendChild(notice);
    }
    notice.textContent = text;
    notice.classList.add('xpab-notice-visible');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove('xpab-notice-visible'), NOTICE_MS);
  }

  // ------------------------------------------------------------ dismissal —
  const attempts = new WeakMap();

  function pressEscape(target) {
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
          bubbles: true, cancelable: true,
        })
      );
    }
  }

  function topLayerOf(el) {
    const layers = document.getElementById('layers');
    const root = layers && layers.contains(el) ? layers : document.body;
    let node = el;
    while (node.parentElement && node.parentElement !== root) node = node.parentElement;
    return node;
  }

  function removeBackdrops() {
    if (!document.body) return;
    for (const child of [...document.body.children]) {
      if (child === photoOverlay || child.querySelector('[role="dialog"]')) continue;
      const s = getComputedStyle(child);
      if (s.position !== 'fixed' || s.display === 'none') continue;
      const r = child.getBoundingClientRect();
      const coversViewport = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
      if (coversViewport && !(child.textContent || '').trim()) {
        log('removing backdrop');
        child.remove();
      }
    }
  }

  function dismissDialog(dialog) {
    const tried = attempts.get(dialog) || 0;
    if (tried >= 3) return;
    attempts.set(dialog, tried + 1);
    stats.dialogs++;

    // A popup answering the user's own click (rather than one X opened by
    // itself) means they tried something that needs an account.
    if (tried === 0 && Date.now() - lastGesture.clickTs < 1500 && !isAppStoreObstruction(dialog)) {
      showNotice('X requires an account for this');
    }

    // The app-store obstruction has no state worth unwinding, and its
    // post-scroll variant ignores Escape. Its wrapper carries its own
    // backdrop, so removing just the dialog is complete.
    if (isAppStoreObstruction(dialog)) {
      log('removing app-store obstruction');
      dialog.remove();
      applyUnlock();
      return;
    }

    const closeButton = dialog.querySelector(CLOSE_BUTTON_SELECTORS);
    if (closeButton) {
      log('clicking close button');
      closeButton.click();
    } else {
      log('sending Escape');
      pressEscape(dialog);
    }

    setTimeout(() => {
      if (dialog.isConnected) {
        log('dialog survived; removing');
        topLayerOf(dialog).remove();
        removeBackdrops();
      }
      applyUnlock();
    }, 400);
  }

  function shouldDismiss(dialog) {
    const sinceGesture = Date.now() - lastGesture.ts;
    if (sinceGesture < 1500 && lastGesture.loginIntent) {
      keptDialogs.add(dialog); // user asked for this one
      return false;
    }
    if (isAnnoyanceDialog(dialog)) return true;
    // A dialog that appears with no recent user gesture on the logged-out
    // page is a nag even if its (possibly localised) text doesn't match.
    return sinceGesture >= 1500 && isJetfuelPage();
  }

  // ----------------------------------------------------------------- heal —
  function heal() {
    if (!document.body) return;

    for (const dialog of document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [data-engagement-modal], [data-testid="sheetDialog"], [data-testid="confirmationSheetDialog"]'
    )) {
      if (keptDialogs.has(dialog)) continue;
      if (shouldDismiss(dialog)) dismissDialog(dialog);
    }

    // Static nags (also hidden instantly by hide.css).
    for (const el of document.querySelectorAll(
      'aside.fixed.bottom-0, button.fixed[class~="z-1000"], [data-interaction="app-store-obstruction"]'
    )) {
      if (el.tagName === 'BUTTON' && !el.querySelector('img')) continue;
      log('removing static nag', el.tagName);
      stats.nags++;
      el.remove();
    }

    for (const iframe of document.querySelectorAll('iframe[src*="accounts.google.com/gsi/"]')) {
      const container = iframe.closest('#layers > div') || iframe.parentElement;
      log('removing Google one-tap');
      stats.nags++;
      (container || iframe).remove();
    }

    // X turns off picture-in-picture, which also hides the browser's own
    // control for it.
    for (const video of document.querySelectorAll('video[disablepictureinpicture]')) {
      video.disablePictureInPicture = false;
    }

    handleCookieBanner();
    cleanAppLinks();
    applyUnlock();
    if (DEBUG) updateBadge();
  }

  let scheduled = false;
  function scheduleHeal() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      heal();
    });
  }

  // ----------------------------------------------------------- debug badge —
  // Turn on from the page console (or via a bookmarklet on mobile) with:
  //   localStorage.setItem('xpab-debug', '1')
  // so the extension's activity can be reported from a phone without USB
  // debugging. Remove with localStorage.removeItem('xpab-debug').
  let badge = null;
  function collectReport() {
    const seen = [];
    for (const el of document.querySelectorAll('body *')) {
      const st = getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky') continue;
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 40) continue;
      if (seen.some((s) => s.el.contains(el))) continue;
      seen.push({ el, r });
      if (seen.length >= 12) break;
    }
    return JSON.stringify(
      {
        url: location.href,
        ua: navigator.userAgent,
        unlocked: document.documentElement.classList.contains('xpab-unlock'),
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        bodyPosition: getComputedStyle(document.body).position,
        htmlClass: document.documentElement.className.slice(0, 200),
        bodyClass: document.body.className.slice(0, 200),
        stats,
        poisonedLinks: [...document.querySelectorAll(POISONED_SELECTOR)]
          .slice(0, 5)
          .map((a) => a.getAttribute('href')),
        overlays: seen.map(({ el, r }) => ({
          tag: el.tagName,
          id: el.id,
          role: el.getAttribute('role'),
          dataInteraction: el.getAttribute('data-interaction'),
          cls: (el.className || '').toString().slice(0, 160),
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          html: el.outerHTML.slice(0, 700),
        })),
      },
      null,
      1
    );
  }

  function updateBadge() {
    if (!document.body) return;
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'xpab-debug-badge';
      badge.style.cssText =
        'position:fixed;bottom:0;left:0;z-index:2147483647;background:#111;color:#0f0;' +
        'font:11px/1.5 monospace;padding:4px 6px;white-space:pre;opacity:.9';
      const btn = document.createElement('button');
      btn.textContent = 'COPY REPORT';
      btn.style.cssText =
        'margin-inline-start:8px;font:11px monospace;padding:2px 6px;background:#0f0;' +
        'color:#000;border:0;border-radius:3px';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const report = collectReport();
        try {
          await navigator.clipboard.writeText(report);
          btn.textContent = 'COPIED';
        } catch {
          // Clipboard is often blocked; show the text so it can be selected.
          const ta = document.createElement('textarea');
          ta.value = report;
          ta.style.cssText =
            'position:fixed;inset:5% 5% 15%;z-index:2147483647;width:90%;height:70%;font:10px monospace';
          document.body.appendChild(ta);
          ta.select();
          btn.textContent = 'SELECT + COPY';
        }
        setTimeout(() => (btn.textContent = 'COPY REPORT'), 4000);
      });
      badge.appendChild(document.createElement('span'));
      badge.appendChild(btn);
      document.body.appendChild(badge);
    }
    badge.firstChild.textContent =
      `xpab d:${stats.dialogs} n:${stats.nags} l:${stats.links} c:${stats.cookies} ` +
      `${document.documentElement.classList.contains('xpab-unlock') ? 'UNLOCKED' : 'LOCKED'}`;
  }

  // ----------------------------------------------------------------- start —
  // Unlock immediately: content.js runs at document_start, so the class is on
  // <html> before X's first paint and no lock ever takes visual effect.
  applyUnlock();

  for (const type of ['pointerdown', 'touchstart', 'mousedown', 'click']) {
    document.addEventListener(type, recordGesture, true);
    document.addEventListener(type, guardTap, true);
  }
  // On window, in the capture phase: the earliest point any page script can
  // see the click. Photos and video controls first: their links are under
  // /status/ too.
  window.addEventListener('click', openPhoto, true);
  window.addEventListener('click', videoControl, true);
  window.addEventListener('click', openPageDirectly, true);
  // Likewise before X's router, which must not see the photo overlay's
  // history entry go.
  window.addEventListener('popstate', photoBack, true);

  // X's modals also lock scrolling in JS: while one is mounted, a page-wide
  // listener (on document, capture phase) cancels every touchmove and wheel
  // event, so a finger can't scroll whatever the CSS says. Hiding or removing
  // the modal's DOM doesn't unmount it, so that lock never lifts. While the
  // page is unlocked, stop those events on window, before any page listener
  // can cancel them. The page's own touchmove/wheel handlers don't run then
  // either; native scrolling and taps are unaffected.
  for (const type of ['touchmove', 'wheel']) {
    window.addEventListener(
      type,
      (e) => {
        if (document.documentElement.classList.contains('xpab-unlock')) e.stopImmediatePropagation();
      },
      { capture: true, passive: true }
    );
  }

  new MutationObserver(scheduleHeal).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    // 'class' matters: X locks scrolling with utility classes as well as
    // inline styles, and omitting it meant the observer never fired for them.
    attributeFilter: ['style', 'class', 'data-open', 'data-state', 'data-interaction', 'href'],
  });

  // The repeating pass is the safety net: hydration, client-side navigation
  // and X's own retries re-apply locks and re-poison links in ways a single
  // mutation callback can miss.
  setInterval(() => {
    if (!document.hidden) heal();
  }, 500);

  for (const type of ['pageshow', 'popstate', 'visibilitychange', 'load', 'DOMContentLoaded']) {
    window.addEventListener(type, scheduleHeal, true);
  }

  heal();
  log('active');
})();
