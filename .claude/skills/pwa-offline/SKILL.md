---
name: pwa-offline
description: تحويل موقع إلى تطبيق ويب تقدمي (PWA) يعمل دون اتصال مع إشعارات. استخدمها عند طلب PWA أو Service Worker أو التثبيت على الشاشة الرئيسية.
---

# PWA

- manifest.webmanifest: name, short_name, start_url, display=standalone, theme_color, أيقونات 192 و512 وmaskable.
- Service Worker عبر Workbox (أو vite-plugin-pwa): precache للـ shell، NetworkFirst للـ API، CacheFirst للصور والخطوط.
- العمل دون اتصال: صفحة offline.html احتياطية، وIndexedDB للبيانات مع طابور مزامنة عند العودة.
- التحديث: أظهر شريطًا "تحديث متاح" وskipWaiting عند الضغط، لا تحديث صامت يكسر الجلسة.
- الإشعارات: اطلب الإذن بعد فعل من المستخدم، لا عند التحميل.
- HTTPS إلزامي. اختبر بـ Lighthouse ويجب أن تنجح فحوصات PWA.
- لا تخزّن استجابات المصادقة أو البيانات الحساسة في الكاش.
