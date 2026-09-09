import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { detectLang } from './i18n';
import { storageGet } from './api';
import { IS_NATIVE, initNative } from './native';
import './styles.css';
import { applyLargeText } from './sounds';

applyLargeText();

// installable + offline app shell (production builds only)
if (import.meta.env.PROD && !IS_NATIVE && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      // a new build installed while the app is open → offer a reload (no silent mid-session swap)
      window.addEventListener('sw:reload', () => reg.waiting?.postMessage('SKIP_WAITING'));
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new Event('sw:update'));
        });
      });
    }).catch((err) => console.warn('service worker registration failed', err));
  });
}

// language/direction + theme before first paint (persisted choices), then the web font off the critical path
{
  const lang = detectLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  // 'light' | 'dark' are explicit; 'system' (or nothing saved) leaves the attribute off so
  // the stylesheet's prefers-color-scheme block decides — no flash of the wrong theme
  const theme = storageGet('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
const font = document.createElement('link');
font.rel = 'stylesheet';
font.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400..900&display=swap';
document.head.appendChild(font); // non-blocking: appended after HTML parse, preconnect hints already warm

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// native shell: status bar, back button, external links, splash hide (no-op on the web)
void initNative();
