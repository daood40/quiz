# memory/TODO.md   (آخر تحديث: 2026-09-09)
## P0 — يمنع الإصدار على المتاجر
- [ ] نشر الخادم على Render من render.yaml وضبط `CORS_ORIGIN` ليشمل `https://localhost,capacitor://localhost` (docs/LAUNCH.md)
- [ ] GitHub Variables: `MOBILE_API_BASE`، `SUPPORT_EMAIL`؛ ثم إعادة تشغيل Mobile workflow
- [ ] أسرار التوقيع `ANDROID_KEYSTORE_*` و`IOS_*` (docs/STORE_SUBMISSION.md §2ب، §3ب)
- [ ] حسابات Google Play وApple Developer + حساب تجريبي للمراجعين
- [ ] لقطات المتجر (6.7"/6.5" iPhone، هاتف Android) ثم Submit
## P1 — بعد الإصدار
- [ ] نقطة نهاية لأحداث العميل (`first_open`, `signup_completed`, `error_shown`) — لا يوجد مسار `/events` بعد؛ التحليلات حاليًا من الخادم فقط
- [ ] استبدال الرموز التعبيرية بمجموعة أيقونات خطية واحدة (قرار هوية بصرية للمالك — design-taste finding 11)
- [ ] ملف LICENSE (قرار المالك؛ README يوضّح غيابه)
- [ ] اختبار حمل على `/api/v1/attempts` (k6) وتوثيق الأرقام في GATES §20
- [ ] مقاييس احتفاظ D1/D7 من جدول analytics
- [ ] إشعارات Push (FCM/APNs) عبر الخادم
- [ ] تثبيت digest صورة node في Dockerfile
## P2 / لاحقاً
- [ ] MFA / OAuth (يستلزم Sign in with Apple عند إضافة Google)
- [ ] CAPTCHA عند التسجيل إن ظهر إساءة
- [ ] محدّد معدل بـRedis عند أكثر من نسخة خادم
- [ ] نقل الأنماط المضمّنة (111) إلى فئات لإزالة `style-src 'unsafe-inline'`
