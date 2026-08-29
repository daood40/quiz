# تقرير التدقيق الشامل — QUIZ (توجيه التحويل الاحترافي)

**التاريخ:** 2026-08-28 · **المرجعان:** توجيه التحويل الاحترافي +
[QUIZ_MASTER_DIRECTIVE_v2.md](QUIZ_MASTER_DIRECTIVE_v2.md) ·
**المنهج:** فحص كود + تشغيل فعلي بمتصفح Chromium (جوال 375px وسطح مكتب،
عربي وإنجليزي) على نسخة مطابقة للمنشور.

## خلاصة تنفيذية

**الحقيقة الأهم:** ما يظهر على `daood40.github.io/quiz/` هو **نسخة Demo
ثابتة فقط**. المستودع يحوي أصلًا منصة كاملة Production-grade (خادم Fastify +
PostgreSQL بتحكيم خادمي كامل، 80 نوع سؤال، لوحات صدارة، مسابقة شهرية،
إدارة، مكافحة غش، 81 اختبارًا آليًا خضراء). التحويل المطلوب ليس إعادة بناء،
بل: (1) سد فجوات محددة وجدها هذا التدقيق، و(2) **نشر الخادم** — وهو الفاصل
الحقيقي بين "صفحة أسئلة" و"منصة".

---

## 1) Product Audit

| تدفق | الحالة | ملاحظات |
|---|---|---|
| Start Flow | ✅ | ضيف فوري أو حساب؛ زر Quick Quiz بارز |
| Quiz Flow | ✅ | وضع تركيز بملء الشاشة، تقدم، مؤقت، Powerups (50/50، تمديد وقت) |
| Answer Flow | ✅ | Feedback فوري (صح/خطأ/شرح) في الأوضاع الذاتية؛ مؤجل في التنافسي |
| Result Flow | ✅ | Score/Correct/Wrong/Timeout/Accuracy/Time + مراجعة الإجابات |
| Ranking Flow | ✅ (خادم) | Daily/Weekly/Monthly/All-time/فئة/دولة/أصدقاء + إبراز المستخدم؛ الـ Demo يخفيها |
| Profile Flow | ✅ | نقاط/رتبة/دقة/سلاسل/إنجازات/سجل |
| Challenge Flow | ✅ (خادم) | تحديات برموز + شهرية تلقائية + بطولات؛ غير متاحة في الـ Demo |
| **احتكاكات وُجدت** | 🔶 | (أ) هيدر الجوال يفيض أفقيًا ~52px؛ (ب) عارض الكلمات المتقاطعة بدائي؛ (ج) فاصلة لاتينية في تحية العربية |

## 2) UI Audit
نظام تصميم موحد موجود فعلًا (`web/src/styles.css`): Tokens للألوان
والمسافات والظلال، فاتح/داكن، بطاقات/أزرار/حوارات/شارات موحدة، Skeletons.
**العيوب:** overflow الهيدر على الجوال (السبب: `.topbar nav` عنصر flex بلا
`min-width:0`)، وعارض `grid` (الكلمات المتقاطعة) نصّي غير تفاعلي.

## 3) UX Audit
التدفق الأساسي سلس (زيارة → لعب خلال نقرتين). Feedback واضح بأيقونات
ولون. حالات Error/Empty/Offline مغطاة في API client (retry/backoff).
**فجوة UX الوحيدة الجوهرية:** تجربة الكلمات المتقاطعة (النوع الرابع المطلوب
في التوجيه) لا ترقى للمستوى — ستُبنى شبكة تفاعلية.

## 4) Technical Audit
TypeScript صارم في الطرفين، Monorepo workspaces، ESM. لا أخطاء Console
(فحص متصفح فعلي). البناء 1.2s، الحزم: vendor 165KB + app 95KB + demo
81KB (gzip ~100KB إجمالًا) — ضمن الحدود الصحية. CI: typecheck + 81
اختبارًا على PostgreSQL حقيقية + build + `npm audit` — أخضر.

## 5) Architecture Audit
الفصل المطلوب في التوجيه **موجود فعلًا**: Question Engine (registry + 13
عائلة نقية بلا I/O) / Quiz Engine (pool/attempts) / Scoring / Timer خادمي /
Leaderboards / Auth (JWT + refresh دوّار + RBAC) / DB / API / Analytics /
Notifications / UI. إضافة نوع سؤال = سطر تسجيل. راجع
[ARCHITECTURE.md](ARCHITECTURE.md) و[adr/](adr/README.md).

## 6) Database Audit
PostgreSQL 16، UUID، FKs، فهارس مركبة (تصنيف/صعوبة/لغة/حالة)، الجداول
المطلوبة كلها موجودة (users/questions/categories/attempts/responses/
scores/leaderboards/challenges/achievements/notifications/analytics).
**الأسئلة في القاعدة حصرًا** — الواجهة تستلم أسئلة معقّمة صفحةً صفحة.
البنية تتحمل 120k+ سؤال الآن؛ خطة المليون (Partitioning) موثقة في
[DATABASE.md](DATABASE.md). *(الـ Demo وحده يحمل بنك 115 سؤالًا مدمجًا —
مقبول لأنه Demo بلا خادم بقرار ADR-006.)*

## 7) Security Audit
- ✅ الإجابة الصحيحة لا تغادر الخادم قبل التصحيح (`present()` يعقّم).
- ✅ Score/Timer خادميان حصرًا؛ Idempotency؛ رفض سؤال أجنبي؛ رصد الإجابة
  الأسرع من الطبيعي؛ `late_submit` مع Grace مضبوطة (3s).
