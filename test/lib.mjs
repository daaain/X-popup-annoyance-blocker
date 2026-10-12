// Shared helpers for testing against real x.com from inside the sandbox VM.
//
// The sandbox egress resets Chromium's TLS ClientHello (curl/openssl/Node get
// through fine), so the browser can't fetch x.com directly. Workaround: route
// every request through Playwright's Node-side fetch (route.fetch), which
// negotiates TLS the same way curl does and trusts the proxy CA via
// NODE_EXTRA_CA_CERTS. The browser itself never talks to the network.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ARTIFACTS = path.join(ROOT, 'test', 'artifacts');
export const EXTENSION_DIR = path.join(ROOT, 'extension');

const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

export async function launch({ withExtension = false, mobile = false, userDataDir } = {}) {
  await mkdir(ARTIFACTS, { recursive: true });
  const args = ['--disable-blink-features=AutomationControlled'];
  if (withExtension) {
    args.push(
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`
    );
  }
  const context = await chromium.launchPersistentContext(
    userDataDir ?? path.join(ARTIFACTS, `profile-${withExtension ? 'ext' : 'bare'}-${Date.now()}`),
    {
      args,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
      headless: true,
      viewport: mobile ? { width: 412, height: 915 } : { width: 1280, height: 900 },
      userAgent: mobile ? MOBILE_UA : DESKTOP_UA,
      isMobile: mobile,
      hasTouch: mobile,
      serviceWorkers: 'block',
      ignoreHTTPSErrors: true,
    }
  );

  // Fulfil every request via Node-side fetch (see header comment).
  await context.route('**/*', async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  });

  return context;
}
