import { useEffect } from '../vendor/hooks.module.js';
import { createStore, useStore } from './store.js';
import { normalizeSiteConfig } from './siteConfigModel.js';

export const siteConfigStore = createStore({ config: normalizeSiteConfig(null), loaded: false, failed: false });
let pending = null;

export function loadSiteConfig({ force = false } = {}) {
  if (pending) return pending;
  if (siteConfigStore.get().loaded && !force) return Promise.resolve();
  pending = Promise.resolve().then(async () => {
    try {
      const response = await fetch('/site-config.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Site config HTTP ${response.status}`);
      const raw = await response.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid site config');
      siteConfigStore.set({ config: normalizeSiteConfig(raw), loaded: true, failed: false });
    } catch {
      siteConfigStore.set({ loaded: true, failed: true });
    }
  }).finally(() => { pending = null; });
  return pending;
}

export function useSiteConfig() {
  useEffect(() => { loadSiteConfig(); }, []);
  return useStore((s) => s, Object.is, siteConfigStore);
}
