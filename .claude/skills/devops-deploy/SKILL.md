---
name: devops-deploy
description: النشر والبنية التحتية: Docker، CI/CD بـ GitHub Actions، Vercel/Railway/Fly/VPS، Nginx، المراقبة. استخدمها عند طلب نشر أو Dockerfile أو خط أنابيب أو إعداد خادم.
---

# النشر والبنية

## Docker
- صورة متعددة المراحل، صورة أساس slim/alpine، مستخدم غير root، .dockerignore.
- HEALTHCHECK، ومتغيرات البيئة عبر env لا داخل الصورة.
- docker-compose للتطوير المحلي مع volumes للبيانات.

## CI/CD (GitHub Actions)
- خط واحد: install (بكاش) → lint → type-check → test → build.
- النشر فقط من main بعد نجاح الخط، مع بيئة staging إن أمكن.
- الأسرار في GitHub Secrets، لا في الملفات.

## المنصات
- واجهات/Next.js: Vercel. خلفية صغيرة: Railway/Render/Fly. تحكم كامل: VPS + Docker + Caddy (HTTPS تلقائي).
- قاعدة بيانات مُدارة دائمًا مع نسخ احتياطي يومي مُختبر الاستعادة.

## التشغيل
- سجلات مهيكلة JSON، وSentry للأخطاء، وUptime check خارجي.
- متغير APP_VERSION في كل نشر، وإمكانية التراجع بأمر واحد.
- قبل أي نشر للإنتاج: شغّل مهارة web-security.

## الرد
- أعطِ أوامر النشر كاملة بالترتيب، وما يحتاج المستخدم إدخاله يدويًا (مفاتيح، DNS).
