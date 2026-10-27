// Single-instance deployment admission gate. A short lease blocks new matches, never an existing match or reconnect.
// Control requests are container-local and authenticated; forwarded address headers are deliberately ignored.
import { timingSafeEqual } from 'node:crypto';
import { sendJson } from './common.js';

export const DRAIN_LEASE_MS = 120_000;

export function createDeploymentControl({ token = process.env.SP_DEPLOY_TOKEN || '', now = Date.now } = {}) {
  const enabled = /^[a-f0-9]{64}$/.test(token);
  const expected = Buffer.from(token);
  let until = 0;
  const draining = () => enabled && now() < until;
  return {
    draining,
    status: () => ({ supported: enabled, draining: draining(), expiresAt: draining() ? until : null }),
    handle(req, res, rawPath) {
      if (rawPath !== '/_deploy/drain' && rawPath !== '/_deploy/resume') return false;
      const peer = req.socket?.remoteAddress;
      const auth = req.headers.authorization;
      const supplied = Buffer.from(typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '');
      if (!enabled || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
        || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        sendJson(req, res, 404, { error: 'NOT_FOUND' });
        return true;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(req, res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      until = rawPath === '/_deploy/drain' ? now() + DRAIN_LEASE_MS : 0;
      sendJson(req, res, 200, this.status());
      return true;
    },
  };
}
