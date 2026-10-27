// Public, manually curated links. No health requests are sent to independent servers.
/** @param {unknown} value @param {boolean} [contact] */
export function publicLink(value, contact = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (contact && url.protocol === 'mailto:' && /^[^?]+@[^?]+$/.test(url.pathname) && !url.search && !url.hash) return url.href;
  } catch { /* An invalid link is omitted, never rendered as a navigation target. */ }
  return null;
}

/** @param {any} raw */
export function normalizeSiteConfig(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const contacts = [];
  for (const item of Array.isArray(source.contacts) ? source.contacts.slice(0, 20) : []) {
    const url = publicLink(item?.url, true);
    const label = text(item?.label);
    if (url && label) contacts.push({ label, url });
  }
  const servers = [];
  const origins = new Set();
  for (const item of Array.isArray(source.servers) ? source.servers.slice(0, 100) : []) {
    if (!item || item.enabled === false) continue;
    const url = publicLink(item.url);
    const name = text(item.name);
    if (!url || !name) continue;
    const origin = new URL(url).origin;
    if (origins.has(origin)) continue;
    origins.add(origin);
    servers.push({ name, url, description: text(item.description, 400), maintainer: text(item.maintainer), origin });
  }
  return { currentServerName: text(source.currentServerName), showOnFirstVisit: source.showOnFirstVisit !== false, contacts, servers };
}
