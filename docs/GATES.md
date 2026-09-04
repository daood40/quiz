# بوابات الجودة — Evidence Report (MASTER APP DEVELOPMENT CHECKLIST)

> المرجع: القائمة الشاملة ذات 46 قسمًا. هذه الوثيقة تُنتج **دليلًا** لكل بوابة، لا مجرد PASS.
> الحالة: **PASS** = مُنفَّذ ومُثبت بأرقام/ملفات · **PARTIAL** = منفَّذ جزئيًا مع ما ينقص · **N/A** = لا ينطبق على هذا المنتج (ويب/PWA لا Flutter) · **TODO** = مؤجل بقرار موثّق.
> آخر تشغيل للأدلة: 2026-09-04 · الفرع `claude/quiz-platform-setup-fsywh2` · الإصدار 1.1.0.

## ملخص الأرقام (مُولَّدة من الكود)

| المقياس | القيمة | المصدر |
|---|---|---|
| الاختبارات الآلية | **119** (محرك 35، تكامل 39، وحدات 17، تصليب 17، RBAC/Power-ups 3، AI 3، بريد 3، ترحيلات 2) | `server/test/*.test.ts` |
| E2E في CI | دخان Demo (جوال عربي + سطح مكتب) + كامل (API + PostgreSQL + متصفح) | `.github/workflows/ci.yml` (jobs: test, e2e, fullstack, restore-drill) |
| نقاط النهاية | 98 | `server/src/modules/**/routes.ts` |
| الجداول / الترحيلات | 39 / 6 (بـ checksum وقفل Advisory) | `server/src/db/migrations` |
| أنواع الأسئلة | 80 على 13 عائلة | `engine/registry.ts` |
| مفاتيح الترجمة | 343 (AR/EN متطابقة 100%) | `web/src/i18n.tsx` |
| Typecheck + ESLint | 0 أخطاء | `npm run lint` |
| ثغرات التبعيات (high+) | 0 | `npm audit --omit=dev` في CI |

---

## 01 Product Discovery & Strategy — PASS
- التعريف/القيمة/الفئة/المسار/النطاق: `docs/QUIZ_MASTER_DIRECTIVE_v2.md`, `docs/MARKET.md`.
- تحليل 100 منافس + المشاكل وحلولها: `docs/COMPETITOR_ANALYSIS.md`.
- المتطلبات الوظيفية/غير الوظيفية/قواعد العمل/الحالات الحدية: التوجيه v2 + `docs/GAP_ANALYSIS.md` (Keep/Modify/New).
- MVP/V1/V2: `docs/ROADMAP.md`؛ V1.0 أُطلق، V1.1 (هذه الدورة)، V1.2 مؤجلات موثقة.

## 02 Product Architecture — PASS
- Modular Monolith بقرار مُسبَّب (ADR-002)؛ الطبقات: SPA → `/api/v1` → Services → PostgreSQL؛ Jobs داخل العملية بأقفال Advisory (قابلة للنقل إلى Worker).
- بنى فرعية موثقة: Auth/Authz/Storage(N/A الآن)/Notifications(داخل التطبيق + بريد)/Payments(مجرد، مؤجل)/Analytics/Search(trigram)/Caching(Snapshots + إعدادات + تصنيفات)/Queue(Jobs)/Integrations: `docs/ARCHITECTURE.md`, `docs/MASTER_PLAN.md`, `docs/adr/`.

## 03 UX Research & User Experience — PASS
- IA/Navigation/Flows: التبويبات السفلية، Onboarding tip، Register/Login/Recovery/Verify، Error Journeys.
- الحالات: Loading/Empty/Error+Retry في كل شاشة (`useAsync` + `ErrorState`)، Offline banner، Permission (403 مترجم)، Success (Toasts/Confetti).
- الدليل: `docs/PRODUCT_AUDIT.md` (18 قسمًا) + E2E الجوال (تجاوز أفقي = 0px على 360/375/390).

## 04 UI/UX Design System — PASS
- Tokens (ألوان/خط/مسافات/زوايا/ظلال/Elevation) في `web/src/styles.css`؛ فاتح/داكن؛ RTL/LTR بخصائص منطقية.
- المكونات وحالاتها: Default/Hover/Focus-visible (مميّز عن Selected)/Pressed/Disabled/Loading/Error/Empty.
- Responsive: جوال/تابلت/سطح مكتب (E2E)؛ Accessibility: Labels مرتبطة، أسماء للأزرار الأيقونية، Radiogroup للخيارات، Hotspot بلوحة المفاتيح، Skip-link، Reduced motion، أهداف لمس ≥44px.

