# بوابة الإطلاق — تقرير qa-production-readiness

الإصدار المفحوص: فرع `claude/quiz-platform-setup-fsywh2` بعد تمرير 121 مهارة (2026-09-09).
نوع الإصدار: إصدار كبير (كل البوابات كاملة). القرار للمالك البشري وحده؛ هذا التقرير أدلة وتصنيف لا قرار.

| # | البوابة | الحالة | الدليل |
|---|---|---|---|
| 1 | البناء | PASS | `npm run build` محليًا: server tsc + vite (index 110 kB / vendor 165 kB gz 54 kB)؛ CI `ci.yml` أخضر على 724db14 (قبل هذه الدفعة)، ويُعاد على الدفعة الحالية عند الدفع |
| 2 | التحليل الساكن | PASS | `npm run lint` = tsc(server) + tsc(web) + eslint(server/src, web/src, server/test): 0 أخطاء |
| 3 | اختبارات الوحدة | PASS | `vitest run`: 153/153 (engine 41، unit 19، migrate 2، mail 3، ai 3، ai-eval 17، rbac 3، hardening 18، integration، batch-c 9) |
| 4 | اختبارات الواجهة | PASS | دخان Playwright على بناء Demo (`VITE_DEMO=1 VITE_BASE=/quiz/`): 17/17 بما فيها axe (0 مخالفات serious/critical) على AR جوال وEN سطح مكتب |
| 5 | اختبارات التكامل | PASS | E2E كامل (API + PostgreSQL + متصفح): تسجيل → جولة موقّتة → صدارة → إدارة: 11/11 |
| 6 | اختبارات API | PASS | hardening + batch-c + rbac: معرّفات مشوّهة 400/404، ترقيم فاسد 200، صلاحيات الإدارة/المشرف، ملكية المحاولات، قفل الدخول 429، إعادة استخدام refresh 401 + إبطال الكل |
| 7 | الفحص الأمني | PASS | gitleaks في CI؛ CSP `default-src 'none'` للـAPI؛ لا كوكيز؛ `/metrics` مغلق في الإنتاج بلا رمز؛ 414 بلا صدى للرابط؛ أعطال QA BUG-001…011 مغلقة (memory/FIXES.md) |
| 8 | فحص الأداء | NOT RUN | لا اختبار حمل (k6) بعد — TODO P1. القياسات المتوفرة: LCP/CLS من دفعة 2026-09-08 في `docs/GATES.md` §20 |
| 9 | فحص قاعدة البيانات | PASS | 7 ترحيلات تُطبَّق من الصفر في `migrate.test.ts` مع فحص checksum؛ قيود: فهرس `lower(username)` فريد، `pg_advisory_xact_lock` للحصة، `lock_timeout 5s`. RLS: غير منطبق (لا وصول مباشر للعميل؛ كل الاستعلامات عبر الخادم بمعرّف المستخدم من JWT) |
| 10 | اختبار الشبكة | PASS (جزئي) | فشل الشبكة أثناء تحديث الجلسة يُبقي الجلسة ويعرض بطاقة إعادة محاولة (ctx.tsx)؛ مهلة 15 ثانية؛ PWA offline shell. سيناريو 15 دقيقة على جهاز حقيقي: NOT RUN |
| 11 | إعدادات الإنتاج | PASS | `render.yaml`/`fly.toml` على `/ready`؛ `NODE_ENV=production` يفرض `DATABASE_URL`/`JWT_SECRET`/`CORS_ORIGIN`؛ `MOBILE_API_BASE` متغيّر مستودع؛ لا عنوان تطوير في الحزمة (`grep localhost web/dist` = 0 خارج تعليقات SW) |
| 12 | الأسرار | PASS | gitleaks job في `ci.yml`؛ `.gitignore` يمنع `.env.*`, `*.jks`, `*.p12`, `*.pem`; `.claude/settings.json` يمنع قراءة ملفات المفاتيح؛ `grep -rn "sk-\|AKIA" web/ .github/` = 0 |
| 13 | حزمة الإصدار على جهاز حقيقي | NOT RUN | AAB/APK يُبنى في CI (`mobile.yml` #3 أخضر) لكن غير موقّع ولم يُثبَّت على جهاز — يحتاج أسرار التوقيع + جهاز (TODO P0) |
| 14 | تقارير الأعطال | PASS (جزئي) | `reportError()` + عدّاد `errors5xx` + `/metrics`؛ `ErrorBoundary` في الواجهة. لوحة خارجية (Sentry) غير مضبوطة → عطل تجريبي لم يصل لأي لوحة |
| 15 | النسخ الاحتياطي | PASS | `restore-drill` job في CI يستعيد نسخة فعلية ويتحقق من عدد الصفوف؛ `scripts/backup.sh` يرفض التشغيل غير المحمي في الإنتاج |
| 16 | مفتاح إيقاف عن بُعد | PASS | `app_settings`: `maintenanceMode` (403 لبدء الاختبار)، `aiEnabled` (503 `ai_disabled`)، `guestModeEnabled`، حدود يومية — كلها من لوحة الإدارة بلا نشر؛ مُختبَرة في vitest (ai.test, integration) |
| 17 | الخصوصية ونموذج سلامة البيانات | PASS | `/privacy`, `/terms`, `/delete-account` بأرقام الاحتفاظ من الكود (180/400/30/14 يومًا)؛ نموذج Play Data Safety في `docs/STORE_SUBMISSION.md` §2ج يطابق ما يُجمع (بريد، اسم، IP في سجل التدقيق) |

## القرار المقترح
**FAIL** (ليس BLOCKED): البوابات 8 و13 NOT RUN وتُحسبان FAIL. ما ينقصهما خارج الكود لكنه ليس خارج المنتج: اختبار حمل يُشغَّل من الحاوية بعد نشر الخادم، وجهاز حقيقي بعد أسرار التوقيع (TODO P0). كل ما يمكن تشغيله في هذه البيئة PASS.

## ما يرفع القرار إلى PASS
1. نشر الخادم (Render) → k6 على `/api/v1/quizzes/start` و`/attempts/:id/answer` بـ100 مستخدم متزامن، توثيق p95 < 300ms → البوابة 8.
2. أسرار `ANDROID_KEYSTORE_*` → تنزيل AAB الموقّع من Mobile workflow → تثبيت على هاتف Android حقيقي → رحلة كاملة + لقطات → البوابة 13.
3. (اختياري) DSN لخدمة أعطال خارجية عبر `SENTRY_DSN` إن أُريد سدّ البوابة 14 كليًا.

## أوامر التحقق المُشغَّلة (2026-09-09)
```
npm run lint
DATABASE_URL_TEST=postgres://…/quiz_platform_test npx vitest run
npm run build
BASE_URL=http://127.0.0.1:3002 node web/e2e/fullstack.mjs
VITE_DEMO=1 VITE_BASE=/quiz/ npm run build --workspace=web && npm run e2e --workspace=web
```
