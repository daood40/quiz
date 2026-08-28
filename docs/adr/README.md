# سجل القرارات المعمارية (ADRs)

القرارات السبعة من [التوجيه الرئيسي v2](../QUIZ_MASTER_DIRECTIVE_v2.md) (§29)،
موثّقة مقابل الكود القائم وفق قاعدة الملحق (ز): *أصغر تعديل يحقق المتطلب مع
توثيق السبب* — لا إعادة بناء.

| ADR | القرار | الحالة مقابل الكود القائم |
|---|---|---|
| [ADR-001](ADR-001-server-is-referee.md) | الخادم هو الحكم | ✅ مطبَّق بالكامل |
| [ADR-002](ADR-002-backend-stack.md) | Supabase + Redis | 🔶 معدَّل: Fastify + PostgreSQL مباشرة؛ Redis مؤجَّل بعتبة حمل |
| [ADR-003](ADR-003-client-stack.md) | Flutter + Riverpod | 🔶 معدَّل: React SPA الآن، وعميل Flutter لاحقًا على نفس الـ API |
| [ADR-004](ADR-004-answer-key-isolation.md) | عزل مفتاح الإجابة | 🔶 معدَّل: العزل عبر طبقة الـ API؛ فصل الجدول تحصين مخطط |
| [ADR-005](ADR-005-async-friend-challenges.md) | تحديات الأصدقاء غير متزامنة | ✅ مطبَّق |
| [ADR-006](ADR-006-pages-demo-stays.md) | بقاء Demo على GitHub Pages | ✅ مطبَّق |
| [ADR-007](ADR-007-duplicate-detection.md) | pgvector لكشف التكرار الدلالي | 🔶 مرحلي: هاش + pg_trgm الآن، pgvector تاليًا |

قرار جديد لا يُتخذ إلا بملف ADR جديد هنا (`ADR-008-…`) بنفس البنية:
**السياق → القرار → الحالة → الأثر على الكود → البديل المرفوض والسبب**.
