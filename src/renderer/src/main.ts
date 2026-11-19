import './styles.css';
import { initI18n, t } from './i18n';
import { store } from './settings/store';
import { App } from './ui/App';

window.addEventListener('error', (e) => window.cosmos.log('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => window.cosmos.log('error', `unhandled: ${e.reason?.stack ?? e.reason}`));

async function start() {
  await store.load();
  await initI18n(store.value.language);
  window.cosmos.setOffline(store.value.offlineMode);
  const credit = document.getElementById('boot-credit')!, fill = document.getElementById('boot-fill')!, step = document.getElementById('boot-step')!, boot = document.getElementById('boot')!, total = 5; let done = 0; credit.textContent = t('boot.credit');
  // The bar advances only when a real loading step has finished.
  const mark = (key: string) => { fill.style.width = `${(done++ / total) * 100}%`; fill.parentElement!.setAttribute('aria-valuenow', String(Math.round((done / total) * 100))); step.textContent = t(`boot.${key}`); };
  mark('start'); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  const app = new App(); await app.view.prepare(mark); fill.style.width = '100%'; step.textContent = t('boot.ready'); await new Promise((r) => setTimeout(r, 750)); boot.classList.add('done'); setTimeout(() => boot.remove(), 650); window.__cosmos = app;
}
start().catch((e) => {
  window.cosmos.log('fatal', String(e?.stack ?? e));
  document.getElementById('chrome')!.textContent = String(e?.message ?? e);
});
