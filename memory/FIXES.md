# memory/FIXES.md   (الأحدث في الأعلى)
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
