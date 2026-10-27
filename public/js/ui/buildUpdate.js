// A dismissible update notice. Only a player's click can reload the page; live matches disable that action.
import { html, Button, Modal } from './components.js';
import { store, useStore, selectRoute } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function matchBlocksUpdate(state) {
  return selectRoute(state) === 'game' && !state.match?.result;
}

export function showBuildUpdate() {
  store.patch('ui', { buildNoticeOpen: true });
}

export function BuildUpdateNotice() {
  const open = useStore((s) => !!s.ui.buildStale && !!s.ui.buildNoticeOpen);
  const playing = useStore(matchBlocksUpdate);
  const dismiss = () => store.patch('ui', { buildNoticeOpen: false });
  return html`<${Modal} open=${open} class="build-update" title=${t('发现新版本')} micro="UPDATE" onClose=${dismiss}
    actions=${html`
      <${Button} variant="secondary" data-testid="build-update-later" onClick=${dismiss}>${t('稍后更新')}<//>
      <${Button} variant="primary" icon="refresh" data-testid="build-update-now" disabled=${playing}
        onClick=${() => { if (!matchBlocksUpdate(store.get())) location.reload(); }}>${t('立即更新')}<//>`}>
    <p class="modal__text">${t('新版本已发布，关闭提示后可继续使用，页面不会自动刷新。')}</p>
    ${playing ? html`<p class="modal__text">${t('对局进行中，请在本局结束后更新。')}</p>` : null}
  <//>`;
}
