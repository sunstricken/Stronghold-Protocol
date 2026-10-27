// JSON through the real UI: merge v1 skins, export v2, re-import, reload and retain older-file compatibility.
// SP_E2E=1 CHROME_PATH=... node --test test/ui/loadout-skins.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, startRealServer } from '../e2e/client.mjs';

const TEXAS = 'char_102_texas';
const SURTR = 'char_350_surtr';
const INSIDE = 'chess_char_1_01_a';
const io = '[data-testid="loadout-io-text"]';

describe('loadout skin JSON in the browser', {
  skip: !(process.env.SP_E2E === '1' && hasChrome()) && 'set SP_E2E=1 and CHROME_PATH',
}, () => {
  let srv, P;
  before(async () => { srv = await startRealServer(); P = (await import('puppeteer-core')).default; });
  after(async () => { await srv?.stop(); });

  for (const view of ['list', 'deck']) {
    test(`${view}: skin-only export, v1 merge, v2 round trip and persistence`, { timeout: 90000 }, async () => {
      const c = new Client(P, srv.base, `skins-${view}`, { prefix: 'loadout-skins', w: 1280, h: 800 });
      const menu = async () => {
        if (view === 'deck') await c.click('[data-testid="loadout-more"]');
      };
      const saved = () => c.page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.skins') || '{}'));
      const open = async () => {
        await c.click('.lobby-screen [data-testid="loadout-open"]');
        await c.page.waitForSelector('.lo-card, .lo-op');
      };
      const importJSON = async (payload) => {
        await menu();
        await c.click('[data-testid="loadout-import"]');
        await c.page.waitForSelector(io);
        await c.click(io);
        await c.page.keyboard.type(JSON.stringify(payload));
        await c.click('[data-testid="loadout-io-apply"]');
        await c.page.waitForSelector(io, { hidden: true });
      };
      const exportJSON = async () => {
        await menu();
        assert.equal(await c.page.$eval('[data-testid="loadout-export"]', (e) => e.disabled), false);
        await c.click('[data-testid="loadout-export"]');
        await c.page.waitForSelector(io);
        const payload = JSON.parse(await c.page.$eval(io, (e) => e.value));
        await c.page.keyboard.press('Escape');
        await c.page.waitForSelector(io, { hidden: true });
        return payload;
      };
      try {
        await c.open();
        await c.click('[data-testid="servers-continue"]', null, { optional: true, timeout: 5000 });
        await c.enter('皮肤导入回归');
        await open();
        if (view === 'deck') await c.click('[data-testid="loadout-view-deck"]');
        await importJSON({ kind: 'stronghold.loadout', v: 1, cosmetics: { [TEXAS]: `${TEXAS}@winter#1`, [SURTR]: `${SURTR}@summer#1` } });
        const skinOnly = await exportJSON();
        assert.equal(skinOnly.v, 2);
        assert.equal(skinOnly.count, 0);
        assert.deepEqual(skinOnly.byChar, {});
        assert.deepEqual(skinOnly.ops, {});
        assert.deepEqual(skinOnly.cosmetics, await saved());
        await importJSON({ kind: 'stronghold.loadout', v: 1, entries: { [INSIDE]: { skill: 0 } }, cosmetics: { [TEXAS]: `${TEXAS}@new#1` } });
        const expected = { [TEXAS]: `${TEXAS}@new#1`, [SURTR]: `${SURTR}@summer#1` };
        assert.deepEqual(await saved(), expected, 'unlisted operator retained');
        const combined = await exportJSON();
        assert.equal(combined.count, 1);
        assert.deepEqual(combined.cosmetics, expected);
        await importJSON(combined);
        assert.deepEqual(await saved(), expected);
        await importJSON({ v: 1, entries: { [INSIDE]: { skill: 0 } } });
        assert.deepEqual(await saved(), expected, 'old JSON leaves skins alone');
        await c.page.reload({ waitUntil: 'domcontentloaded' });
        await c.page.waitForSelector('.lobby-screen');
        assert.deepEqual(await saved(), expected, 'choices persist after reload');
        await open();
        assert.deepEqual((await exportJSON()).cosmetics, expected);
        assert.deepEqual(c.problems.filter((p) => p.startsWith('pageerror:')), []);
      } catch (err) {
        console.error(JSON.stringify({ problems: c.problems, text: await c.page.evaluate(() => document.body.innerText) }));
        await c.shot(`${view}-failure`);
        throw err;
      } finally { await c.close(); }
    });
  }
});
