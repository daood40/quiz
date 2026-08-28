# PROJECT_STATUS — حالة المشروع

**آخر تحديث:** 2026-08-28 · **المرجع الملزم:** [docs/QUIZ_MASTER_DIRECTIVE_v2.md](docs/QUIZ_MASTER_DIRECTIVE_v2.md)

## الحالة الآن

| البند | الحالة |
|---|---|
| الكود | منصة كاملة مستوردة من `daood40/falah` (فرع quiz-platform-build): خادم Fastify + PostgreSQL، واجهة React، 80 نوع سؤال على 13 عائلة، تحكيم خادمي كامل |
| CI | ✅ أخضر: typecheck + 81 اختبارًا (تكامل على PostgreSQL حقيقية) + بناء + `npm audit --audit-level=high` |
| النشر | Workflow جاهز ينشر Demo على `https://daood40.github.io/quiz/` مع كل push؛ **ينتظر تفعيل Pages يدويًا مرة واحدة** (Settings → Pages → Source: GitHub Actions ثم Re-run) |
| الحوكمة | التوجيه v2 معتمد في `docs/`؛ القرارات السبعة في [docs/adr/](docs/adr/)؛ تحليل الفجوات في [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md) |
| أولوية التوجيه رقم 1 (نقل الحكم للخادم) | ✅ محققة أصلًا — لا منطق تصحيح/وقت/نقاط في عميل النسخة الكاملة (ADR-001)؛ الـ Demo استثناء معتمد (ADR-006) |

## سجل الجلسات

### 2026-08-28 — الاستيراد والتأسيس والحوكمة
- استيراد كامل الكود من فرع `claude/quiz-platform-build-swm4wi` في `daood40/falah`.
- ضبط النشر التلقائي على GitHub Pages بمسار `/quiz/`، وREADME عربي + دليل إنجليزي.
- إصلاح أمني: ترقية `@fastify/static` إلى 10.1.3 (ثغرات path traversal) — CI أخضر.
- اعتماد التوجيه v2: نسخه إلى `docs/`، إنشاء ADR-001…007 (اثنان مطبقان،
  أربعة بصيغة معدلة موثقة السبب، واحد مرحلي)، Gap Analysis كامل
  (يُبقى/يُعدَّل/جديد)، وتحديث `ARCHITECTURE.md` و`ROADMAP.md`.

## التالي (من تحليل الفجوات، بالترتيب)

1. حزمة النقاط (§16): streak_bonus داخل الجولة، سقف يومي، معامل الأسئلة
   الجديدة، وقيم base الافتراضية 10/20/30/50 في الإعدادات.
2. `user_question_history` بمنع 90 يومًا في التنافسي + Grace ‏1.5s (§9، §15).
3. قاعدة مصدر تصنيف الدين (§10) + `question_versions` وإرجاع النقاط (§13).
4. إعدادات الخصوصية وFollow (§20).
5. البقية بحسب [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md) ومراحل §41.

> قاعدة التحديث (الملحق ز): كل جلسة عمل تُنهى بتحديث هذا الملف — ما أُنجز،
> وما تغيّر في الفجوات، وما التالي.
