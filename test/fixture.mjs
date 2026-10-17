// A synthetic x.com-shaped page reproducing the failure modes that cannot be
// triggered from this test runner: the EU-only cookie banner, scroll locks
// applied via utility class and via position:fixed, the app-store obstruction
// modal, tweet links whose own onclick navigates to the app store, and the
// logged-out engagement modal X shows instead of opening a clicked post, and
// X's in-page navigation to a profile, which fails when logged out, and a
// photo whose "View media" link leads to a page that is just the post again.
export const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; font:16px system-ui; }
  .tall { height: 4000px; padding: 60px 16px; }
  /* utility-class scroll lock, as shipped by X's current CSS */
  .overflow-hidden { overflow: hidden !important; }
  .touch-none { touch-action: none !important; }
  #cookie { position: fixed; inset-inline: 0; bottom: 0; z-index: 60; background: #fff;
            border-top: 1px solid #ccc; padding: 16px; }
  #obstruction { position: fixed; inset: 0; z-index: 50; display: flex;
                 align-items: center; justify-content: center; background: rgba(0,0,0,.5); }
  #obstruction .panel { background: #fff; padding: 32px; border-radius: 8px; }
  [data-engagement-modal] { position: fixed; inset: 0; z-index: 50; display: flex;
                            align-items: center; justify-content: center; background: rgba(0,0,0,.4); }
</style></head>
<body>
  <div class="tall">
    <h1>Fixture timeline</h1>
    <a id="tweet" href="https://m.x.com/exolabs/status/123?launch_app_store=true&ct=engagement_view_post">A tweet</a>
    <p id="marker">scroll me</p>
    <div id="carousel" style="height:120px;overflow-x:auto">swipe me</div>
    <!-- The right-hand column's "Log in or sign up for X" box. -->
    <aside>
      <section id="login-box">
        <h2>Log in or sign up for X</h2>
        <a href="/i/jf/onboarding/web?mode=signup&amp;redirect_after_login=%2Ffixture">Continue with phone</a>
      </section>
      <section id="relevant-people"><h2>Relevant people</h2></section>
    </aside>
    <!-- A reply, as on the logged-out post page: the whole card is a link. -->
    <div id="reply" role="link" tabindex="0" data-href="/someone/status/456">
      <a id="reply-author" href="/someone">Someone</a>
      <a id="reply-date" href="/someone/status/456">27 Sept</a>
      <p id="reply-body">A reply worth reading</p>
      <button id="reply-like" type="button" aria-label="Like">Like</button>
    </div>
    <!-- A photo in a post, as X marks it up: an inert image with an empty
         link laid over it. -->
    <div id="photo" style="position:relative;width:300px;height:150px">
      <div inert style="width:100%;height:100%">
        <img id="photo-thumb" alt="A chart" style="width:100%;height:100%"
             src="https://pbs.twimg.com/media/FIXTURE?format=webp&amp;name=small">
      </div>
      <a id="photo-link" aria-label="View media" style="position:absolute;inset:0;z-index:10"
         href="/someone/status/789/photo/1"></a>
    </div>
    <!-- A post with several photos: a carousel of the same cells. X also
         renders some posts twice; the hidden copy must not add photos. -->
    <div id="multi" style="display:flex;gap:4px;overflow-x:auto">
      <div style="position:relative;width:120px;height:90px;flex:none">
        <div inert style="width:100%;height:100%"><img alt="Photo 1" style="width:100%;height:100%"
             src="https://pbs.twimg.com/media/MULTI1?format=webp&amp;name=small"></div>
        <a id="multi-1" aria-label="View media" style="position:absolute;inset:0;z-index:10"
           href="/someone/status/790/photo/1"></a>
      </div>
      <div style="position:relative;width:120px;height:90px;flex:none">
        <div inert style="width:100%;height:100%"><img alt="Photo 2" style="width:100%;height:100%"
             src="https://pbs.twimg.com/media/MULTI2?format=webp&amp;name=small"></div>
        <a id="multi-2" aria-label="View media" style="position:absolute;inset:0;z-index:10"
           href="/someone/status/790/photo/2"></a>
      </div>
      <div style="position:relative;width:120px;height:90px;flex:none">
        <div inert style="width:100%;height:100%"><img alt="Photo 3" style="width:100%;height:100%"
             src="https://pbs.twimg.com/media/MULTI3?format=webp&amp;name=small"></div>
        <a id="multi-3" aria-label="View media" style="position:absolute;inset:0;z-index:10"
           href="/someone/status/790/photo/3"></a>
      </div>
    </div>
    <div hidden>
      <div><div inert><img src="https://pbs.twimg.com/media/MULTI2?format=webp&amp;name=small"></div>
        <a aria-label="View media" href="/someone/status/790/photo/2"></a></div>
    </div>
  </div>

  <!-- EU cookie banner (not a dialog; a fixed bottom sheet) -->
  <div id="cookie">
    <p>We and our partners use cookies on this site.</p>
    <button id="refuse">Refuse non-essential cookies</button>
    <button id="accept">Accept all cookies</button>
  </div>

