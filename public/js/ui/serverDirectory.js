// Title-only public links. Rooms and matches never expose server navigation.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { useStore, loadPref, savePref, selectRoute } from '../store.js';
import { loadSiteConfig, useSiteConfig } from '../siteConfig.js';
import { t } from '../../../shared/i18n.js';

export function ServerDirectory() {
  const allowed = useStore((s) => selectRoute(s) === 'title' && !s.room && !s.match?.public);
  const { config, loaded, failed } = useSiteConfig();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => loadPref('server-directory-seen', false) === true);
  const origin = globalThis.location?.origin || '';
  const others = config.servers.filter((server) => server.origin !== origin);
  useEffect(() => { if (!allowed) setOpen(false); }, [allowed]);
  useEffect(() => {
    if (allowed && loaded && !failed && config.showOnFirstVisit && others.length && !seen) setOpen(true);
  }, [allowed, loaded, failed, config.showOnFirstVisit, others.length, seen]);
  const dismiss = () => {
    savePref('server-directory-seen', true);
    setSeen(true);
    setOpen(false);
  };
  if (!allowed) return null;
  return html`<span class="server-directory-slot">
    <button type="button" class="notice-entry tapx" data-testid="servers-open" onClick=${() => setOpen(true)}>${t('服务器列表')}</button>
    <${Modal} open=${open} class="server-directory" title=${t('服务器列表')} micro="SERVERS" onClose=${dismiss}
      actions=${html`<${Button} variant="primary" data-testid="servers-continue" onClick=${dismiss}>${t('继续使用当前服务器')}<//>`}>
      <p class="modal__text">${t('各服务器独立运营，房间和对局不互通，请与队友选择同一服务器。')}</p>
      <p class="modal__text">${t('本页面仅自发整理公开访问地址，未与其他维护者建立合作关系；访问情况及版本以对方网站为准。')}</p>
      <div class="server-directory__list">
        <article class="server-directory__card is-current" data-testid="server-current">
          <h3>${config.currentServerName || globalThis.location?.host}<span class="server-directory__badge">${t('当前服务器')}</span></h3>
          <p class="server-directory__url">${origin}/</p>
        </article>
        ${others.map((server) => html`<article key=${server.origin} class="server-directory__card">
          <h3>${server.name}</h3>
          <p class="server-directory__url">${server.url}</p>
          ${server.maintainer ? html`<p>${t('维护者：{name}', { name: server.maintainer })}</p>` : null}
          ${server.description ? html`<p>${server.description}</p>` : null}
          <a class="server-directory__visit" href=${server.url} target="_blank" rel="noopener noreferrer" data-testid="server-visit">${t('访问此服务器（新标签页）')}</a>
        </article>`)}
      </div>
      ${!loaded ? html`<p class="modal__text">${t('正在加载服务器列表')}</p>` : null}
      ${failed ? html`<p class="modal__text" role="status">${t('服务器列表暂时无法加载，请稍后重试。')}
        <${Button} variant="ghost" size="sm" data-testid="servers-retry" onClick=${() => loadSiteConfig({ force: true })}>${t('重试')}<//></p>`
        : loaded && !others.length ? html`<p class="modal__text">${t('暂未收录其他服务器。')} </p>` : null}
    <//>
  </span>`;
}
