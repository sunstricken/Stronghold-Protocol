// GitHub #693: a submitted issue must carry the version the reporter is on. The shields.io badge
// is not that field. This fork directs feedback to its own tracker without requiring an upstream release badge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['BugReport.yml', 'FeatureRequest.yml'];

function versionBlock(src) {
  const parts = src.split(/\n  - type: /).slice(1);
  return parts.find((b) => b.startsWith('input\n') && b.includes('label: 版本号')) || '';
}

for (const file of FILES) {
  test(`${file}: required 版本号 and feedback owned by the maintained fork`, () => {
    const src = readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${file}`, import.meta.url), 'utf8');
    const field = versionBlock(src);
    assert.match(field, /^input\n/);
    assert.match(field, /\n    id: version\n/);
    assert.match(field, /\n      label: 版本号\n/);
    assert.match(field, /标题画面角落/);
    assert.match(field, /发布压缩包的文件名/);
    assert.match(field, /git rev-parse --short HEAD/);
    assert.match(field, /只作对照/);
    assert.match(field, /\n    validations:\n      required: true$/);
    assert.doesNotMatch(field, /shields\.io/);
    assert.match(src, /github\.com\/sunstricken\/Stronghold-Protocol\/issues/);
    assert.doesNotMatch(src, /github\.com\/sganggs\/Stronghold-Protocol\/issues|shields\.io\/github\/v\/release\/sganggs/);
  });
}
