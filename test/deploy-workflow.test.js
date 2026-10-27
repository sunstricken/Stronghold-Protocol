import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseWorkflow } from '../tools/ci.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bash = process.platform === 'win32'
  ? ['D:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'].find(fs.existsSync)
  : '/bin/bash';
const workflow = parseWorkflow(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
const script = workflow.jobs.production.steps.find((step) => step.name === 'Deploy or roll back with match protection').run;

for (const scenario of ['success', 'login-failure', 'deploy-failure']) {
  test(`production workflow ${scenario}: passes registry token only on stdin and cleans remote credentials`, { skip: !bash }, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-remote-deploy-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const state = path.join(dir, 'calls.json');
    fs.writeFileSync(state, '[]');
    const driver = path.join(dir, 'driver.mjs');
    fs.writeFileSync(driver, `import fs from 'node:fs';
const [kind, ...args] = process.argv.slice(2);
const command = args.at(-1);
const login = kind === 'ssh' && command.includes(' login ghcr.io ');
const deploy = kind === 'ssh' && command.includes("bash '");
const calls = JSON.parse(fs.readFileSync(process.env.SP_REMOTE_CALLS, 'utf8'));
calls.push({ kind, args, tokenOnStdin: login && fs.readFileSync(0, 'utf8').trim() === process.env.GHCR_TOKEN });
fs.writeFileSync(process.env.SP_REMOTE_CALLS, JSON.stringify(calls));
if ((login && process.env.SP_REMOTE_SCENARIO === 'login-failure') || (deploy && process.env.SP_REMOTE_SCENARIO === 'deploy-failure')) process.exitCode = 1;
`);
    const token = 'fake-registry-token-for-test';
    const doubles = 'ssh() { node -- "$SP_REMOTE_DRIVER" ssh "$@"; }; scp() { node -- "$SP_REMOTE_DRIVER" scp "$@"; };\n';
    const result = spawnSync(bash, ['-c', doubles + script], { encoding: 'utf8', timeout: 15_000,
      env: { ...process.env,
        SP_REMOTE_CALLS: state, SP_REMOTE_DRIVER: driver, SP_REMOTE_SCENARIO: scenario, MSYS2_ARG_CONV_EXCL: '*',
        DEPLOY_HOST: 'example.com', DEPLOY_USER: 'deploy', DEPLOY_PORT: '22', DEPLOY_PATH: '/srv/stronghold/managed',
        CONTAINER_NAME: 'stronghold', PUBLIC_PORT: '3000', BIND_ADDRESS: '127.0.0.1', RELEASE_SHA: 'a'.repeat(40),
        IMAGE: `ghcr.io/test/game@sha256:${'b'.repeat(64)}`, OPERATION: 'deploy', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1',
        GHCR_TOKEN: token, GHCR_USER: 'sunstricken' },
    });
    assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stderr);
    const calls = JSON.parse(fs.readFileSync(state, 'utf8'));
    assert.equal(calls.filter((call) => call.tokenOnStdin).length, 1);
    assert.equal(JSON.stringify(calls).includes(token), false, 'token never appears in command arguments');
    assert.equal((result.stdout + result.stderr).includes(token), false, 'token never appears in logs');
    const last = calls.at(-1);
    assert.equal(last.kind, 'ssh');
    assert.ok(last.args.at(-1).includes("rm -f -- '/srv/stronghold/managed/deploy-42-1/docker-auth/config.json'"));
    const deploy = calls.find((call) => call.kind === 'ssh' && call.args.at(-1).includes("bash '"));
    if (scenario === 'login-failure') assert.equal(deploy, undefined, 'failed login prevents deployment');
    else {
      assert.ok(deploy.args.at(-1).includes("DOCKER_CONFIG='/srv/stronghold/managed/deploy-42-1/docker-auth'"));
      assert.ok(deploy.args.at(-1).includes("SP_BIND_ADDRESS='127.0.0.1'"));
    }
  });
}
