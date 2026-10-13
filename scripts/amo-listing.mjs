// Uploads the addons.mozilla.org listing assets that `web-ext sign` can't:
// the listing icon and, if amo/screenshots.json exists, the screenshots
// (replacing any already on the listing). Text fields such as the summary and
// description go up with the version via `npm run sign:listed`.
//
// Needs the same WEB_EXT_API_KEY / WEB_EXT_API_SECRET as `web-ext sign`.
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ICON = 'extension/icons/icon-128.png';
const MANIFEST = 'extension/manifest.json';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const api = 'https://addons.mozilla.org/api/v5/addons';

function jwt() {
  const { WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret } = process.env;
  if (!issuer || !secret) throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET');
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

async function request(method, url, body) {
  const headers = { Authorization: `JWT ${jwt()}` };
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
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

const addon = await request('PATCH', addonUrl, await imageForm('icon', ICON));
console.log(`Uploaded icon: ${addon.icon_url}`);

const screenshotsFile = path.join(root, 'amo', 'screenshots.json');
if (existsSync(screenshotsFile)) {
  for (const preview of addon.previews) {
    await request('DELETE', `${addonUrl}previews/${preview.id}/`);
  }
  for (const { file, caption } of JSON.parse(await readFile(screenshotsFile, 'utf8'))) {
    const preview = await request('POST', `${addonUrl}previews/`, await imageForm('image', path.join('amo', file)));
    await request('PATCH', `${addonUrl}previews/${preview.id}/`, { caption: { [addon.default_locale]: caption } });
    console.log(`Uploaded screenshot: ${file}`);
  }
}

console.log(`Listing: ${addon.url}`);
