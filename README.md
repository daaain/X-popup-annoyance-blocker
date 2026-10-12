# X Popup Annoyance Blocker

A tiny browser extension for **Chrome**, **Firefox**, and **Firefox for Android** that
dismisses the popups x.com forces on (mostly logged-out) visitors — the
sign-up / log-in modals and install-the-app nags — and restores page
scrolling afterwards.

Just hiding these popups with an element-hiding filter (e.g. uBlock Origin)
leaves the page broken, because X locks scrolling while the popup is "open".
This extension dismisses the popups through the page's own mechanisms where
possible, and — more importantly — *forces* the page to stay scrollable
rather than trying to guess which lock X used this time.

### How scrolling is restored

X freezes the page in several different ways: an inline `overflow: hidden`,
a utility class doing the same, `position: fixed` on `<body>` with a negative
offset, and `touch-action: none`. Chasing each variant is a losing game, so
`hide.css` ships `!important` unlock rules keyed on an `.xpab-unlock` class
that `content.js` keeps on `<html>` at all times — except while a dialog you
actually asked for is open. `!important` beats both inline styles and utility
classes, so new lock variants are neutralised without a code change.

Only the root element is allowed to become the scroll container: forcing
`overflow-y: auto` on `<body>` as well turns the body into its own scrollbox
and silently stops the window scrolling altogether. (The live test caught
exactly that regression.)

Everything runs on a repeating `heal()` pass (every 500 ms, plus a
MutationObserver and navigation events), because X re-applies locks and
re-poisons links after hydration and on client-side navigation — sometimes
without any mutation worth observing.

## What it blocks

x.com currently serves two different frontends, and the extension handles both:

**Logged-out server-rendered page** (the current default for visitors):

- The fixed **"Continue to X" content wall** at the bottom of profile and
  post pages ("See …'s full profile", "See all the replies").
- The floating **"Scan to get the app" QR popup**.
- The **login / sign-up modal** when it appears without you asking for it
  (X opens it spontaneously, or hijacks clicks on posts, Like, Follow, etc.),
  including undoing the `overflow: hidden` scroll-lock on `<body>`.
- The **Google "Sign in with Google" one-tap** overlay.
- The **"Don't miss what's happening" engagement modal** X shows instead of
  opening a post you click (its date or anywhere on the card). The post is
  opened directly instead, before X's click handler can cancel it.
- The **"Log in or sign up for X" box** at the top of the right-hand column.
- Cookie banners are answered with **"Refuse non-essential cookies"** where
  that button exists, so the choice persists.

**Mobile browser (logged out)** — the worst offenders:

- The **"Get the full app experience" / "Open X" modal** — both the closable
  on-load variant and the non-closable post-scroll variant. X's own markup
  labels it `data-interaction="app-store-obstruction"`, which is the hook
  used to hide it instantly and remove it.
- **Poisoned tweet links**: on mobile, post links point at
  `m.x.com/...?launch_app_store=true&ct=...`, so tapping a tweet bounces you
  into the app / app store instead of opening the post. The extension
  rewrites these back to plain `x.com` URLs (in the DOM, plus a
  capture-phase click guard for links poisoned at tap time).

**Legacy React app** (still served when logged in and in some buckets):

- `sheetDialog` sign-up / open-the-app sheets (closed via their close button,
  or removed outright for the non-dismissible variant).
- The "Don't miss what's happening" bottom bar.
- The Google one-tap iframe popup.

## What it deliberately does NOT block

If **you** click a login/sign-up control ("Log in", "Sign up",
"Continue with Google", …), the resulting dialog or page is left alone —
otherwise logging in would become impossible. The extension tracks your last
real click and only dismisses dialogs that appear spontaneously or in
response to clicks on unrelated things (a post, Like, Follow, …).

Intent detection matches English labels plus login/signup URLs; on a
non-English UI a deliberately opened login *dialog* may still get dismissed
in rare cases — you can always log in via `x.com/i/flow/login` directly.

## Cookie banner (EU/UK only)

The consent banner is geo-gated, so it cannot be reproduced from a US-based
test runner — it is handled defensively rather than against captured markup:
any container mentioning cookies gets its "Refuse non-essential cookies" /
"Reject" / "Only necessary" control clicked (which persists the choice), and
if no such control is recognised the banner is removed so it at least stops
covering the page. Critically, an un-dismissed banner can no longer block
scroll healing — that single bug (scroll repair bailed out whenever *any*
`[role="dialog"]` was present) made the extension useless on mobile in the
EU, since the banner is a dialog.

## Diagnostics from a phone

No console, USB cable or remote debugging needed: append `#xpab-debug` to any
x.com URL in the address bar, e.g. `x.com/exolabs#xpab-debug`. A small badge
appears bottom-left showing counters (dialogs / nags / links / cookie actions)
and whether scrolling is `UNLOCKED`, plus a **COPY REPORT** button that copies
a JSON dump — page URL, user agent, computed overflow state, and the markup of
every overlay still on screen — so an unhandled popup can be reported exactly.
(`localStorage.setItem('xpab-debug','1')` does the same persistently.)

## Install

### Chrome / Chromium / Edge (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.

