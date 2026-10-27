// Executed over stdin by `docker exec -i ... node --input-type=module - MODE [SHA]`.
// No host Node.js installation is required. Exit 10 means live matches, never permission to stop the container.
import { createRequire } from 'node:module';

const [mode, expected] = process.argv.slice(2);
const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
const get = async (url, options = {}) => {
  const response = await fetch(base + url, { ...options, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
};

try {
  if (mode === 'drain' || mode === 'resume') {
    const response = await get(`/_deploy/${mode}`, { method: 'POST',
      headers: { authorization: `Bearer ${process.env.SP_DEPLOY_TOKEN || ''}` } });
    const control = await response.json();
    if (!control.supported || control.draining !== (mode === 'drain')) throw new Error('admission gate did not acknowledge');
  }
  const health = await (await get('/healthz')).json();
  if (!health.ok || (expected && health.release !== expected)) throw new Error('unexpected server release');
  if (mode === 'drain') {
    if (!health.deployment?.draining || health.deployment.expiresAt - Date.now() < 60_000
      || !Number.isSafeInteger(health.matches) || health.matches < 0) throw new Error('cannot confirm a safe deployment window');
    if (health.matches > 0) { console.log(`Waiting for ${health.matches} live match(es)`); process.exitCode = 10; }
  } else if (mode === 'smoke') {
    if (!health.deployment?.supported) throw new Error('SP_DEPLOY_TOKEN must be 64 lowercase hex characters');
    if (!/<html/i.test(await (await get('/')).text())) throw new Error('missing client page');
    await get('/vendor/preact.module.js');
    await get('/js/main.js');
    await get('/js/ui/serverDirectory.js');
    await get('/js/siteConfigModel.js');
    await get('/shared/project.js');
    const siteConfig = await (await get('/site-config.json')).json();
    if (!siteConfig || typeof siteConfig !== 'object' || Array.isArray(siteConfig)) throw new Error('invalid public site configuration');
    await get('/data/assets.json');
    // Resolve ws from /app/node_modules even though this module is streamed over stdin.
    const require = createRequire(`${process.cwd()}/package.json`);
    const WebSocket = require('ws');
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WebSocket hello timed out')); }, 5000);
      const finish = (error) => { clearTimeout(timer); ws.terminate(); error ? reject(error) : resolve(); };
      ws.on('error', finish);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Probe', version: health.version, rid: 1 })));
      ws.on('message', (frame) => {
        try {
          const reply = JSON.parse(frame.toString());
          if (reply.t === 'welcome') finish();
          else if (reply.t === 'error') finish(new Error(`WebSocket hello: ${reply.code}`));
        } catch (error) { finish(error); }
      });
    });
  } else if (!['drain', 'resume', 'ready'].includes(mode)) {
    throw new Error('unknown probe mode');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
