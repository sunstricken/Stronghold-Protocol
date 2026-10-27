import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKIN_LIMITS, isSkinSelection } from '../../shared/protocol.js';
import { exportPayload, parseImport } from '../../public/js/ui/loadoutModel.js';
import { parseImportedSkins } from '../../public/js/ui/skinModel.js';
import { applySkinImport, skinsStore, setSkins } from '../../public/js/ui/skins.js';
import { applyLoadoutEntries, loadoutStore, setEntries, setOpsMap } from '../../public/js/ui/loadoutSync.js';

const TEXAS = 'char_102_texas';
const SURTR = 'char_350_surtr';
const SKIN = `${TEXAS}@winter#1`;
const CHESS = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const INSIDE = 'chess_char_1_01_a';
const get = (id) => CHESS[id] || null;

test('v2 exports cosmetics beside byChar and ops, without aliasing or changing count', () => {
  const cosmetics = { [TEXAS]: SKIN, [SURTR]: `${SURTR}@summer#1` };
  const payload = exportPayload({ [CHESS[INSIDE].charId]: { skill: 0 } }, { cosmetics, ops: { [TEXAS]: { potential: 2 } } });
  assert.equal(payload.v, 2);
  assert.equal(payload.count, 1);
  assert.deepEqual(payload.cosmetics, cosmetics);
  assert.notEqual(payload.cosmetics, cosmetics);
  const parsed = parseImport(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.cosmetics, cosmetics);
  assert.deepEqual(parsed.ops, payload.ops);
  assert.deepEqual(parsed.byChar, payload.byChar);
  assert.deepEqual(exportPayload({}).cosmetics, {});
});

test('v1 sample and skin-only v1/v2 work; old files omit cosmetics, empty and junk-only fail', () => {
  const cosmetics = { [TEXAS]: SKIN };
  const v1 = parseImport({ kind: 'stronghold.loadout', v: 1, entries: { [INSIDE]: { skill: 0 } }, cosmetics });
  assert.deepEqual(v1.entries, { [INSIDE]: { skill: 0 } });
  assert.deepEqual(v1.cosmetics, cosmetics);
  for (const v of [1, 2]) {
    assert.deepEqual(parseImport({ v, cosmetics }).cosmetics, cosmetics);
    assert.equal(parseImport({ v, cosmetics }).ok, true);
    assert.equal(parseImport({ v, cosmetics: {} }).ok, false);
    assert.equal(parseImport({ v, cosmetics: { [TEXAS]: 'bad skin id' } }).ok, false);
  }
  assert.equal('cosmetics' in parseImport({ v: 1, entries: v1.entries }), false);
  assert.equal('cosmetics' in parseImport({ v: 2, byChar: { [TEXAS]: { skill: 0 } } }), false);
  assert.equal(parseImport({ kind: 'other', v: 2, cosmetics }).ok, false);
  assert.equal(parseImport({ v: 3, cosmetics }).ok, false);
});

test('portable validation rejects hostile keys, wrong ids and types; valid unknown art stays', () => {
  const raw = JSON.parse('{"__proto__":"bad","constructor":"bad","chess_char_1_01_a":"skin","char_102_texas":"char_102_texas@winter#1"}');
  Object.assign(raw, { [SURTR]: 7, char_999_unknown: 'unknown@pack#1+.x-y', char_123_bad: 'bad skin', char_124_null: null });
  const clean = parseImportedSkins(raw);
  assert.deepEqual(clean, { [TEXAS]: SKIN, char_999_unknown: 'unknown@pack#1+.x-y' });
  assert.equal(isSkinSelection(clean), true);
  for (const value of [null, [], 'text', 3]) assert.deepEqual(parseImportedSkins(value), {});
});

test('combined and skin-only imports merge choices; old files and empty cosmetics leave them intact', () => {
  const before = { ...loadoutStore.get() };
  const skinsBefore = skinsStore.get().skins;
  try {
    setSkins({ [SURTR]: `${SURTR}@summer#1`, [TEXAS]: `${TEXAS}@old#1` });
    setEntries({ [INSIDE]: { skill: 0 } }, { lookup: get });
    setOpsMap({ [SURTR]: { potential: 2 } });
    const byCharBefore = loadoutStore.get().byChar;
    const r = applyLoadoutEntries({}, get, { cosmetics: { [TEXAS]: SKIN } });
    assert.deepEqual(r, { applied: 0, dropped: 0, skins: 1 });
    assert.equal(loadoutStore.get().byChar, byCharBefore, 'skin-only import preserves skills');
    assert.deepEqual(loadoutStore.get().ops, { [SURTR]: { potential: 2 } });
    assert.deepEqual(skinsStore.get().skins, { [SURTR]: `${SURTR}@summer#1`, [TEXAS]: SKIN });
    const current = skinsStore.get().skins;
    applyLoadoutEntries({ [INSIDE]: { skill: 0 } }, get);
    applyLoadoutEntries({}, get, { cosmetics: {} });
    assert.equal(skinsStore.get().skins, current, 'absent and empty cosmetics do not reset or notify');
    const combined = applyLoadoutEntries({ [INSIDE]: { skill: 0 } }, get, { cosmetics: { [TEXAS]: `${TEXAS}@winter#2` } });
    assert.deepEqual(combined, { applied: 1, dropped: 0, skins: 1 });
    const invalidBefore = skinsStore.get().skins;
    assert.deepEqual(applySkinImport({ [TEXAS]: 'bad skin' }), { applied: 0, dropped: 1 });
    assert.equal(skinsStore.get().skins, invalidBefore);
  } finally {
    loadoutStore.set(before);
    setEntries(before.entries, { lookup: get });
    setOpsMap(before.ops);
    setSkins(skinsBefore);
  }
});

test('at the skin limit merging preserves existing choices and still overwrites an existing operator', () => {
  const before = skinsStore.get().skins;
  try {
    const full = Object.fromEntries(Array.from({ length: SKIN_LIMITS.entries }, (_, i) => [`char_x_${i}`, `skin_${i}`]));
    setSkins(full);
    assert.deepEqual(applySkinImport({ char_x_new: 'new', char_x_0: 'updated' }), { applied: 1, dropped: 1 });
    assert.deepEqual(skinsStore.get().skins, { ...full, char_x_0: 'updated' });
    assert.equal(isSkinSelection(skinsStore.get().skins), true);
    assert.equal(Object.keys(parseImportedSkins({ ...full, char_x_new: 'new' })).length, SKIN_LIMITS.entries);
  } finally { setSkins(before); }
});