(For the Chrome Web Store you'd upload the zip from `npm run build`.)

### Firefox (desktop)

Temporary (for testing): `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on…** → pick `extension/manifest.json`.

Permanent installs need a signed build. `npm run sign` submits the
extension to [addons.mozilla.org](https://addons.mozilla.org/developers/) as
an unlisted ("self-distribution") add-on and saves the signed `.xpi` in
`dist/` (free, no public listing; needs AMO API credentials in
`WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`). Install it via `about:addons` →
⚙ → **Install Add-on From File…**. The manifest already carries the required `browser_specific_settings`
(including `data_collection_permissions: none`) and passes `web-ext lint`
with zero warnings.

### Firefox for Android

Firefox for Android only installs signed add-ons, so:

- **Easiest**: publish on addons.mozilla.org (see above) and install it from
  AMO on your phone — Android Firefox supports the open add-on ecosystem.
- **For development**: connect the phone via USB debugging and run
  `npx web-ext run --target firefox-android --source-dir extension
  --android-device <device-id>`.

## Development

```sh
npm install
npm run lint     # web-ext lint (Firefox/AMO validation)
npm run build    # dist/*.zip for store submission
npm run icons    # regenerate icons/ from the inline SVG
npm test         # end-to-end test against the real x.com (see below)
```

### How the e2e test works

`test/e2e.mjs` launches the pre-installed Chromium via Playwright with the
extension loaded (persistent context + `--load-extension`, new headless mode)
and drives the real, logged-out x.com. It asserts that:

1. the content wall and QR popup are removed and the page scrolls;
2. a spontaneously appearing login dialog is dismissed and the
   `overflow: hidden` scroll-lock is lifted (the exact case that breaks
   element-hiding filters);
3. dialogs opened by a genuine click on a "Log in" control survive, while
   dialogs hijacking other clicks are dismissed, and the real login page
   stays reachable;
4. mobile (Android UA emulation): the "Get the full app experience"
   obstruction modal is removed (on load and after scrolling), the page
   scrolls, no `launch_app_store` / `m.x.com` poisoned links remain, and
   tapping a tweet opens the post on x.com instead of the app store.

`npm run test:synthetic` additionally runs `test/fixture.mjs` — a synthetic
x.com-shaped page reproducing the failure modes the live site won't show a US
test runner: the EU cookie banner, a scroll lock applied by utility *class*,
the `position: fixed` body lock, an SPA that re-applies the lock every 700 ms,
and a tweet link whose own `onclick` navigates to the app store. It runs in
**both Chromium and Firefox** (Gecko matters: the phone runs Firefox, and only
Chromium had ever been tested). Playwright cannot install extensions into
Firefox, so there the content script and stylesheet are injected at
`document_start`; the packaging itself is validated by `web-ext lint`.

Screenshots and DOM dumps land in `test/artifacts/`.

Sandbox note: this repo was developed in a VM whose egress proxy resets
Chromium's TLS ClientHello. `test/lib.mjs` therefore routes every browser
request through Playwright's Node-side `route.fetch()`, which negotiates TLS
like curl does. On a normal machine that interception is harmless (and could
be removed).

### Selector notes (for future breakage)

The logged-out page is a server-rendered app (internally "jetfuel": Tailwind
utility classes, Base UI dialogs, **no** `data-testid` attributes, no
`#react-root`). Current hooks, verified 2026-08:

- content wall: `aside.fixed.bottom-0` (contains the gradient + "Continue to X");
- QR popup: `button.fixed[class~="z-1000"]` containing an `<img>`;
- login modal: portal `div[role="dialog"]` (e.g. `aria-label="Log in to X"`),
  scroll-locked via inline `overflow: hidden` on `<body>`; a trusted `Escape`
  keydown closes it and X restores the scroll-lock itself — DOM removal +
  manual unlock is the fallback;
- mobile app nag: `div[role="dialog"][data-interaction="app-store-obstruction"]`
  (backdrop and panel carry `…-backdrop` / `…-panel`), removed directly since
  the wrapper contains its own backdrop;
- engagement modal: `div[data-engagement-modal]` (no `role="dialog"`),
  shown by X's click handler on posts; posts are `div[role="link"][data-href]`
  cards whose date is an `a[href*="/status/"]`;
- sidebar login box: the `aside section` holding the
  `/onboarding/…?mode=signup` link;
- poisoned mobile links: `a[href*="launch_app_store"]` and `https://m.x.com/…`
  hrefs, rewritten to `x.com` with `launch_app_store` / `ct` params stripped.

The legacy React app keeps the old `data-testid` hooks
(`sheetDialog`, `BottomBar`, `app-bar-close`, `#layers`, …).

### Why link de-poisoning is also a network rule

Rewriting `href`s (on scan, and in a capture-phase handler on
`touchstart`/`pointerdown`/`mousedown`/`click`) is not sufficient on its own:
the page's own `onclick` can navigate using a URL the handler already holds.
`rules.json` therefore also strips the redirect at the network layer via
`declarativeNetRequest` — `m.x.com` → `x.com` and `launch_app_store`/`ct`/`mx`
params removed on main-frame navigations — which works no matter how the
navigation was started.
