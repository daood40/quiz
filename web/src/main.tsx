import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyLargeText } from './sounds';

applyLargeText();

// installable + offline app shell (production builds only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
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

// language/direction before first paint (persisted choice), then the web font off the critical path
try {
  const saved = localStorage.getItem('lang');
  const lang = saved === 'ar' || saved === 'en' ? saved : navigator.language.startsWith('ar') ? 'ar' : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
} catch { /* storage unavailable */ }
const font = document.createElement('link');
font.rel = 'stylesheet';
font.href = 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800;900&display=swap';
window.addEventListener('load', () => document.head.appendChild(font));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
