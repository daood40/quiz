/**
 * Native bridge (Capacitor). Every export is a no-op on the plain web build, so the
 * same bundle serves the website, the PWA and the store apps. Plugins are imported
 * lazily so the web bundle never carries native code.
 */
import { Capacitor } from '@capacitor/core';
import { storageGet, storageSet } from './api';

export const IS_NATIVE = Capacitor.isNativePlatform();
export const PLATFORM = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'

const DAILY_REMINDER_ID = 1001;

/** Status bar follows the theme, Android back button follows history, external links open the system browser. */
export async function initNative(): Promise<void> {
  if (!IS_NATIVE) return;
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ]);

  const applyBar = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
    if (PLATFORM === 'android') void StatusBar.setBackgroundColor({ color: dark ? '#0b1020' : '#f5f6fa' }).catch(() => undefined);
  };
  applyBar();
  new MutationObserver(applyBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') window.history.back();
    else void App.exitApp();
  });

  // deep links (https://…/verify?token=…) → in-app route
  void App.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      window.history.pushState({}, '', u.pathname + u.search);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* not a URL we understand */ }
  });

  // any link to another origin leaves the WebView and opens in the system browser
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin === window.location.origin || url.protocol === 'mailto:') return;
    e.preventDefault();
    void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: url.href }));
  });

  await SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => undefined);
}

/** Haptic feedback through the platform engine (Taptic / vibrator). */
export async function nativeHaptic(kind: 'correct' | 'wrong' | 'tap'): Promise<void> {
  if (!IS_NATIVE) return;
  const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
  if (kind === 'tap') await Haptics.impact({ style: ImpactStyle.Light });
  else await Haptics.notification({ type: kind === 'correct' ? NotificationType.Success : NotificationType.Error });
}

/** System share sheet for text (falls back to the Web Share API / clipboard on the web). */
export async function nativeShareText(text: string, title?: string): Promise<boolean> {
  if (!IS_NATIVE) return false;
  const { Share } = await import('@capacitor/share');
  await Share.share({ text, title, dialogTitle: title });
  return true;
}

/** Write a blob to the app cache and hand it to the share sheet (images, exports). */
export async function nativeShareBlob(blob: Blob, fileName: string, title?: string): Promise<boolean> {
  if (!IS_NATIVE) return false;
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
  const { uri } = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
  await Share.share({ title, files: [uri], dialogTitle: title });
  return true;
}

/** Daily practice reminder (local notification, inexact — no exact-alarm permission needed). */
export function reminderEnabled(): boolean {
  return storageGet('reminder') === 'on';
}
export async function setDailyReminder(on: boolean, texts: { title: string; body: string }, hour = 19): Promise<boolean> {
  if (!IS_NATIVE) return false;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if (!on) {
    await LocalNotifications.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
    storageSet('reminder', 'off');
    return true;
  }
  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return false;
  await LocalNotifications.schedule({
    notifications: [{
      id: DAILY_REMINDER_ID,
      title: texts.title,
      body: texts.body,
      schedule: { on: { hour, minute: 0 }, allowWhileIdle: false },
    }],
  });
  storageSet('reminder', 'on');
  return true;
}
