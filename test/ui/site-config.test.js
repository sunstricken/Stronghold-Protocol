import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSiteConfig, publicLink } from '../../public/js/siteConfigModel.js';

test('public links reject executable schemes, credentials, relative URLs and malformed contacts', () => {
  for (const link of ['javascript:alert(1)', 'data:text/html,test', '/server', 'https://user:pass@example.com/', 'https://example.com/\npath', null]) {
    assert.equal(publicLink(link), null, String(link));
  }
  assert.equal(publicLink('https://wei.linxia.dev/'), 'https://wei.linxia.dev/');
  assert.equal(publicLink('http://47.101.63.122/'), 'http://47.101.63.122/');
  assert.equal(publicLink('mailto:strickensun@qq.com'), null);
  assert.equal(publicLink('mailto:strickensun@qq.com', true), 'mailto:strickensun@qq.com');
  assert.equal(publicLink('mailto:strickensun@qq.com?body=test', true), null);
});

test('curation preserves administrator order and descriptions while omitting disabled and duplicate servers', () => {
  const result = normalizeSiteConfig({ currentServerName: ' sunstricken ', showOnFirstVisit: false,
    contacts: [{ label: 'Email', url: 'mailto:strickensun@qq.com' }, { label: 'bad', url: 'javascript:test' }],
    servers: [null, { name: 'A', url: 'https://a.example/', maintainer: 'Owner', description: 'Notes' },
      { name: 'Duplicate', url: 'https://a.example/other' }, { name: 'Disabled', url: 'https://b.example/', enabled: false },
      { name: 'C', url: 'https://c.example/' }, { name: '', url: 'https://d.example/' }] });
  assert.equal(result.currentServerName, 'sunstricken');
  assert.equal(result.showOnFirstVisit, false);
  assert.deepEqual(result.contacts, [{ label: 'Email', url: 'mailto:strickensun@qq.com' }]);
  assert.deepEqual(result.servers.map((server) => server.name), ['A', 'C']);
  assert.equal(result.servers[0].maintainer, 'Owner');
  assert.equal(result.servers[0].description, 'Notes');
  for (const raw of [null, [], 'bad']) assert.deepEqual(normalizeSiteConfig(raw).servers, []);
});
