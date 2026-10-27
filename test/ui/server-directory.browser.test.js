// SP_E2E=1 CHROME_PATH=<Chrome executable> node --test test/ui/server-directory.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome, OUT } from '../e2e/client.mjs';

test('title directory dismisses, remembers visits, uses independent links and disappears in rooms and matches', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60_000,
}, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, studio: false, assetIndex: false,
    versions: { enabled: ['act2autochess'] } });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [], external = [];
  let configFailure = false;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (!request.url().startsWith(srv.url)) { external.push(request.url()); return request.abort(); }
    if (request.url() === `${srv.url}/site-config.json` && configFailure) return request.respond({ status: 503, contentType: 'application/json', body: '{}' });
    if (request.isNavigationRequest() && request.url() === `${srv.url}/`) return request.respond({ contentType: 'text/html', body:
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/title.css"><link rel="stylesheet" href="/css/devices.css"></head><body><div id="app"></div></body></html>' });
    return request.continue();
  });
  const mount = async () => page.evaluate(async () => {
    const { render } = await import('/vendor/preact.module.js');
    const { html } = await import('/js/ui/components.js');
    const { TitleScreen } = await import('/js/screens/title.js');
    const { store } = await import('/js/store.js');
    store.reset();
    render(html`<${TitleScreen}/>`, document.getElementById('app'));
    globalThis.directoryTest = { store };
  });
  await page.goto(srv.url, { waitUntil: 'networkidle0' });
  await mount();
  await page.waitForSelector('.server-directory', { visible: true });
  assert.deepEqual(await page.$$eval('[data-testid="server-visit"]', (links) => links.map((link) => [link.href, link.target, link.rel])), [
    ['https://wei.linxia.dev/', '_blank', 'noopener noreferrer'], ['https://game.xiaolubao.com/', '_blank', 'noopener noreferrer'],
  ]);
  assert.match(await page.$eval('[data-testid="server-current"]', (node) => node.textContent), /当前服务器/);
  assert.equal(await page.$eval('.title-repo[href*="/issues"]', (link) => link.href), 'https://github.com/sunstricken/Stronghold-Protocol/issues');
  assert.equal(await page.$eval('.title-repo[href="https://github.com/sunstricken/Stronghold-Protocol"]', (link) => link.textContent), '项目仓库');
  assert.equal(await page.$eval('.title-repo[href="https://github.com/sganggs/Stronghold-Protocol"]', (link) => link.textContent), '原项目来源');
  assert.ok(await page.$('a[href="mailto:strickensun@qq.com"]'));
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() => document.querySelector('.server-directory').closest('.modal')
    .getAnimations({ subtree: true }).every((animation) => animation.playState === 'finished'));
  await page.screenshot({ path: path.join(OUT, 'server-directory-desktop.png') });
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewport(viewport);
    assert.equal(await page.$eval('.server-directory', (node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1;
    }), true, `modal fits ${viewport.width}x${viewport.height}`);
  }
  await page.screenshot({ path: path.join(OUT, 'server-directory-mobile.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.server-directory', { hidden: true });
  assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.server-directory-seen')), 'true');
  await page.reload({ waitUntil: 'networkidle0' }); await mount();
  await page.waitForSelector('[data-testid="servers-open"]');
  assert.equal(await page.$('.server-directory'), null, 'does not reopen after reload');
  await page.click('[data-testid="servers-open"]');
  await page.waitForSelector('.server-directory', { visible: true });
  await page.click('[data-testid="servers-continue"]');
  await page.waitForSelector('.server-directory', { hidden: true });
  await page.click('[data-testid="servers-open"]');
  await page.waitForSelector('.server-directory', { visible: true });
  for (const state of [
    { session: { entered: true }, room: null, match: { public: null } },
    { session: { entered: true }, room: { id: 'room' } },
    { session: { entered: true }, room: { inMatch: true }, match: { public: { phase: 'PREP' } } },
    { session: { entered: false }, room: { id: 'recovering-room' } },
  ]) {
    await page.evaluate((state) => globalThis.directoryTest.store.set(state), state);
    await page.waitForSelector('[data-testid="servers-open"]', { hidden: true });
    assert.equal(await page.$('.server-directory'), null);
  }
  await page.evaluate(() => globalThis.directoryTest.store.reset());
  await page.waitForSelector('[data-testid="servers-open"]');
  configFailure = true;
  await page.evaluate(async () => (await import('/js/siteConfig.js')).loadSiteConfig({ force: true }));
  await page.click('[data-testid="servers-open"]');
  await page.waitForSelector('[data-testid="servers-retry"]');
  configFailure = false;
  await page.click('[data-testid="servers-retry"]');
  await page.waitForSelector('[data-testid="servers-retry"]', { hidden: true });
  assert.equal((await page.$$('[data-testid="server-visit"]')).length, 2);
  await page.click('[data-testid="servers-continue"]');
  await page.waitForSelector('.server-directory', { hidden: true });
  configFailure = true;
  await page.evaluate(async () => (await import('/js/siteConfig.js')).loadSiteConfig({ force: true }));
  await page.type('.title-login input', 'Tester');
  await page.waitForFunction(() => !document.querySelector('.title-login .btn--primary').disabled);
  await page.click('.title-login .btn--primary');
  assert.equal(await page.evaluate(() => globalThis.directoryTest.store.get().session.entered), true, 'a config failure never blocks entering the game');
  await page.waitForSelector('[data-testid="servers-open"]', { hidden: true });
  assert.deepEqual(external, [], 'no requests to other servers or external probes');
  assert.deepEqual(errors, []);
});