## 05 Frontend (Web / PWA) — PASS (Flutter: N/A في هذا الإصدار)
- بنية: صفحات/مكونات/hooks/API layer/Demo backend؛ Lazy routes للإدارة والاجتماعي؛ حماية النقر المزدوج (`useAction`).
- State: Loading/Error/Success/Cache (registry cache مع إعادة محاولة)/Persistence (localStorage للتفضيلات).
- Navigation: Router + Guards + Deep links (`/forgot?token`, `/verify?token`, `/review/:id`).
- PWA: Manifest + SW آمن (لا يخزّن 5xx) + نسخة مُختومة بالبناء + إشعار تحديث. Flutter/تصاريح الجهاز: N/A.

## 06 Backend — PASS
- Fastify + طبقات Routes/Services/Engine؛ zod على كل Body؛ UUID على المعاملات؛ Transactions (submit، استرداد، استيراد)؛ Jobs مجدولة؛ Webhooks خارجية للتنبيهات؛ بريد.
- API: REST مُصدَّر `/api/v1`؛ ترقيم/فلترة/ترتيب/بحث؛ Rate limiting (عام/Auth/Start/Report)؛ Idempotency للإجابات (uq + 409)؛ Timeout خادمي؛ رموز أخطاء موحدة `{error:{code,message,requestId}}`؛ التوثيق `docs/API.md`.
- Retry في العميل لطلبات GET فقط (لا تكرار للمعدِّلات).

## 07 Database Engineering — PASS
- Schema: PK/FK/Unique/Check/Defaults؛ 17 فهرس FK مضافة (004)؛ Pooling؛ حدود على كل قائمة.
- Reliability: معاملات، تزامن (advisory locks، `ON CONFLICT`)، ترحيلات إضافية بـ checksum، نسخ + استعادة مُختبرة في CI (`restore-drill`)، PITR عبر المزود المُدار.
- Lifecycle: `updated_at` بـ Trigger، Soft delete (أرشفة/`deleted_at`/تجهيل الحساب)، Retention job، Export (`GET /users/me/export`)، حذف الحساب.

## 08 Authentication — PASS / TODO(MFA, OAuth)
- Sign up/Login/Logout/Verification/Reset/Sessions/Refresh دوّار/Expiry/Lockout/Multi-device (رموز لكل جهاز + إلغاء الكل)/إبطال فوري.
- TODO موثق: OAuth/Social، MFA، Biometrics (يتطلب مزودًا وقرارًا).

## 09 Authorization — PASS
- 5 أدوار بتسلسل، فحص خادمي على كل مسار إدارة، Ownership على المحاولات/التحديات/المجموعات/الإشارات، حماية التصعيد (لا ترقية ذاتية، super_admin وحده يمنح admin). اختبارات: `hardening`, `rbac-powerups`, `integration`.

## 10 Security Engineering — PASS
- Input validation، Output encoding (React)، SQL parameterized (تدقيق كامل)، XSS (لا innerHTML)، CSRF (Bearer لا Cookies)، SSRF (لا جلب لعناوين المستخدم)، Path traversal (`@fastify/static` مُحدَّث)، Uploads (نصية فقط بسقف).
- Auth security: bcrypt 12، رموز مُجزّأة، Lockout، Rate limits، `TRUST_PROXY`.
- Infra: أسرار بيئة فقط (فحص)، HSTS/CSP/nosniff/frame-deny/Permissions-Policy، أقل صلاحية (Docker غير جذر).
- Monitoring: Audit logs بـ IP وقيمة سابقة، فشل الدخول، Suspicious queue. التفاصيل: `docs/SECURITY.md`.

## 11 Storage & Files — N/A (v1) / TODO
- لا رفع ثنائي في v1 (الوسائط عبر URL). خطة: Object storage + Signed URLs + MIME/size + CDN (Roadmap «Media pipeline»).

## 12 APIs & Third-party — PASS
| المزود | الغرض | المصادقة | الفشل/البديل | التكلفة |
|---|---|---|---|---|
| Resend | بريد المعاملات | مفتاح خادمي | الطلب يُقبل بصمت ويُسجَّل؛ لا يمنع اللعب | مجاني حتى 3k/شهر |
| Anthropic | مسودات الأسئلة | مفتاح خادمي | 502 بلا حفظ؛ حصص يومية | ~0.05$/10 أسئلة |
| Discord/Slack Webhook | تنبيهات | رابط سري | يُهمل بعد 20/دقيقة | مجاني |
| Google Fonts | خط | — | fallback نظامي | مجاني |
| GHCR | صور Docker | GITHUB_TOKEN | بناء محلي بديل | مجاني |

## 13 Notifications — PARTIAL
- In-App كامل (تفضيلات، مقروء، Deep links، Retry عبر الوظائف)؛ بريد المصادقة. TODO: Push (FCM) وملخصات بريدية.

