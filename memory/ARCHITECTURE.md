# memory/ARCHITECTURE.md   (آخر تحديث: 2026-09-09)
## الطبقات (web): pages/ → components/ → api.ts (fetch + JWT refresh) → الخادم، أو demo/demoApi.ts عند VITE_DEMO=1 (محرّك داخل المتصفح). الصفحة لا تنادي fetch مباشرة.
## الطبقات (server): app.ts (أمان/CORS/CSP/ثابت) → modules/<domain>/routes.ts (zod) → service.ts → db/pool.ts. المحرّك الحاكم للإجابات في modules/questions/engine (13 عائلة، 80 نوعًا) — الخادم هو مصدر الحقيقة للنقاط.
## المجلدات: server/src/{core,db,modules,plugins} · web/src/{pages,demo,components.tsx,api.ts,native.ts,i18n.tsx,styles.css} · web/android, web/ios (Capacitor) · docs/ · memory/ · .claude/skills/
## تدفّق البيانات: المستخدم → API (Bearer JWT 15 دقيقة + refresh مُدوَّر في localStorage) → PostgreSQL. الترحيلات في server/src/db/migrations بأقفال + بصمة sha256. البذر عند الإقلاع (SEED_ON_BOOT).
## التطبيق الأصلي: نفس حزمة الويب داخل WebView؛ الجسر في web/src/native.ts (كل دالة لا تفعل شيئًا على الويب). الأصل https://localhost / capacitor://localhost → يجب في CORS_ORIGIN.
## ممنوع: مفاتيح سرّية في web/؛ فرض صلاحيات في الواجهة فقط؛ نص ظاهر خارج i18n.tsx؛ خصائص CSS فيزيائية (left/right) — استخدم المنطقية؛ الوصول لـlocalStorage بلا storageGet/storageSet.
## قيد تشغيلي: fastify-static يسجّل ملفات dist عند الإقلاع → ابنِ الويب قبل تشغيل الخادم، وأعد التشغيل بعد أي بناء.
