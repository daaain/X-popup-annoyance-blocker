# X Popup Annoyance Blocker

A tiny browser extension for **Chrome**, **Firefox**, and **Firefox for Android** that
dismisses the popups x.com forces on (mostly logged-out) visitors — the
sign-up / log-in modals and install-the-app nags — and restores page
scrolling afterwards.

Just hiding these popups with an element-hiding filter (e.g. uBlock Origin)
leaves the page broken, because X locks scrolling with `overflow: hidden`
while the popup is "open". This extension dismisses the popups through the
page's own mechanisms where possible and cleans up the scroll-lock itself
where not.

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
- Cookie banners are answered with **"Refuse non-essential cookies"** where
  that button exists, so the choice persists.

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

## Install

### Chrome / Chromium / Edge (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.

(For the Chrome Web Store you'd upload the zip from `npm run build`.)

### Firefox (desktop)

Temporary (for testing): `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on…** → pick `extension/manifest.json`.

Permanent installs need a signed build: run `npm run build` and submit
`dist/*.zip` to [addons.mozilla.org](https://addons.mozilla.org/developers/)
(free, and "self-distribution" signing works if you don't want a public
listing). The manifest already carries the required `browser_specific_settings`
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
   stays reachable.

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
  manual unlock is the fallback.

The legacy React app keeps the old `data-testid` hooks
(`sheetDialog`, `BottomBar`, `app-bar-close`, `#layers`, …).