## 14 Search — PASS
- بحث مستخدمين/أسئلة بـ `pg_trgm` (تحمّل الأخطاء الإملائية، عربي)، ترقيم وحدود. TODO: مرادفات وتحليلات البحث.

## 15 Payments — N/A (مجاني في الإطلاق) / جاهزية: خطط + Entitlements مجردة.

## 16 Admin Panel — PASS
- دخول بأدوار، المستخدمون، المحتوى، البلاغات، مكافحة الغش، الإعدادات (Feature flags)، التحليلات، سجل التدقيق، حظر/إيقاف، استيراد/تصدير، مسودات AI.

## 17 Content Management — PASS
- نموذج المحتوى، مصادر (`source`, `source_id`)، إصدارات، مسودة → مراجعة → اعتماد → أرشفة، جدولة (Quizzes)، بلاغات، SOURCE_LOCK للديني.

## 18 Localization — PASS
- AR/EN كاملان (343 مفتاحًا)، RTL/LTR، تواريخ/أرقام بحسب اللغة، أخطاء وإشعارات مترجمة، لغة الأسئلة تطابق الواجهة.

## 19 Offline & Network Resilience — PASS (بقرار)
- كشف الاتصال، قشرة PWA، Retry مع Backoff لـ GET، منع التكرار (idempotency خادمية)، توقف العدّاد دون اتصال. طابور المزامنة مرفوض عمدًا (الخادم حكم — ADR-001).

## 20 Performance — PASS / PARTIAL(load tests)
- Web: Lazy routes، صور Lazy، حزم مقسّمة (~112KB gzip للتطبيق)، لا Backdrop-filter على الجوال.
- Backend: فهارس، كاش، Set-based، حدود؛ `/metrics` لزمن الاستجابة. TODO: اختبار حمل دوري (k6) قبل التوسع.

## 21 Error Handling — PASS
- تصنيف موحد (user/network/auth/authz/validation/db/timeout/rate-limit/server)؛ لا Stack traces/أسرار للمستخدم؛ `requestId` في كل 500؛ رسائل مترجمة.

## 22 Logging & Observability — PASS
- Pino JSON مع Redaction، request-id، `/health` + `/ready` (DB/Pool/Jobs)، `/metrics` Prometheus، Error webhook / Sentry اختياري، Audit logs. TODO: Tracing موزّع (غير لازم لنسخة واحدة).

## 23 Analytics — PASS / PARTIAL
- DAU/MAU/Attempts/Popular/Hardest/Quality في الإدارة؛ Crash rate عبر `/metrics` و`http_5xx_total`. TODO: Retention D1/D7/D30، Funnel.

## 24 Testing — PASS
- Unit 17 + Engine 35 + Integration 39 + Security/RBAC/Abuse 20 + Mail 3 + AI 3 + Migration 2 = **119**؛ E2E دخان + كامل؛ Migration/Restore drill في CI. TODO: Load/Stress.

## 25 Database & Migration Verification — PASS
- ترتيب بالاسم، Idempotent (اختبار)، Checksum ضد التعديل بعد التطبيق (اختبار)، Triggers/Indexes في 004، Seed idempotent، Rollback = ترحيلات إضافية + استعادة نسخة.

## 26 CI/CD — PASS
- Push → Typecheck+ESLint → 119 اختبارًا → Build → Audit → E2E (Demo) → Full-stack E2E → Restore drill → صورة GHCR (+تشغيل دخاني للصورة) → Pages. إصدار عبر Workflow (وسم + Release + صورة موسومة). TODO للمالك: Branch protection في إعدادات GitHub.

## 27 Environments — PASS
- Development (سرّ عشوائي، log mail)، Test (DB منفصلة، أقفال معطلة)، Production (أسرار إلزامية). Staging: خدمة Render ثانية بنفس الصورة (`docs/LAUNCH.md`).

## 28 Secrets & Configuration — PASS
- لا أسرار في Git (فحص)؛ `.env.example` مكتمل (كل متغير مقروء موثق)؛ compose يفشل بلا أسرار؛ Render `sync:false`.

## 29 Infrastructure — PASS (Render/Fly/Docker)
- Server/DB/CDN(Pages)/DNS/TLS(المزود)/Firewall(المزود)/Cache/Workers/Monitoring/Backups — `docs/DEPLOYMENT.md`.

## 30 Backup & Disaster Recovery — PASS
- يومي، استبقاء 14 يومًا، تشفير اختياري (GPG)، استعادة موثقة **ومُختبرة في CI في كل commit**، RPO 24س / RTO 30د، PITR عبر المزود.

## 31 Legal & Privacy — PASS
- سياسة الخصوصية والشروط (AR/EN)، الموافقة عند التسجيل، حذف الحساب (تجهيل)، تصدير البيانات، Retention موثق، لا Cookies تتبع. TODO للمالك: مراجعة قانونية بحسب الدولة/العمر.