- ✅ Rate limiting، سجل تدقيق، فلاتر إدخال (zod)، لا أسرار في العميل.
- 🔶 **ثغرة عدالة وُجدت:** وضع practice/review يضخ نقاطه في
  `total_points` ولوحات الصدارة عند الإرسال — مخالف لقاعدة "لا نقاط
  تنافسية من التدريب". **ستُصلح في هذه الجلسة.**
- ✅ `npm audit --audit-level=high` نظيف (رُقّي @fastify/static سابقًا).

## 8) Performance Audit
Keyset pagination، كاش لوحات بـ TTL وإبطال عند الكتابة، فهارس، حزم صغيرة،
خطوط بتحميل غير معطِّل. لم يُقس الحمل (10k جلسة) بعد — بند مرحلة لاحقة.

## 9) Missing Features (فعليًا)
1. تجربة كلمات متقاطعة تفاعلية (النوع مدعوم محركيًا، الواجهة بدائية).
2. مكافأة سلسلة داخل الجولة + سقف يومي + تثبيط الأسئلة غير المستقرة (§16).
3. عزل نقاط التدريب عن التنافس (البند الأمني أعلاه).
4. لاحقًا (موثق في [GAP_ANALYSIS.md](GAP_ANALYSIS.md)): خصوصية الملف،
   pgvector دلالي، Push، دفع، Load testing، إرجاع نقاط سؤال خاطئ.

## 10) Technical Debt
منخفض. أبرز بنوده: نسختا محرك (server + demo) تُزامنان يدويًا؛ `correct_answer`
عمود لا جدول منفصل (مقبول ومبرر في ADR-004)؛ scheduler داخل العملية.

## 11) Skills Found
من مكتبة المهارات المتاحة، ذات الصلة: `web-accessibility`,
`responsive-design`, `css-layout`, `flexbox`, `javascript-testing`,
`typescript-strict-mode`, `web-security-basics`, `xss-prevention`,
`web-performance`, `frontend-routing`, `browser-storage`, `security-review`,
`code-review`.

## 12) Skills Used
`web-accessibility` (حُمّلت لواجهة الكلمات المتقاطعة)؛ ومنهجيات
البقية مطبقة ضمن الفحص (استجابة، أداء، أمان). لا توجد مهارة متخصصة
بمنصات المسابقات/الترتيب — بُني ذلك على التوجيهين مباشرة.

## 13) Proposed Architecture
**الإبقاء على المعمارية القائمة** (مطابقة لمتطلب الفصل في التوجيه) مع
التعديلات الجراحية: streak/cap/damping داخل مسار التصحيح الخادمي،
وgate تنافسي في `submitAttempt`، وعارض crossword جديد في طبقة العرض فقط.
القرارات السبعة المعتمدة في [adr/](adr/README.md) تبقى سارية.

## 14) Proposed Database
لا تغيير مخطط الآن (الكل موجود). التغييرات القادمة عند الحاجة موثقة:
`question_answer_keys`، `privacy_settings`، `question_embeddings`،
Partitioning للإجابات — انظر GAP_ANALYSIS §2.

## 15) Complete Roadmap
مراحل التوجيه 0–18: **المراحل 1–9 و11–13 منجزة** في الكود القائم
(Architecture/Design System/Auth/Engines/Scoring/Timer/Results/
Leaderboard/Profile/Gamification/Admin). المتبقي مرتب في
[ROADMAP.md](ROADMAP.md) قسم "directive alignment": حزمة النقاط ثم
الخصوصية ثم pgvector/Push/دفع ثم Load+Monitoring، و**النشر الإنتاجي
للخادم** كقرار مفصلي (انظر «المخاطر»).

## 16) Testing Plan
القائم: 81 اختبارًا (محرك + تكامل على PG حقيقية: مهلات، إرسال مزدوج،
أسئلة أجنبية، بطولات، 50/50) + فحص E2E متصفحي. **يُضاف في هذه الجلسة:**
اختبارات streak bonus/سقف يومي/تثبيط، واختبار عزل practice عن الترتيب،
وفحص متصفحي للكلمات المتقاطعة والجوال. القادم: Register/Login E2E على
خادم حي، وLoad 10k.

## 17) Risks
1. **الأكبر:** بقاء المنتج بلا خادم منشور = يبقى Demo. القرار المطلوب من
   المالك: مزود استضافة (Fly/Railway/Render/VPS) + PostgreSQL مُدار.
2. تعارض النسختين (محرك demo/خادم) عند التطوير السريع — يخفف بالمزامنة
   المنضبطة واختبارات الطرفين.
3. المحتوى: بنك الـ Demo متحيز للحساب (61/115 calculation) — يحتاج تحرير
   محتوى، لا كود.
4. سقف النقاط اليومي default=0 (معطل) حتى يقرر المالك قيمته — الآلية
   ستكون جاهزة ومختبرة.

## 18) Definition of Done (لهذه الدفعة) — التحقق النهائي
- [x] لا overflow أفقي على 375px في كل الشاشات (قيس = 0 بعد الإصلاح).
- [x] كلمات متقاطعة تفاعلية: شبكة قابلة للنقر والكتابة بلوحة المفاتيح،
      أدلة أفقي/رأسي، RTL سليم، أسئلة AR+EN في الـ Demo — لُعبت فعليًا
      في الفحص المتصفحي وصُحّحت "إجابة صحيحة".
- [x] النقاط: streak bonus داخل الجولة + سقف يومي (آلية) + تثبيط
      الأسئلة < 200 إجابة — settings-driven وباختبارات وحدات وتكامل.
- [x] practice/review لا يمسان الترتيب التنافسي — باختبار تكامل.
- [x] Typecheck + الاختبارات + البناء خضراء محليًا؛ CI يشغّل اختبارات
      التكامل على PostgreSQL حقيقية.
- [x] لا أخطاء Console في فحص المتصفح النهائي.
