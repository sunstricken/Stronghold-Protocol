import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const bash = process.platform === 'win32'
  ? ['D:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'].find(fs.existsSync)
  : '/bin/bash';
const unixPath = (value) => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const sha = 'b'.repeat(40);
const image = `ghcr.io/test/game@sha256:${'b'.repeat(64)}`;
const old = { managed: true, image: `ghcr.io/test/game@sha256:${'a'.repeat(64)}`, release: 'a'.repeat(40), running: true };

function run(t, scenario, { operation = 'deploy', extra = [], existing = true, bindAddress = '0.0.0.0', siteConfig = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-deploy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bin'));
  for (const item of ['assets', 'fonts', 'plugins']) fs.mkdirSync(path.join(dir, 'shared', item), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.env'), 'SP_DEPLOY_TOKEN=example\n');
  if (siteConfig) fs.writeFileSync(path.join(dir, 'shared', 'site-config.json'), '{}\n');
  const stateFile = path.join(dir, 'state.json');
  const containers = existing ? { stronghold: { ...old } } : {};
  if (operation === 'rollback') containers['stronghold-previous'] = { ...old, release: sha, image, running: false };
  fs.writeFileSync(stateFile, JSON.stringify({ scenario, calls: [], containers, drains: 0, newSha: sha }));
  for (const [name, content] of Object.entries({
    docker: '#!/usr/bin/env bash\nexec node -- "$SP_DOCKER_TEST_DRIVER" "$@"\n',
    // Git for Windows does not ship flock. Linux CI exercises the real util-linux lock.
    ...(process.platform === 'win32' ? { flock: '#!/usr/bin/env bash\nexit 0\n' } : {}),
  })) fs.writeFileSync(path.join(dir, 'bin', name), content, { mode: 0o755 });
  const result = spawnSync(bash, ['-c', 'sleep() { :; }; source "$1" "${@:2}"', 'deploy-test',
    unixPath(path.join(root, 'scripts/deploy/deploy.sh')), operation, image, sha, ...extra], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
      SP_DEPLOY_ROOT: unixPath(dir), SP_DEPLOY_WAIT_SECONDS: scenario === 'wait' ? '10' : '0',
      SP_BIND_ADDRESS: bindAddress,
      SP_DOCKER_TEST_STATE: stateFile, SP_DOCKER_TEST_DRIVER: path.join(root, 'test/helpers/deployDocker.mjs'),
      MSYS2_ARG_CONV_EXCL: '*' },
  });
  return { ...result, state: JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
}

for (const scenario of ['candidate-failure', 'wrong-revision', 'busy', 'unknown-gate']) {
  test(`deployment ${scenario}: production is never stopped`, { skip: !bash }, (t) => {
    const result = run(t, scenario);
    assert.equal(result.status, scenario === 'busy' ? 75 : 1, result.stderr);
    assert.equal(result.state.calls.some(args => args[0] === 'stop'), false);
    assert.deepEqual(result.state.containers.stronghold, old);
    assert.equal(result.state.containers['stronghold-candidate'], undefined);
    if (scenario === 'busy') assert.ok(result.state.calls.some(args => args[0] === 'exec' && args[6] === 'resume'));
  });
}
for (const scenario of ['run-failure', 'live-failure']) {
  test(`deployment ${scenario}: restores the previous running container`, { skip: !bash }, (t) => {
    const result = run(t, scenario);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(result.state.containers.stronghold, old, result.stderr);
    assert.equal(result.state.containers['stronghold-previous'], undefined);
    assert.ok(result.state.calls.some(args => args[0] === 'exec' && args[6] === 'resume'));
  });
}
for (const scenario of ['success', 'wait']) {
  test(`deployment ${scenario}: validates first, drains, swaps, and retains the stopped previous container`, { skip: !bash }, (t) => {
    const result = run(t, scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.state.containers.stronghold.release, sha);
    assert.deepEqual(result.state.containers['stronghold-previous'], { ...old, running: false });
    assert.equal(result.state.drains, scenario === 'wait' ? 3 : 2);
    const stop = result.state.calls.findIndex(args => args[0] === 'stop');
    const smoke = result.state.calls.findIndex(args => args[0] === 'exec' && args[2] === 'stronghold-candidate' && args[6] === 'smoke');
    assert.ok(stop > smoke && smoke > 0);
  });
}
test('manual rollback uses the retained image through the same protected deployment path', { skip: !bash }, (t) => {
  const result = run(t, 'success', { operation: 'rollback' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.state.calls.some(args => args[0] === 'pull' && args[1] === image));
  assert.equal(result.state.containers.stronghold.release, sha);
});

test('reverse-proxy deployment preserves loopback binding and mounts the public site configuration in both containers', { skip: !bash }, (t) => {
  const result = run(t, 'success', { bindAddress: '127.0.0.1', siteConfig: true });
  assert.equal(result.status, 0, result.stderr);
  const runs = result.state.calls.filter(args => args[0] === 'run');
  const live = runs.find(args => args[args.indexOf('--name') + 1] === 'stronghold');
  assert.equal(live[live.indexOf('-p') + 1], '127.0.0.1:3000:3000');
  for (const args of runs) assert.ok(args.some(arg => arg.includes('dst=/app/public/site-config.json,readonly')));
  assert.equal(runs[0].includes('-p'), false, 'candidate never publishes a port');
});

test('invalid bind addresses are rejected before touching containers', { skip: !bash }, (t) => {
  const result = run(t, 'success', { bindAddress: '127.0.0.1:22' });
  assert.equal(result.status, 1);
  assert.deepEqual(result.state.calls, []);
});

test('manual rollback uses an already cached digest without registry authentication', { skip: !bash }, (t) => {
  const result = run(t, 'cached-rollback', { operation: 'rollback', bindAddress: '127.0.0.1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.state.calls.some(args => args[0] === 'pull'), false);
  assert.equal(result.state.containers.stronghold.release, sha);
});
