# 🧠 منصة الأسئلة والمسابقات — QUIZ PLATFORM

**🌐 النسخة التجريبية المباشرة:** <https://daood40.github.io/quiz/>

> النسخة على GitHub Pages تعمل بالكامل داخل المتصفح (بدون خادم): محرك الأسئلة
> الحقيقي نفسه + بنك أسئلة مدمج، ويُحفظ تقدمك في متصفحك (localStorage).
> الميزات الاجتماعية والتنافسية (التحديات، الأصدقاء، لوحة الإدارة…) تحتاج
> تشغيل الخادم الكامل — انظر [ما يعمل وما لا يعمل](#ما-يعمل-في-نسخة-pages-وما-يحتاج-خادما) أدناه.

منصة أسئلة ومسابقات ثنائية اللغة (عربي/إنجليزي) بمستوى إنتاجي:

- **محرك أسئلة شامل** — 80 نوع سؤال مبنية على 13 عائلة تفاعل، لكل نوع تحقق
  وتصحيح حقيقيان مع دعم الدرجات الجزئية.
- **لعب بتحكيم الخادم** — العميل لا يرسل النتيجة أبدًا؛ الخادم يختار الأسئلة،
  يحفظ الإجابات الصحيحة سرًّا، يفرض المهل الزمنية، ويكتشف الغش والتكرار.
- **محركات المنافسة** — لوحات صدارة، تحديات قابلة للمشاركة بنفس الأسئلة،
  تحديات شهرية تلقائية، وبطولات إقصائية.
- **التحفيز** — نقاط خبرة (XP)، مستويات، سلاسل يومية (streaks)، وإنجازات.
- **لوحة إدارة كاملة** — مراجعة الأسئلة واعتمادها، استيراد/تصدير CSV/JSON،
  إدارة المستخدمين والأدوار، وإعدادات المنصة الحية.

| الطبقة | التقنية |
|---|---|
| الخادم | Node.js 20+‎، Fastify 5، TypeScript (ESM) |
| قاعدة البيانات | PostgreSQL 16 (`citext`, `pg_trgm`) |
| الواجهة | React 18 + Vite، نظام تصميم خاص، دعم RTL/LTR |
| المصادقة | JWT + رموز تحديث دوّارة، صلاحيات بخمسة أدوار (RBAC) |
| الاختبارات | Vitest — اختبارات وحدات وتكامل على PostgreSQL حقيقية |

## الروابط

| الرابط | الوصف |
|---|---|
| <https://daood40.github.io/quiz/> | النسخة التجريبية المباشرة (تعمل في المتصفح) |
| <https://github.com/daood40/quiz> | هذا المستودع |
| [README.en.md](README.en.md) | الدليل الكامل بالإنجليزية (التثبيت، قاعدة البيانات، التشغيل) |
| [docs/QUIZ_MASTER_DIRECTIVE_v2.md](docs/QUIZ_MASTER_DIRECTIVE_v2.md) | وثيقة التوجيه الرئيسي (المرجع الملزم للبناء) |
| [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md) | تحليل الفجوات مقابل التوجيه v2 |
| [docs/adr/](docs/adr/README.md) | سجل القرارات المعمارية (ADR-001…007) |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | حالة المشروع وسجل الجلسات |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | البنية المعمارية وتصميم محرك الأسئلة |
| [docs/DATABASE.md](docs/DATABASE.md) | مخطط قاعدة البيانات والفهارس وخطة التوسع |
| [docs/API.md](docs/API.md) | واجهة REST تحت ‎`/api/v1` |
| [docs/SECURITY.md](docs/SECURITY.md) | المصادقة والصلاحيات ومكافحة الغش |
| [docs/TESTING.md](docs/TESTING.md) | استراتيجية الاختبارات وتشغيلها |
| [docs/LAUNCH.md](docs/LAUNCH.md) | **دليل الإطلاق خطوة بخطوة (ابدأ هنا)** |
| [docs/GATES.md](docs/GATES.md) | أدلة بوابات الإطلاق (46 بوابة) والفجوات المتبقية |
| [docs/STORE_SUBMISSION.md](docs/STORE_SUBMISSION.md) | **النشر على Google Play وApp Store (تطبيق Capacitor)** |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | النشر الإنتاجي الكامل والنسخ الاحتياطي |
| [docs/ROADMAP.md](docs/ROADMAP.md) | المراحل المنجزة وخطة المستقبل |

## ما يعمل في نسخة Pages وما يحتاج خادمًا

نسخة GitHub Pages ثابتة (Static)، لذا يستبدل التطبيق فيها الخادم بواجهة
داخل المتصفح (`web/src/demo/`) تشغّل **نفس محرك الأسئلة** المستخدم في الخادم:

**يعمل بالكامل بدون خادم:**
- اللعب الفعلي بجميع عائلات الأسئلة من بنك الأسئلة المدمج، مع التصحيح
  والنقاط والدرجات الجزئية.
- التصنيفات ومستويات الصعوبة، والواجهة العربية/الإنجليزية بالكامل.
- تقدّمك الشخصي (XP، المستوى، السلسلة اليومية، الإنجازات) محفوظ في
  localStorage على جهازك.

**يحتاج تشغيل الخادم وقاعدة البيانات (لا يظهر في نسخة Pages):**
- الحسابات الحقيقية وتسجيل الدخول، والتحقق من النتائج على الخادم.
- لوحات الصدارة المشتركة، التحديات بين اللاعبين، الأصدقاء، المجموعات،
  البطولات، والتحديات الشهرية.
- لوحة الإدارة، استيراد الأسئلة، والإشعارات.

لتشغيل النسخة الكاملة محليًا أو على خادمك (Node 20+ و PostgreSQL 16):

```bash
npm install
cp .env.example .env      # عبّئ DATABASE_URL و JWT_SECRET
npm run migrate && npm run seed
npm run dev               # API على :3001 والواجهة على :5173
```

التفاصيل الكاملة خطوة بخطوة في [README.en.md](README.en.md)
و[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## البدء السريع (10 دقائق)

المتطلبات: Node.js 20+ وnpm 10+ وPostgreSQL 16 (مع امتدادَي `citext` و`pg_trgm`).

1. ثبّت الاعتماديات:
   ```bash
   npm install
   ```
2. أنشئ قاعدة البيانات (كمستخدم postgres):
   ```bash
   createuser quiz -P
   createdb quiz_platform -O quiz
   psql -d quiz_platform -c 'CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;'
   ```
3. انسخ قالب البيئة وعبّئ `DATABASE_URL` و`JWT_SECRET` (ولّده بـ `openssl rand -hex 64`):
   ```bash
   cp .env.example .env
   ```
4. طبّق الترحيلات وابذر الحساب الإداري والتصنيفات وبنك الأسئلة:
   ```bash
   npm run migrate
   SEED_ADMIN_PASSWORD='ChangeMe123!' npm run seed
   ```
5. شغّل الخادم والواجهة معًا:
   ```bash
   npm run dev
   ```
6. تحقّق من الجاهزية:
   ```bash
   curl http://localhost:3001/ready
   ```

**علامة النجاح:** يعيد الأمر الأخير `{"ok":true,...}`، وعند فتح <http://localhost:5173> ترى شاشة **تسجيل الدخول** بالعربية مع زر **جرّب كزائر**. سجّل بالحساب `admin` وكلمة المرور التي مرّرتها للبذر لتصل إلى لوحة الإدارة.

## متغيرات البيئة

القالب الكامل في [.env.example](.env.example). الأهم:

| المتغير | مطلوب؟ | مثال | ماذا يكسر إن غاب |
|---|---|---|---|
| `DATABASE_URL` | نعم | `postgres://quiz:pw@localhost:5432/quiz_platform` | الخادم لا يقلع |
| `JWT_SECRET` | نعم في الإنتاج (≥ 32 حرفًا) | ناتج `openssl rand -hex 64` | رفض الإقلاع في الإنتاج؛ جلسات غير آمنة في التطوير |
| `PORT` / `HOST` | لا | `3001` / `0.0.0.0` | افتراضيات التطوير |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | لا | `900` / `2592000` (ثوانٍ) | 15 دقيقة / 30 يومًا |
| `BCRYPT_ROUNDS` | لا | `12` | كلفة تجزئة كلمات المرور |
| `CORS_ORIGIN` | نعم عند فصل الواجهة أو تطبيق المتاجر | `https://your-domain.com,https://localhost,capacitor://localhost` | الواجهة أو التطبيق لا يصلان إلى API |
| `APP_URL` | نعم لروابط البريد | `https://quiz.example.com` | روابط استعادة كلمة المرور معطوبة |
| `MAIL_PROVIDER` / `MAIL_API_KEY` / `MAIL_FROM` | لا (`log` في التطوير) | `resend` / `re_xxx` / `Quiz <no-reply@example.com>` | لا رسائل استعادة أو تأكيد بريد |
| `TRUST_PROXY` | نعم خلف Render/Fly/nginx | `1` | تحديد المعدل والسجلات تقرأ IP الوكيل |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX` | لا | `60000` / `120` / `10` | افتراضيات تحديد المعدل |
| `GUEST_MODE_ENABLED` / `GUEST_MAX_QUESTIONS` | لا | `true` / `10` | وضع الزائر |
| `JOBS_ENABLED` | لا | `true` | تعطيل المهام الخلفية (تحدٍّ شهري، انتهاء، احتفاظ، تذكيرات) |
| `SEED_ON_BOOT` / `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_QUESTIONS` | لا | `true` / `admin@example.com` / … | بذر أول تشغيل على الاستضافة |
| `METRICS_TOKEN` | لا | سلسلة عشوائية | `/metrics` غير موجود في الإنتاج بدونه |
| `ERROR_WEBHOOK_URL` / `SENTRY_DSN` | لا | رابط Discord/Slack | لا تنبيهات عند الأعطال |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` / `AI_DAILY_PER_USER` / `AI_DAILY_PLATFORM` | لا | `anthropic` / … / `20` / `500` | مسودات الذكاء الاصطناعي معطّلة |
| `BACKUP_DIR` / `RETENTION_DAYS` / `BACKUP_S3_URI` | لا (لـ`scripts/backup.sh`) | `./backups` / `14` / `s3://bucket/quiz` | نسخ احتياطي محلي فقط |
| `VITE_API_BASE` | لا (بناء الويب) | `https://api.example.com/api/v1` | الواجهة تفترض `/api/v1` على الأصل نفسه |
| `VITE_DEMO` / `VITE_BASE` | لا (بناء الويب) | `1` / `/quiz/` | نسخة Pages التجريبية ومسار النشر الفرعي |
| `VITE_SUPPORT_EMAIL` | لا (بناء الويب) | `support@example.com` | صفحتا المساعدة وحذف الحساب بلا بريد تواصل |

## نشر النسخة الكاملة (الخادم + قاعدة البيانات)

بأمر واحد على أي خادم: `docker compose up -d --build` (ملفات `Dockerfile` و
`docker-compose.yml` جاهزة)، أو بضغطة زر على **Render** (`render.yaml`)،
أو **Fly.io** (`fly.toml`)، أو **Railway**، أو الصورة الجاهزة
`ghcr.io/daood40/quiz:latest`. أول تشغيل تلقائي بالكامل (`SEED_ON_BOOT=true`):
ترحيلات + مدير + تصنيفات + بنك 154 سؤالًا. الخطوات كاملة في
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

لتحويل موقع Pages من Demo إلى التطبيق الكامل: أضف متغير المستودع
`VITE_API_BASE = https://<api-host>/api/v1` في إعدادات Actions، وسيُبنى
تلقائيًا مع النشر التالي.

## النشر التلقائي

- **‎.github/workflows/pages.yml** — مع كل push على الفرع الافتراضي يبني
  الواجهة بوضع Demo (بـ `VITE_DEMO=1` ومسار أساس `‎/quiz/‎` ليطابق
  `daood40.github.io/quiz/`) ثم ينشرها على GitHub Pages تلقائيًا.
- **‎.github/workflows/ci.yml** — مع كل push يشغّل فحص الأنواع والاختبارات
  (119 اختبارًا على PostgreSQL حقيقية) والبناء الكامل ودخان E2E بـ Playwright.
- **‎.github/workflows/docker.yml** — يبني صورة الإنتاج وينشرها على GHCR
  (`latest` مع كل push، و`vX.Y.Z` مع كل وسم) بعد تشغيلها فعليًا مع PostgreSQL.
- **‎.github/workflows/release.yml** — أي وسم `v*` ينشئ إصدار GitHub بملاحظات
  من `CHANGELOG.md`.

## بنية المستودع

```
server/            واجهة Fastify API (وحدة لكل مجال)، ترحيلات SQL، بذور، اختبارات
web/               تطبيق React (الصفحات، عارض لكل عائلة أسئلة، الترجمة، السمات)
web/src/demo/      الواجهة الخلفية داخل المتصفح لنسخة GitHub Pages
docs/              التوثيق الكامل (بنية، قاعدة بيانات، أمان، نشر…)
.env.example       قالب متغيرات البيئة (بدون أسرار حقيقية)
```

## المشاكل المعروفة والمتبقي

من `memory/TODO.md` (2026-09-09):

- **يمنع الإصدار على المتاجر (P0):** الخادم غير منشور بعد على Render (`render.yaml`) ولم يُضبط `CORS_ORIGIN` ليشمل `https://localhost,capacitor://localhost`؛ متغيرات GitHub `MOBILE_API_BASE` و`SUPPORT_EMAIL` غير مضبوطة؛ أسرار التوقيع `ANDROID_KEYSTORE_*` و`IOS_*` غير موجودة؛ لا حسابات Google Play/Apple Developer ولا حساب تجريبي للمراجعين؛ لقطات المتجر غير جاهزة.
- **بعد الإصدار (P1):** لا اختبار حمل على `/api/v1/attempts` بعد؛ مقاييس الاحتفاظ D1/D7 من جدول `analytics_events` غير مبنية؛ لا إشعارات Push (FCM/APNs) — التذكير الحالي محلي على الجهاز؛ digest صورة node في `Dockerfile` غير مثبّت.
- **لاحقًا (P2):** لا MFA ولا تسجيل دخول بطرف ثالث؛ لا CAPTCHA عند التسجيل؛ محدّد المعدل في الذاكرة (يحتاج Redis عند أكثر من نسخة خادم)؛ 111 نمطًا مضمّنًا تُبقي `style-src 'unsafe-inline'` في CSP.
- **تشغيلي:** `fastify-static` يسجّل ملفات `dist` عند الإقلاع، فابنِ الواجهة قبل تشغيل الخادم وأعد تشغيله بعد كل بناء.

## الترخيص

لا يوجد ملف `LICENSE` في المستودع بعد؛ على مالك المشروع اختيار ترخيص (مثل MIT أو AGPL-3.0) وإضافته قبل النشر العام أو رفع التطبيق للمتاجر — Apple تطلب ألا يتعارض الترخيص مع شروطها.
