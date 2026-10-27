import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeploymentControl, DRAIN_LEASE_MS } from '../server/http/deployment.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const TOKEN = 'a'.repeat(64);

function controlRequest(control, { peer = '127.0.0.1', token = TOKEN, method = 'POST', path = '/_deploy/drain' } = {}) {
  let status, body;
  const handled = control.handle({ method, socket: { remoteAddress: peer },
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '127.0.0.1' } }, {
    setHeader() {}, writeHead(code) { status = code; }, end(bytes) { body = JSON.parse(bytes.toString()); },
  }, path);
  return { handled, status, body };
}

test('deployment control requires a local socket and the exact token; forwarded addresses cannot authorize it', () => {
  const control = createDeploymentControl({ token: TOKEN });
  assert.equal(controlRequest(control, { token: '' }).status, 404);
  assert.equal(controlRequest(control, { token: 'b'.repeat(64) }).status, 404);
  assert.equal(controlRequest(control, { peer: '203.0.113.8' }).status, 404);
  assert.equal(controlRequest(control, { peer: '172.17.0.1' }).status, 404, 'Docker port forwarding is not container loopback');
  assert.equal(controlRequest(control, { method: 'GET' }).status, 405);
  assert.equal(control.draining(), false);
  assert.equal(controlRequest(control).body.draining, true);
  assert.equal(controlRequest(createDeploymentControl({ token: 'short' })).status, 404);
});

test('a drain lease renews, can be cancelled, and expires if the deployer disappears', () => {
  let now = 1000;
  const control = createDeploymentControl({ token: TOKEN, now: () => now });
  controlRequest(control);
  now += DRAIN_LEASE_MS - 1;
  assert.equal(control.draining(), true);
  controlRequest(control);
  now += 2;
  assert.equal(control.draining(), true, 'the lease was renewed');
  now += DRAIN_LEASE_MS;
  assert.equal(control.draining(), false);
  assert.equal(control.status().expiresAt, null);
  controlRequest(control);
  assert.equal(controlRequest(control, { path: '/_deploy/resume' }).body.draining, false);
});

test('draining refuses every new match but preserves a live match and WebSocket recovery', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, studio: false, assetIndex: false,
    versions: { enabled: ['act2autochess'] }, deploymentToken: TOKEN });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.close())); await srv.close(); });
  const connect = async (name, token) => {
    const client = await TestClient.connect(`${srv.url.replace('http:', 'ws:')}/ws`);
    clients.push(client);
    const welcome = await client.hello(name, token);
    return { client, welcome };
  };
  const host = await connect('Existing');
  assert.equal((await host.client.request({ t: 'room.create', mode: 'solo' })).t, 'ok');
  assert.equal((await host.client.request({ t: 'room.start' })).t, 'ok');
  const existing = [...srv.lobby.rooms.values()][0].match;
  const waiting = await connect('Waiting');
  assert.equal((await waiting.client.request({ t: 'room.create', mode: 'solo' })).t, 'ok');
  const response = await fetch(`${srv.url}/_deploy/drain`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(response.status, 200);
  const health = await (await fetch(`${srv.url}/healthz`)).json();
  assert.equal(health.deployment.draining, true);
  assert.equal(health.matches, 1);
  assert.equal((await waiting.client.request({ t: 'room.start' })).code, 'MAINTENANCE');
  assert.equal(srv.lobby.startMatch({}).error, 'MAINTENANCE', 'internal entry points also pass through the gate');
  await host.client.close();
  const resumed = await connect('Existing', host.welcome.token);
  assert.equal(resumed.welcome.playerId, host.welcome.playerId);
  assert.equal([...srv.lobby.rooms.values()][0].match, existing);
  assert.equal(resumed.client.isOpen, true);
  assert.equal((await fetch(`${srv.url}/_deploy/resume`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
  assert.equal((await waiting.client.request({ t: 'room.start' })).t, 'ok');
});
