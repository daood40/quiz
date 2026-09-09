# memory/FIXES.md   (الأحدث في الأعلى)
## 2026-09-09 — CI #34/#35: e2e وfullstack وrestore-drill تفشل معًا
العَرَض: `apt-get update` ينتهي بـ`Hash Sum mismatch` من dl.google.com فيفشل `playwright install --with-deps` وتثبيت psql.
السبب الجذري: صورة الـrunner تحمل مصدر apt لـGoogle Chrome معطوبًا لحظيًا؛ خارج المشروع.
الحل: حذف `/etc/apt/sources.list.d/google*.list` قبل أي apt في الوظائف الثلاث. الملف: .github/workflows/ci.yml
الوقاية: أي وظيفة تستدعي apt تحذف مصادر الطرف الثالث غير المطلوبة أولًا.
## 2026-09-09 — E2E يفشل بعد إعادة كتابة التسميات
العَرَض: `getByRole('button', {name: /Start Quiz/})` مهلة 30 ثانية.
السبب الجذري: التسميات الإنجليزية صارت sentence case ("Start quiz") وزر الإجابة صار "Confirm answer"، والدخان يحتاج بناء Demo بـ`VITE_BASE=/quiz/`.
الحل: محدّدات غير حساسة للحالة تقبل الاسمين + فحص `aria-disabled` للأسئلة المركّبة. الملفات: web/e2e/{smoke,fullstack}.mjs
الوقاية: عند تغيير نص زر أساسي ابحث عنه في web/e2e أولًا.
## 2026-09-09 — 414 بلا غلاف الخطأ الموحّد
العَرَض: مسار أطول من 100 حرف يعيد JSON بصيغة Fastify الافتراضية ويردّد الرابط كاملًا.
السبب الجذري: أخطاء الموجّه (FST_ERR_MAX_PARAM_LENGTH) لا تمر عبر setErrorHandler.
الحل: خيار `frameworkErrors` يكتب `{error:{code:'uri_too_long'}}` بلا صدى للرابط. الملف: server/src/app.ts
الوقاية: اختبر `/api/v1/x/<300 حرف>` ضمن اختبارات التصلّب.
## 2026-09-09 — معرّفات مشوّهة تعطي 500
العَرَض: `GET /tournaments/not-a-uuid` وأمثاله → خطأ تحويل PostgreSQL (500).
السبب الجذري: 12 مسارًا تقرأ `req.params.id` بلا تحقق.
الحل: `uuidParam()` في كل مسار؛ `isUuid()` + 404 حيث لا يجوز كشف الوجود (التحديات، حذف الأسئلة). الملفات: modules/{tournaments,monthly,groups,challenges,quizzes,admin}/*.ts
الوقاية: لا تقرأ `req.params` مباشرة؛ استخدم `uuidParam`.
## 2026-09-09 — `limit=abc` يسقط الاستعلام
العَرَض: `Number('abc')` = NaN يصل إلى SQL.
الحل: `intQuery(value, fallback, min, max)` في core/validate.ts في 10 مواضع ترقيم.
الوقاية: كل معامل رقمي من query عبر `intQuery`.
## 2026-09-09 — بيانات شخصية تبقى بعد حذف الحساب
العَرَض: اسم المستخدم القديم في `leaderboard_snapshots.entries` و IP في `audit_logs`، وعلامات/أصدقاء/إشعارات باقية.
الحل: `deleteAccount` يحذف 8 جداول تابعة ويمسح IP ويُبدّل الاسم داخل اللقطات. الملف: modules/auth/service.ts
الوقاية: أي جدول جديد يحمل user_id يُضاف إلى قائمة الحذف في `deleteAccount`.
## 2026-09-09 — `resumeAttempt` غير موجودة (تعديل آلي مكسور)
العَرَض: فشل tsc بعد دفعة تعديلات بسكربت.
السبب الجذري: سكربت التعديل أدخل استدعاءً لدالة لم تُكتب بعد.
الحل: كتابة `resumeAttempt` في quizzes/attempts.ts وحصر الاختصار في solo.
الوقاية: `tsc --noEmit` بعد كل سكربت تعديل قبل المتابعة.
## 2026-09-09 — Android build: "Value is null" في build.gradle
العَرَض: فشل gradle عند تقييم app/build.gradle سطر versionCode.
السبب الجذري: Groovy يفسّر `versionCode (x ?: y).toInteger()` كاستدعاء دالة ثم `.toInteger()` على null.
الحل: صيغة `versionCode = (...)`. الملف: web/android/app/build.gradle · commit: 7fac407
الوقاية: في Gradle Groovy استخدم `=` مع التعبيرات المركّبة دائمًا.
## 2026-09-09 — mobile.yml يفشل فورًا بلا وظائف
العَرَض: التشغيل ينتهي بـfailure في نفس الثانية.
السبب الجذري: سياق `secrets` غير مسموح في `if` على مستوى الخطوة.
الحل: علم في env الوظيفة `HAS_*: ${{ secrets.X != '' }}` ثم `if: env.HAS_* == 'true'`. الملف: .github/workflows/mobile.yml · commit: c44889a
الوقاية: `actionlint` قبل الدفع (مثبّت محليًا).
## 2026-09-08 — تذبذب دخان E2E "practice feedback appears"
العَرَض: فشل عشوائي في CI فقط.
السبب الجذري: ثلثا بنك Demo أسئلة نصية؛ الاختبار كان يتخطى 6 مرات بحثًا عن اختيار.
الحل: الاختبار يجيب النصوص أيضًا (`42`) ويحاول 10 مرات. الملف: web/e2e/smoke.mjs · commit: 4babee6
الوقاية: لا تعتمد اختبارات E2E على نوع سؤال عشوائي.
## 2026-09-08 — تباين الوضع الفاتح دون AA
العَرَض: axe: 200+ عقدة color-contrast.
السبب الجذري: رموز text-2/primary/success/warn/danger فاتحة على الأسطح الثانوية، وبطاقات الإنجازات المقفلة بشفافية 0.55.
الحل: رموز أغمق محسوبة ≥4.5:1؛ التعتيم على الأيقونة فقط. الملف: web/src/styles.css, pages/profile.tsx · commit: b355937
الوقاية: احسب التباين بالسكربت قبل تغيير أي رمز؛ axe في دخان CI.
## 2026-09-04 — TS2349 في users/routes.ts
العَرَض: `audit` غير قابل للاستدعاء.
السبب الجذري: متغيّر مفكوك من Promise.all باسم `audit` حجب الدالة المستوردة.
الحل: إعادة التسمية `activityLog`. commit: 5c2ac4d
الوقاية: لا تسمِّ نتائج الاستعلامات بأسماء الدوال المستوردة.
