// Updates the addons.mozilla.org listing without uploading a new version: the
// text from amo/metadata.json (summary, description, links, …), the listing
// icon and, if amo/screenshots.json exists, the screenshots (replacing any
// already on the listing). `npm run sign:listed` sends the same text along
// with each new version, but can't upload the icon or screenshots.
//
// Needs the same WEB_EXT_API_KEY / WEB_EXT_API_SECRET as `web-ext sign`.
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ICON = 'extension/icons/icon-128.png';
const MANIFEST = 'extension/manifest.json';

// AMO answers 429 with how long to wait. Short waits are retried a few times;
// longer ones mean an hourly or daily limit, which every retry (and every
// upload on the website) uses up further, so stop and say when to try again.
const MAX_THROTTLE_WAIT_SECONDS = 120;
const MAX_THROTTLE_RETRIES = 3;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const api = process.env.AMO_API_URL ?? 'https://addons.mozilla.org/api/v5/addons';

function jwt() {
  const { WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret } = process.env;
  if (!issuer || !secret) throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET');
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

async function request(method, url, body, retries = 0) {
  const headers = { Authorization: `JWT ${jwt()}` };
  const json = body && !(body instanceof FormData);
  if (json) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: json ? JSON.stringify(body) : body });
  const text = await response.text();
  if (response.status === 429) {
    const seconds = Number(text.match(/available in (\d+) seconds/)?.[1]);
    if (!(seconds <= MAX_THROTTLE_WAIT_SECONDS) || retries >= MAX_THROTTLE_RETRIES) {
      const minutes = Math.ceil(seconds / 60);
      const wait = minutes >= 90 ? `${Math.round(minutes / 60)} hours` : minutes > 1 ? `${minutes} minutes` : 'a minute';
      const when = seconds ? ` Try again in about ${wait}.` : '';
      throw new Error(`AMO is throttling requests, so stopping here.${when} It's safe to run this again then: it replaces what's already uploaded.`);
    }
    console.log(`Throttled by AMO, retrying in ${seconds}s`);
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    return request(method, url, body, retries + 1);
  }
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function imageForm(field, file) {
  const form = new FormData();
  form.append(field, new Blob([await readFile(path.join(root, file))], { type: 'image/png' }), path.basename(file));
  return form;
}

const manifest = JSON.parse(await readFile(path.join(root, MANIFEST), 'utf8'));
const addonUrl = `${api}/addon/${encodeURIComponent(manifest.browser_specific_settings.gecko.id)}/`;

const { version, ...listing } = JSON.parse(await readFile(path.join(root, 'amo', 'metadata.json'), 'utf8'));
await request('PATCH', addonUrl, listing);
console.log('Updated listing text');

const addon = await request('PATCH', addonUrl, await imageForm('icon', ICON));
console.log(`Uploaded icon: ${addon.icon_url}`);

const screenshotsFile = path.join(root, 'amo', 'screenshots.json');
if (existsSync(screenshotsFile)) {
  // Read every image before touching the listing, and only remove the old
  // screenshots once all the new ones are up, so a failure never leaves the
  // listing without screenshots.
  const screenshots = await Promise.all(
    JSON.parse(await readFile(screenshotsFile, 'utf8')).map(async ({ file, caption }) => ({
      file,
      caption,
      form: await imageForm('image', path.join('amo', file)),
    }))
  );
  for (const { file, caption, form } of screenshots) {
    const preview = await request('POST', `${addonUrl}previews/`, form);
    await request('PATCH', `${addonUrl}previews/${preview.id}/`, { caption: { [addon.default_locale]: caption } });
    console.log(`Uploaded screenshot: ${file}`);
  }
  for (const preview of addon.previews) {
    await request('DELETE', `${addonUrl}previews/${preview.id}/`);
  }
}

console.log(`Listing: ${addon.url}`);