<script>
  window.__fixture = { refuseClicked: false, appNavigations: [], engagementModals: 0, inPageNavigations: 0 };

  // X navigates to profiles inside the page; logged out, the profile's
  // timeline then fails to load ("Something went wrong").
  document.addEventListener('click', (e) => {
    const link = e.target.closest('#reply-author');
    if (!link) return;
    e.preventDefault();
    history.pushState({}, '', link.getAttribute('href'));
    document.body.textContent = 'Something went wrong';
    window.__fixture.inPageNavigations++;
  });

  // Logged out, X cancels clicks on a post (its date, body or buttons) and
  // shows an engagement modal instead. Profile links still work.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#reply') || e.target.closest('#reply-author')) return;
    e.preventDefault();
    const modal = document.createElement('div');
    modal.setAttribute('data-engagement-modal', 'true');
    modal.innerHTML = '<div class="panel"><button type="button" aria-label="Close">x</button>' +
      "<h2>Don't miss what's happening</h2><p>People on X are the first to know.</p>" +
      '<a href="/i/jf/onboarding/web?mode=login">Log in</a></div>';
    modal.querySelector('button').addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
    window.__fixture.engagementModals++;
  });

  // X's own onclick navigation — beats a naive href rewrite.
  document.getElementById('tweet').addEventListener('click', (e) => {
    e.preventDefault();
    const href = e.currentTarget.getAttribute('href');
    window.__fixture.appNavigations.push(href);
  });

  document.getElementById('refuse').addEventListener('click', () => {
    window.__fixture.refuseClicked = true;
    document.getElementById('cookie').remove();
  });

  // Lock scrolling with a utility CLASS (not an inline style) — the variant
  // that the old observer never even noticed.
  setTimeout(() => {
    document.documentElement.classList.add('overflow-hidden');
    document.body.classList.add('overflow-hidden', 'touch-none');
  }, 300);

  // Then pile on the position:fixed lock technique too.
  setTimeout(() => {
    document.body.style.position = 'fixed';
    document.body.style.top = '-500px';
    document.body.style.width = '100%';
  }, 900);

  // The app-store obstruction, after a delay and with no close button.
  setTimeout(() => {
    const d = document.createElement('div');
    d.id = 'obstruction';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('data-interaction', 'app-store-obstruction');
    d.innerHTML = '<div class="panel" data-interaction="app-store-obstruction-panel">' +
      '<p>Get the full app experience</p>' +
      '<a href="https://m.x.com/exolabs?launch_app_store=true&ct=profile-modal">Open X</a></div>';
    document.body.appendChild(d);
    document.documentElement.classList.add('overflow-hidden');
    // X's modal also locks scrolling in JS, exactly like this (from its
    // modal-*.js bundle). Touch and wheel scrolling stay blocked while the
    // modal component is mounted, whatever the CSS says.
    const block = (e) => e.preventDefault();
    document.addEventListener('touchmove', block, { capture: true, passive: false });
    document.addEventListener('wheel', block, { capture: true, passive: false });
  }, 1500);

  // An element (like a media carousel) that cancels scrolling for its own
  // gestures. While the page is unlocked, its handlers don't run either.
  for (const type of ['touchmove', 'wheel']) {
    document.getElementById('carousel').addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // Keep re-applying the lock, the way a re-rendering SPA does.
  setInterval(() => {
    document.documentElement.classList.add('overflow-hidden');
  }, 700);
</script>
</body></html>`;