## 32 App Store Preparation — N/A (PWA) / TODO عند Flutter.

## 33 Web Deployment — PASS
- Domain/DNS/SSL عبر المزود، CDN (Pages)، SEO (Meta/OG/Sitemap/Robots)، PWA، Analytics داخلية، Error tracking.

## 34 Release Engineering — PASS
- نسخة + CHANGELOG + وسم + Release notes آلية + خطة ترحيل (إضافية) + Rollback (وسم سابق) + Feature flags (إعدادات حية) + نسخة قبل النشر + دخان بعد النشر (`/ready`).

## 35 Post-Launch Operations — PASS (أدوات جاهزة)
- Crashes/Errors → Webhook؛ Latency/Health/DB → `/metrics` `/ready`؛ Traffic/Usage → الإدارة؛ التكاليف → §40.

## 36 Maintenance — PASS
- `npm outdated` موثق؛ Audit في CI؛ ترحيلات؛ Retention؛ ESLint/Typecheck.

## 37 Documentation — PASS
- README (AR/EN)، ARCHITECTURE، DATABASE، API، SECURITY، TESTING، DEPLOYMENT، LAUNCH، MASTER_PLAN، GATES، ADRs، CHANGELOG، PROJECT_STATUS.

## 38 Code Quality — PASS
- Typecheck strict + ESLint (recommended + typescript + react-hooks) في CI؛ لا TODO/Mock في الإنتاج (فحص)؛ مراجعة diff قبل كل Push.

## 39 Dependency Management — PASS
- 12 تبعية تشغيل فقط، كلها MIT/ISC/Apache/BSD (فحص تراخيص)؛ Audit high+ يفشل CI؛ إضافات هذه الدورة مبررة: `pino` (لوغ)، `prom-client` (Metrics)، `@anthropic-ai/sdk` (بوابة AI).

## 40 Cost Management (تقديري شهريًا)
| المستخدمون النشطون | خادم | قاعدة بيانات | بريد | AI (اختياري) | الإجمالي |
|---|---|---|---|---|---|
| 1K | Render Starter 7$ | Basic 7$ | 0$ | ~5$ | **~15–20$** |
| 10K | 25$ | 20$ | 10$ | ~30$ | **~60–90$** |
| 100K | 85$ ×2 + Redis 10$ | 95$ | 40$ | ~150$ | **~400–500$** |
| 1M | يتطلب هندسة توسع (ADR-002: Redis، Workers، Read replicas) | | | | يُقدّر عند الوصول |

## 41 Abuse & Anti-Fraud — PASS / PARTIAL
- Rate limits، Lockout، كشف سرعة/تكرار/Replay، حصص AI، تنظيف الضيوف، Audit. TODO: CAPTCHA على التسجيل عند ظهور سبام (يحتاج مزودًا).

## 42 Feature Flags & Remote Config — PASS
- `app_settings` حية من الإدارة: `maintenanceMode` (Kill switch)، `registrationEnabled`، `guestModeEnabled`، حدود ومكافآت. TODO: Gradual rollout/A-B (غير لازم الآن).

## 43 Support System — PASS
- صفحة المساعدة/FAQ، تواصل (بريد الدعم `VITE_SUPPORT_EMAIL`)، الإبلاغ عن خلل (GitHub Issues)، بلاغات الأسئلة، حالة النظام (`/ready`).

## 44 Quality Gates — PASS (هذه الوثيقة + CI)
- Architecture Gate ✔ (ADRs) · Database Gate ✔ (119 اختبارًا، Restore PASS) · Release Gate ✔ (Tests/Security/Build/E2E PASS).

## 45 Definition of Done — مُعتمد
- قائمة DoD مطبّقة في `docs/MASTER_PLAN.md` ولا تُعتبر ميزة مكتملة قبل: تحقق/تصميم/تنفيذ/ربط/صلاحيات/أمان/أخطاء/حالات/اختبار/بناء/توثيق.

## 46 الإطلاق النهائي — الحالة
PRODUCT ✔ → UX/UI ✔ → ARCHITECTURE ✔ → FRONTEND ✔ → BACKEND ✔ → DATABASE ✔ → AUTH ✔ → AUTHZ ✔ → SECURITY ✔ → API ✔ → STORAGE N/A → TESTING ✔ → PERFORMANCE ✔(بلا Load test) → CI/CD ✔ → INFRA ✔ → BACKUP ✔ → MONITORING ✔ → LEGAL ✔(مراجعة المالك) → STORE N/A → **PRODUCTION: بانتظار خطوة المالك الوحيدة (الاستضافة — `docs/LAUNCH.md`)** → POST-LAUNCH ✔ أدوات جاهزة.
