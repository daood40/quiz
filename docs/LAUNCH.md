# دليل الإطلاق — خطوة بخطوة (للمالك)

> الهدف: خلال ساعة واحدة يكون لديك تطبيق حقيقي بحسابات ولوحات صدارة على رابط عام.
> كل خطوة مستقلة؛ نفّذها بالترتيب وضع ✅ عندها.

## 0) ما تحتاجه قبل البدء
- حساب GitHub (موجود) وهذا المستودع: `https://github.com/daood40/quiz`.
- بطاقة/حساب على **Render** (https://render.com) — الخطة المجانية تكفي للتجربة، Starter (~7$/شهر) للإنتاج.
- (اختياري لكن مُوصى به) حساب **Resend** (https://resend.com) لبريد استعادة كلمة المرور، وقناة **Discord** للتنبيهات.

## 1) استضافة الخادم على Render (10 دقائق)
1. Render → **New → Blueprint** → اختر مستودع `daood40/quiz` → الفرع الافتراضي.
2. سيقرأ Render ملف `render.yaml` ويُنشئ: خدمة `quiz-api` + قاعدة `quiz-db` (PostgreSQL 16). اضغط **Apply**.
3. أثناء الإنشاء سيطلب القيم غير المحفوظة (`sync: false`). أدخل:
   - `CORS_ORIGIN` = `https://daood40.github.io` (وسنضيف نطاقك لاحقًا بفاصلة).
   - `APP_URL` = رابط الخدمة الذي يعطيك إياه Render، مثل `https://quiz-api.onrender.com`.
   - `SEED_ADMIN_EMAIL` = بريدك، `SEED_ADMIN_PASSWORD` = كلمة مرور قوية (ستغيّرها بعد أول دخول).
   - `MAIL_*` و`ERROR_WEBHOOK_URL`: اتركها فارغة الآن (الخطوتان 4 و5).
4. انتظر حتى يصبح الحالة **Live**. افتح `https://<رابطك>/ready` — يجب أن ترى `"ok": true`.
5. افتح `https://<رابطك>/` → ستظهر الواجهة الكاملة. سجّل الدخول بحساب المدير من الخطوة 3، ثم **الإعدادات → تغيير كلمة المرور**.

> أول تشغيل يُنشئ الجداول والمدير والتصنيفات و154 سؤالًا تلقائيًا (`SEED_ON_BOOT`). تصنيف «إسلاميات» مخفي وأسئلته في طابور المراجعة حتى تُعيّن مراجعًا متخصصًا (الإدارة → التصنيفات → تفعيل).

## 2) ربط النسخة العامة على GitHub Pages بالخادم (دقيقتان)
1. GitHub → المستودع → **Settings → Secrets and variables → Actions → Variables → New variable**.
2. الاسم `VITE_API_BASE`، القيمة `https://<رابط Render>/api/v1`.
3. أعد تشغيل Workflow **Deploy demo to GitHub Pages** (Actions → اختره → Run workflow).
4. بعد دقيقة: `https://daood40.github.io/quiz/` يصبح التطبيق الكامل (حسابات حقيقية) بدل الـ Demo.

> إن أردت إبقاء الـ Demo كما هو، تجاهل هذه الخطوة واستخدم رابط Render مباشرة.

## 3) نطاقك الخاص (اختياري، 10 دقائق)
1. Render → الخدمة → **Settings → Custom Domains** → أضف `quiz.yourdomain.com` واتبع تعليمات DNS (سجل CNAME).
2. حدّث `APP_URL` و`CORS_ORIGIN` إلى النطاق الجديد.

## 4) البريد الإلكتروني (استعادة كلمة المرور) — Resend (10 دقائق)
1. Resend → **Domains → Add domain** → أضف سجلات DNS المطلوبة حتى يصبح Verified.
2. **API Keys → Create** → انسخ المفتاح.
3. Render → الخدمة → **Environment**: `MAIL_PROVIDER=resend`، `MAIL_API_KEY=<المفتاح>`، `MAIL_FROM=Quiz <no-reply@yourdomain.com>`.
4. اختبر: صفحة الدخول → «نسيت كلمة المرور» → يجب أن تصلك رسالة برابط.

## 5) التنبيهات عند الأعطال — Discord (دقيقتان)
1. Discord → الخادم → القناة → **Edit channel → Integrations → Webhooks → New Webhook → Copy URL**.
2. Render → Environment: `ERROR_WEBHOOK_URL=<الرابط>`.
3. من الآن كل خطأ 500 أو وظيفة خلفية فاشلة تصل كرسالة في القناة.

## 6) المحتوى قبل الإعلان
- الإدارة → **الأسئلة**: راجع/اعتمد ما في «بانتظار المراجعة».
- الإدارة → **استيراد/تصدير**: ارفع ملف CSV بأسئلتك (نموذج الأعمدة يظهر في الصفحة).
- (اختياري) الإدارة → **مسودات AI** بعد ضبط `AI_PROVIDER=anthropic` و`AI_API_KEY` في Render.
- الإدارة → **الإعدادات**: راجع وضع الزائر، التسجيل، حدود اليوم.

## 7) فحص ما قبل الإعلان (5 دقائق)
- [ ] `/ready` يعطي `ok: true` ولا وظائف فاشلة.
- [ ] تسجيل حساب جديد → جولة موقّتة → يظهر في لوحة الصدارة.
- [ ] «نسيت كلمة المرور» يرسل بريدًا.
- [ ] الجوال: افتح الرابط في Chrome/Safari → «إضافة إلى الشاشة الرئيسية» يعمل.
- [ ] Discord يستقبل رسالة اختبار (افتح `https://<رابطك>/api/v1/does-not-exist` لن يُرسل شيئًا لأنه 404؛ التنبيه للأخطاء 500 فقط).

## 8) بعد الإطلاق (أسبوعيًا)
- **النسخ الاحتياطي:** Render يحتفظ بنسخ يومية لقاعدة البيانات. للنسخة الخارجية شغّل `scripts/backup.sh` من جهازك مع `DATABASE_URL` الخارجي (Render → Database → External URL).
- **المراقبة:** `/metrics` (Prometheus) و`/ready`؛ وقناة Discord.
- **التحديثات:** كل push على الفرع الافتراضي يبني صورة جديدة وينشر Pages؛ Render يعيد النشر تلقائيًا من GitHub (Auto-Deploy مفعّل افتراضيًا).

## البدائل السريعة إن لم تُرد Render
| المنصة | الأمر |
|---|---|
| Railway | New Project → Deploy from GitHub → أضف PostgreSQL → نفس المتغيرات أعلاه |
| Fly.io | `fly launch --no-deploy` → `fly postgres create && fly postgres attach` → `fly secrets set JWT_SECRET=$(openssl rand -hex 64) CORS_ORIGIN=… APP_URL=… SEED_ADMIN_PASSWORD=…` → `fly deploy` |
| VPS | `docker compose up -d --build` مع `.env` يحتوي `JWT_SECRET` و`POSTGRES_PASSWORD` و`SEED_ADMIN_PASSWORD` |
