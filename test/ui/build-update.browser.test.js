// SP_E2E=1 CHROME_PATH=<system Chrome> node --test test/ui/build-update.browser.test.js
// Exercise the production notice, guard and banner in a real browser without the game's unrelated art/renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome, OUT } from '../e2e/client.mjs';

test('update notice dismisses without navigation, stays dismissed, blocks mid-match updates, and reloads only on click', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 40_000,
}, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, studio: false, assetIndex: false,
    versions: { enabled: ['act2autochess'] } });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--disable-gpu'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.setRequestInterception(true);
  page.on('request', request => request.isNavigationRequest() && request.url() === `${srv.url}/`
    ? request.respond({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/devices.css"></head><body><div id="app"></div></body></html>' })
    : request.continue());
  await page.goto(srv.url, { waitUntil: 'networkidle0' });
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async () => {
    const { render } = await import('/vendor/preact.module.js');
    const { html } = await import('/js/ui/components.js');
    const { store } = await import('/js/store.js');
    const { BuildUpdateNotice, showBuildUpdate } = await import('/js/ui/buildUpdate.js');
    const { ConnectionBanner } = await import('/js/ui/connBanner.js');
    const { startBuildGuard } = await import('/js/ui/buildGuard.js');
    store.set({ session: { entered: true }, connection: { status: 'online', everOnline: true } });
    render(html`<${BuildUpdateNotice}/><${ConnectionBanner}/>`, document.getElementById('app'));
    const state = { build: 'aaa' };
    const guard = startBuildGuard({
      known: 'aaa', fetchFn: async () => ({ ok: true, json: async () => ({ build: state.build }) }),
      setInterval: () => 1, clearInterval() {},
      onStale: () => store.patch('ui', { buildStale: true, buildNoticeOpen: true }),
      onCurrent: () => store.patch('ui', { buildStale: false, buildNoticeOpen: false }),
    });
    globalThis.updateTest = { store, state, guard, showBuildUpdate };
  });
  await page.evaluate(async () => {
    const { guard, state } = globalThis.updateTest;
    await new Promise(resolve => setTimeout(resolve, 0));
    state.build = 'bbb';
    await guard.check(); await guard.check();
  });
  await page.waitForSelector('.build-update', { visible: true });
  await page.click('[data-testid="build-update-later"]');
  await page.waitForSelector('.build-update', { hidden: true });
  await page.evaluate(async () => { await globalThis.updateTest.guard.check(); await globalThis.updateTest.guard.check(); });
  assert.equal(await page.$('.build-update'), null);
  await page.click('.conn-banner button');
  await page.waitForSelector('.build-update', { visible: true });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.build-update', { hidden: true });
  await page.evaluate(() => {
    globalThis.updateTest.store.set({ room: { inMatch: true }, match: { public: { phase: 'PREP' }, result: null } });
    globalThis.updateTest.showBuildUpdate();
  });
  await page.waitForFunction(() => document.querySelector('[data-testid="build-update-now"]')?.disabled === true);
  await page.click('[data-testid="build-update-now"]');
  assert.equal(navigations, 0, 'neither dismissal nor a disabled update navigates');
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'build-update.png') });
  await page.evaluate(() => globalThis.updateTest.store.set({ match: { public: { phase: 'SETTLE' }, result: {} } }));
  await page.waitForFunction(() => document.querySelector('[data-testid="build-update-now"]')?.disabled === false);
  assert.equal(navigations, 0, 'settlement does not refresh automatically');
  await Promise.all([page.waitForNavigation(), page.click('[data-testid="build-update-now"]')]);
  assert.equal(navigations, 1);
  assert.deepEqual(errors, []);
});
