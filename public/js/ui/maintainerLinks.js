import { html } from './components.js';
import { useSiteConfig } from '../siteConfig.js';
import { t } from '../../../shared/i18n.js';

export function MaintainerLinks() {
  const { config } = useSiteConfig();
  if (!config.contacts.length) return null;
  return html`<span class="maintainer-links">
    <span>${t('联系维护者')}</span>
    ${config.contacts.map((contact) => html`<a key=${contact.url} class="title-repo" href=${contact.url}
      target="_blank" rel="noopener noreferrer">${contact.label}</a>`)}
  </span>`;
}
