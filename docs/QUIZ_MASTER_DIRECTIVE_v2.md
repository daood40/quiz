# QUIZ — تطبيق الأسئلة
## وثيقة التوجيه الرئيسي للبناء (Master Build Directive)

| البند | القيمة |
|---|---|
| الإصدار | 2.0 (إعادة صياغة وتطوير للإصدار 1.0) |
| التاريخ | 2026-08-28 |
| الحالة | معتمَدة — مرجع ملزم للتنفيذ |
| الريبو | daood40/quiz (نسخة Demo ثابتة منشورة على GitHub Pages) |
| اللغة | عربي أولًا (RTL) + بنية متعددة اللغات |

> **ملاحظة على الإصدار 2.0:** أُعيد ترتيب الوثيقة، وصُحِّح تصنيف أنواع الأسئلة (الكلمات المتقاطعة نمط لعب لا نوع سؤال، وSequence مكرر لـ Ordering)، وحُدِّدت معادلة النقاط وقواعد كسر التعادل والعدالة في المسابقات، ونموذج الأمان "الخادم هو الحكم"، وخطة واقعية لبنك الأسئلة (120,000 سؤال هدف تشغيلي مرحلي لا شرط إطلاق)، وأُضيفت معايير القبول والقرارات المعمارية والملاحق. سجل التغييرات في الملحق (ح).

---

## الجزء الأول — الرؤية والمبادئ

### 1. الرؤية

منصة أسئلة ومسابقات تنافسية عالمية: يجيب المستخدم عن أسئلة، يدخل مسابقات، ينشئ تحديات، يلعب مع أصدقائه، ينافس عالميًا وداخل مجموعات، يصعد في الترتيب، يجمع نقاطًا، يحقق إنجازات، ويتابع مستواه. المسابقة الرئيسية شهرية: تبدأ أول الشهر وتنتهي بآخره.

### 2. المبادئ الحاكمة

1. **الخادم هو الحكم (Server is the Referee):** النتيجة والوقت والإجابة الصحيحة تُحسم على الخادم حصرًا. العميل يعرض فقط.
2. **العدالة قبل الإثارة:** كل من ينافس في التصنيف نفسه يواجه ظروفًا متكافئة (مجموعة أسئلة، وقت، عدد محاولات).
3. **الجودة قبل الكم:** سؤال واحد صحيح أفضل من مئة سؤال مشكوك فيه؛ لا سؤال في الإنتاج دون مراجعة بشرية.
4. **لا عقوبة تلقائية غير مؤكدة:** الاحتيال المشتبه به يُحجب ويُراجع، ولا يُعاقب آليًا.
5. **بنية تتحمل المليون:** كل قرار في القاعدة والذاكرة المؤقتة يُتخذ على أساس 1,000,000 سؤال وملايين الإجابات.

### 3. القاعدة الأساسية للتنفيذ

الترتيب الإلزامي: **المعمارية → قاعدة البيانات → محرك الأسئلة → محرك النقاط والحكم (Server) → المسابقات والتصنيفات → الواجهة → مكافحة الغش → الإدارة → الاختبارات → الإطلاق.**
التفاصيل غير المحددة: قرار هندسي متسق يُسجَّل في `docs/adr/`. المهمة لا تكتمل حتى يعمل المنتج ويجتاز معايير القبول (§37).

---

## الجزء الثاني — النطاق

### 4. داخل النطاق (v1.0)

محرك أسئلة Modular بـ 12 نوعًا، بنك أسئلة في قاعدة بيانات، تصنيفات هرمية تُدار من Admin، جولات (Rounds)، تحديات يومية/أسبوعية/شهرية/خاصة/أصدقاء/مجموعات/عالمية/تصنيف/سرعة/معرفة، مجموعات، أصدقاء، تصنيفات (Leaderboards) متعددة، محرك نقاط، Streak، إنجازات، ملفات شخصية، مراجعة الأسئلة، محرك جودة، مولّد AI بمسار مراجعة، كشف التكرار، إشعارات، إدارة كاملة، تحليلات، اشتراكات، Android/iOS/Web.

### 5. مؤجَّل بقرار

| البند | القرار |
|---|---|
| المنافسة الحية المتزامنة (Realtime 1v1) | Phase 5؛ تحديات الأصدقاء في v1.0 **غير متزامنة** (كلاهما يلعب المجموعة نفسها خلال 24 ساعة) |
| الكلمات المتقاطعة | نمط لعب مستقل (Game Mode) فوق أسئلة Fill-in-the-Blank — Phase 4 |
| الأسئلة النصية المفتوحة في التصنيفات | لا تدخل الترتيب التنافسي؛ مسموحة في وضع التدريب فقط |
| بث/مشاهدة المباريات | خارج النطاق |

---

## الجزء الثالث — محرك الأسئلة

### 6. أنواع الأسئلة (صُحِّحت v2)

| # | النوع | آلية التصحيح | مناسب للتنافس؟ |
|---|---|---|---|
| 1 | Multiple Choice (4 خيارات) | تطابق معرّف | ✔ |
| 2 | True / False | تطابق | ✔ |
| 3 | Fill in the Blank | تطبيع + قائمة إجابات مقبولة | ✔ |
| 4 | Multiple Select | تطابق المجموعة كاملة (أو جزئي بإعداد) | ✔ |
| 5 | Matching | تطابق الأزواج | ✔ |
| 6 | Ordering / Sequence (دُمجا) | تطابق الترتيب | ✔ |
| 7 | Image Question | أي نوع أعلاه + وسائط صورة | ✔ |
| 8 | Audio Question | أي نوع أعلاه + وسائط صوت | ✔ |
| 9 | Video Question | أي نوع أعلاه + وسائط فيديو | ✔ |
| 10 | Numeric Answer | تطابق بهامش (`tolerance`) ووحدة | ✔ |
| 11 | Text Answer (قصير) | تطبيع + مرادفات + مسافة تحرير ≤ 1 | تدريب فقط |
| 12 | Scenario Question | نص سياقي + أي نوع أعلاه | ✔ |

**تصحيح بنيوي:** الوسائط (صورة/صوت/فيديو) والسيناريو **خصائص** للسؤال لا أنواعًا مستقلة؛ `question_type` يصف آلية الإجابة، و`media` و`context_text` يصفان العرض. هذا ما يجعل المحرك Modular فعلًا.

**بنية المحرك:** كل نوع يطبّق واجهة موحدة:
```
QuestionType {
  render(payloadForClient)      // بلا إجابة صحيحة
  validateAuthoring(question)   // قواعد الجودة الخاصة بالنوع
  grade(answer, answerKey) -> {correct, partial_score}   // Server-side only
  shuffle(seed)                 // ترتيب خيارات ثابت لكل جلسة
}
```
إضافة نوع جديد = ملف واحد + تسجيل في السجل، دون لمس بقية النظام.

### 7. Question Schema

```
id  category_id  subcategory_id  question_type  difficulty (easy|medium|hard|expert)
question_text  context_text  media_id  language  tags[]
options (jsonb — بلا علامة الصحيح)       // ما يُرسل للعميل
answer_key (jsonb — جدول منفصل مقيَّد)  // لا يُقرأ إلا من دالة التصحيح
explanation  source_id  status (draft|in_review|approved|rejected|archived)
version  author_type (human|ai)  author_id  reviewer_id
stats: times_served  times_correct  avg_time_ms  computed_difficulty
created_at  updated_at
```

**قرار v2:** `answer_key` في جدول `question_answer_keys` بصلاحية `service_role` فقط؛ RLS تمنع قراءته من أي عميل. `options` لا تحوي أي مؤشر للصحيح.

### 8. الصعوبة

ثابتة عند التأليف (Easy/Medium/Hard/Expert) + **محسوبة ديناميكيًا** من نسبة الإجابات الصحيحة ومتوسط الوقت بعد ≥ 200 إجابة. تُستخدم المحسوبة في اختيار الأسئلة ومعامل النقاط، وتُراجع دوريًا (Background Job ليلي).

### 9. بنك الأسئلة

- **قاعدة بيانات فقط** (لا ملفات ثابتة)؛ مصممة لـ 1,000,000+ سؤال (فهارس مركبة، Partitioning بحسب اللغة/التصنيف عند تجاوز 500k).
- **أهداف مرحلية واقعية (تصحيح v2):** الإطلاق ≥ 10,000 سؤال معتمد (10 تصنيفات × 1,000)؛ الشهر الثالث ≥ 30,000؛ الهدف التشغيلي 120,000 (10 × 12,000) خلال السنة الأولى؛ العدد وحده لا يكفي — كل سؤال يمر بالمسار الكامل (§13).
- **منع التكرار للمستخدم:** `user_question_history` يمنع عرض السؤال نفسه في الوضع التنافسي خلال 90 يومًا.

### 10. التصنيفات

Categories وSubcategories (مستويان على الأقل، الشجرة تسمح بأكثر)، أيقونة ولون وترجمات، تُدار من Admin، قابلة للإخفاء دون حذف. البداية: علوم، تاريخ، جغرافيا، رياضيات، تقنية، ثقافة عامة، رياضة، لغات، دين، فن.

**قاعدة v2 لتصنيف "دين":** كل سؤال فيه يتطلب `source_id` إلزاميًا ومراجعًا متخصصًا، ولا يُعتمد سؤال ديني من مسودة AI دون مصدر موثق. (اتساقًا مع سياسة SOURCE_LOCK في مشروع فلاح.)

### 11. اللغات

`questions.language` لكل سؤال، و`question_translations` للترجمات المعتمدة. المستخدم يلعب بلغة واجهته، والتصنيفات العالمية تُحسب عبر اللغات لأن المجموعة اليومية تُختار من أسئلة لها ترجمة معتمدة بكل اللغات المفعّلة.

### 12. جودة الأسئلة (Question Validation Engine)

يرفض آليًا: سؤالًا بلا إجابة صحيحة، أكثر من إجابة صحيحة دون توضيح، خيارات مكررة، نصًا أقصر من الحد، وسائط مفقودة، تصنيفًا غير موجود، لغة لا تطابق النص. يعلّم للمراجعة: غموضًا محتملًا (خيارات "كل ما سبق"، "لا شيء مما سبق")، طول الخيار الصحيح المختلف بوضوح عن البقية (Bias)، أرقامًا/تواريخ بلا مصدر.

**كشف التكرار:**
- Exact: هاش للنص المطبَّع (توحيد الهمزات/التاء المربوطة/التشكيل/المسافات) + هاش للخيارات.
- Semantic: Embeddings في `pgvector`؛ تشابه ≥ 0.92 → مكرر مرجّح يُرفض؛ 0.85–0.92 → للمراجعة.

### 13. مسار السؤال (Authoring → Production)

```
Draft (بشري أو AI)
 → Validation (§12)
 → Duplicate Check
 → Fact Check (مصدر إلزامي لأسئلة الحقائق/الأرقام/التواريخ/الدين)
 → Human Review (Approve / Reject / Edit / Archive)
 → Approved → متاح للتوليف
```
- لا يدخل سؤال AI الإنتاج مباشرة، ولا حتى بعد الفحص الآلي؛ المراجعة البشرية إلزامية.
- كل تعديل ينشئ `question_versions`؛ السؤال المعتمد المعدَّل يعود إلى `in_review`.
- الطعن: المستخدم يبلّغ عن سؤال ("خطأ / غامض / مكرر") → `question_reports` → إن ثبت الخطأ يُؤرشف السؤال **وتُعاد** النقاط لمن تضرر خلال الموسم الجاري.

### 14. AI Question Generator

مولّد مسودات فقط: يستقبل تصنيفًا + صعوبة + لغة + عددًا، ويُنتج مسودات بمصدر مقترح. تدخل المسار في §13 دون استثناء. المفاتيح على الخادم؛ التكلفة والطلبات مسجّلة في `ai_requests`.

---

## الجزء الرابع — اللعب والمنافسة

### 15. الجولة (Round) وحكم الخادم

```
1. العميل يطلب جولة → الخادم ينشئ quiz_session ويختار الأسئلة ويرسل السؤال الأول بلا مفتاح إجابة
2. مع كل سؤال: served_at (خادم) + deadline_at = served_at + time_limit + grace(1.5s للشبكة)
3. العميل يرسل الإجابة مع session_id + question_id + client_answered_at
4. الخادم: answered_at = now(); يرفض ما بعد deadline؛ يرفض إجابة مكررة لنفس السؤال (Idempotency)
5. الخادم يصحّح، يحسب النقاط، يخزّن answer، ثم يرسل النتيجة + الإجابة الصحيحة + الشرح + السؤال التالي
```
- مؤقت العميل **تجميلي** فقط؛ الحسم بوقت الخادم.
- ترتيب الخيارات يُخلط بـ seed ثابت لكل جلسة (لا يمكن تخمين الصحيح من الموضع).
- الجلسة تنتهي بـ `completed | abandoned | expired`.

### 16. محرك النقاط (Points Engine) — مستقل وقابل للضبط

المعادلة (المعاملات في `settings`, لا في الكود):
```
points = base[difficulty] × challenge_multiplier
       + speed_bonus      = base × 0.5 × max(0, 1 − answered_time / time_limit)   (مقفّل: ≤ 50% من base)
       + streak_bonus     = min(streak_in_round, 5) × 2                            (يُصفَّر عند الخطأ)
base:  easy 10 · medium 20 · hard 30 · expert 50
```
- خطأ = 0. انتهاء الوقت = 0. تخطٍّ = 0.
- **منع التضخم:** سقف يومي للنقاط التنافسية لكل مستخدم؛ لا نقاط تنافسية من وضع التدريب؛ لا نقاط من سؤال سبق عرضه للمستخدم خلال 90 يومًا؛ الأسئلة الجديدة (< 200 إجابة) تُحتسب بمعامل Medium حتى تستقر صعوبتها.
- كل احتساب يُسجَّل في `score_events` (مصدر، معامل، مجموع) لأجل التدقيق والإرجاع.

### 17. كسر التعادل (Tie Breaker) — محدد بالكامل

عند تساوي النقاط، الترتيب بحسب:
1. **أقل مجموع وقت إجابة** (بالمللي ثانية، للأسئلة المجاب عنها فقط).
2. عدد الإجابات الصحيحة الأعلى.
3. الوصول المبكر للنقاط (`reached_at` — من بلغ المجموع أولًا).

مثال: A = 100 نقطة / 320 ث، B = 100 نقطة / 290 ث → B أعلى.

### 18. أنواع التحديات (موحّدة في نموذج واحد)

جدول `challenges` بحقل `type` وإعدادات JSON:

| النوع | القواعد الأساسية |
|---|---|
| Daily | مجموعة أسئلة **واحدة للجميع** (10 أسئلة، seed يومي)، محاولة واحدة، تُغلق منتصف الليل UTC للمستخدم بحسب منطقته |
| Weekly | تجميع نقاط الأسبوع + جولة أسبوعية خاصة |
| Monthly (الرئيسية) | موسم من أول الشهر لآخره؛ نقاط الجولات التنافسية اليومية + الأسبوعية؛ Leaderboard؛ تجميد النتيجة وتوزيع الجوائز/الشارات عند الإغلاق |
| Private | ينشئه مستخدم، رابط/رمز دعوة، مجموعة أسئلة ثابتة |
| Friends | غير متزامن: كلاهما يلعب المجموعة نفسها خلال 24 ساعة |
| Group | Leaderboard داخل المجموعة على تحدٍّ أو موسم |
| Global | التصنيف العالمي للموسم |
| Category | موسم/تحدٍّ محصور بتصنيف واحد |
| Speed | وقت أقصر (10 ث) ومعامل سرعة أعلى |
| Knowledge | وقت أطول، صعوبة Hard/Expert، بلا مكافأة سرعة |

**عدالة الموسم الشهري (إضافة v2):** الحد الأقصى للجولات التنافسية اليومية موحّد للجميع (مثلًا 3 جولات) حتى لا يفوز من يلعب أكثر فقط؛ من انضم متأخرًا يرى ذلك بوضوح.

### 19. المجموعات

Create / Join (رمز أو دعوة أو عام) / Invite / Leave / Kick (للمنشئ والمشرفين)، Leaderboard داخلي، حد أعضاء وفق الخطة، أدوار `owner | admin | member`.

### 20. الأصدقاء

Follow (اتجاه واحد) وFriend (اتجاهان بقبول)، Invite بالرابط، Challenge، Compare Scores. **إعدادات الخصوصية:** من يراني في البحث، من يتحداني، إظهار الدولة، إظهار الإحصائيات (عام / أصدقاء / لا أحد).

### 21. Leaderboards

Global، Country، Category، Friends، Group، Monthly، Weekly، Daily — مع Pagination ورؤية "موقعي".

**قرار معماري:** Redis Sorted Sets للترتيب الحي (Score كمركّب: النقاط ثم عكس الوقت) + جدول `leaderboard_snapshots` عند إغلاق كل فترة (تجميد النتائج والجوائز). البلد من الملف الشخصي (قابل للتغيير مرة كل موسم).

### 22. Streak

سلسلة المشاركة اليومية (1 / 7 / 30 / 100 يوم) تُحتسب بإكمال أي جولة. **لطيفة بالتصميم:** يوم "تجميد" واحد أسبوعيًا يُستهلك تلقائيًا، وتذكير قبل الفقدان بساعتين، وفقدان السلسلة لا يمسّ النقاط ولا الرتبة.

### 23. الإنجازات

First Quiz، 100 Correct، 1000 Correct، Perfect Round، Monthly Winner، Category Master، Fast Answer، Consistency (30 يومًا). القواعد في `achievements` كبيانات لا كود؛ التحقق على الخادم عند حدوث الأحداث.

### 24. الملف الشخصي

Name، Avatar، Country، Language، Statistics، Achievements، Rank، Points، Favorite Categories، مع Privacy Controls (§20). اسم العرض يخضع لفلتر ألفاظ.

### 25. مكافحة الغش (Anti-Cheat) — أساسية

**لا ثقة بالعميل.** الوقت والتصحيح والنقاط على الخادم (§15–16).

الكشف (`fraud_events` بدرجة خطورة):
- سرعة إجابة غير طبيعية (أقل من 800ms على أسئلة Hard مرارًا).
- أنماط API غير طبيعية (طلبات خارج تسلسل الجلسة، Replay، تعدد جلسات متزامنة).
- إعادة إرسال إجابة (Idempotency Key).
- تعديل العميل (Play Integrity / App Attest على الجوال؛ توقيع الطلبات).
- تلاعب بالنقاط (أي تناقض بين `score_events` والمجموع).
- Bots (نمط زمني منتظم، لا حركة واجهة).
- تعدد حسابات من جهاز واحد (`devices`).

**السياسة:** درجة منخفضة → تسجيل فقط؛ متوسطة → **حجب صامت** من الترتيب العلني حتى المراجعة (المستخدم يستمر باللعب)؛ عالية مؤكدة (Replay/Signature) → تجميد تلقائي مؤقت + مراجعة. لا حظر دائم بلا مراجعة بشرية. طابور مراجعة في الإدارة مع إمكانية الإرجاع.

Rate Limiting لكل مستخدم وIP، Audit Logs لكل حدث حساس.

---

## الجزء الخامس — الواجهة

### 26. نظام التصميم

RTL أولًا مع LTR، Light/Dark/System، Design Tokens، Premium وغير مزدحم، Animations خفيفة وقابلة للتعطيل، Skeleton/Empty/Error/Success، إتاحة AA، أهداف لمس ≥ 44px، ألوان الإجابة الصحيحة/الخاطئة مصحوبة بأيقونات (لا اعتماد على اللون وحده).

### 27. الشاشات

- **الرئيسية:** التحدي الحالي (مع العدّ التنازلي)، نقاط المستخدم، ترتيبه، Start Quiz، Daily Challenge، Categories، Friends، Leaderboard، Achievements.
- **شاشة السؤال:** سؤال واضح، رقم السؤال، Progress، Timer (تجميلي متزامن مع الخادم)، الخيارات، Animation بسيطة، Feedback فوري بعد الإجابة (صحيح/خطأ + الشرح + المصدر)، Next. بلا ازدحام.
- **النتائج:** Score، Correct، Wrong، Skipped، Time، Rank، Accuracy، ثم Review Answers، مشاركة النتيجة كصورة.
- **Leaderboards / Groups / Friends / Profile / Settings.**

### 28. الإشعارات

بدأ تحدٍّ جديد، صديق تحداك، ارتفع ترتيبك، اقترب انتهاء المسابقة (24 س / 1 س)، فزت، حققت إنجازًا، اقترب فقدان السلسلة. Push + داخل التطبيق، تفضيلات لكل نوع، حد يومي.

---

## الجزء السادس — البنية التقنية

### 29. القرارات المعمارية (ADRs)

| # | القرار | البديل المرفوض | السبب |
|---|---|---|---|
| ADR-001 | الخادم هو الحكم: التصحيح والوقت والنقاط في Edge Functions/Backend | تصحيح في العميل مع تحقق | العميل غير موثوق |
| ADR-002 | Supabase (Postgres + Auth + Storage + Edge Functions) + Redis للترتيب | Postgres وحده للترتيب | أداء الـLeaderboards عند الملايين |
| ADR-003 | Flutter + Clean Architecture + Feature-based + Riverpod + Repository + DI | — | توحيد المنصات وقابلية الاختبار |
| ADR-004 | `answer_key` جدول منفصل بصلاحية service_role فقط | عمود في `questions` | منع التسريب بخطأ RLS |
| ADR-005 | تحديات الأصدقاء غير متزامنة في v1.0 | Realtime | تبسيط الإطلاق؛ Realtime في Phase 5 |
| ADR-006 | الـDemo الثابت الحالي على GitHub Pages يبقى كمعاينة واجهة (Practice Mode بلا حساب)، والإنتاج يتطلب Backend | إزالة الـDemo | حفظ ما نُشر وتوضيح الفرق للمستخدم |
| ADR-007 | pgvector لكشف التكرار الدلالي | خدمة خارجية | داخل القاعدة وبلا تكلفة إضافية |

### 30. هيكل المشروع

```
lib/
  core/ (theme/tokens, i18n, routing, di, network, errors)
  features/
    auth/ home/ quiz_engine/ round/ challenges/ seasons/ leaderboards/
    groups/ friends/ profile/ achievements/ streak/ notifications/
    settings/ subscriptions/ practice/(offline)
  shared/
supabase/
  migrations/ policies/ seed/
  functions/ (start_round, submit_answer, finish_round, join_challenge,
              leaderboard_page, validate_question, detect_duplicates, ai_draft_questions,
              close_season, fraud_scan)
jobs/   (nightly_difficulty, snapshot_leaderboards, season_close, fraud_batch)
admin/  (واجهة ويب مستقلة)
docs/ test/ integration_test/
```

### 31. قاعدة البيانات

PostgreSQL. UUID، Foreign Keys، فهارس مركبة (`category_id, difficulty, language, status`)، Constraints، RLS على كل جدول، Partitioning لـ `answers` بالشهر و`questions` عند الحاجة.

| المجال | الجداول |
|---|---|
| الحسابات | `users`, `profiles`, `devices`, `privacy_settings`, `countries` |
| المحتوى | `categories`, `subcategories`, `questions`, `question_answer_keys`, `question_options`, `question_media`, `question_sources`, `question_translations`, `question_versions`, `question_reviews`, `question_reports`, `question_embeddings`, `question_stats` |
| اللعب | `quizzes`, `quiz_questions`, `quiz_sessions`, `answers` (partitioned), `score_events`, `user_question_history` |
| المنافسة | `seasons`, `challenges`, `challenge_participants`, `leaderboard_snapshots`, `groups`, `group_members`, `friendships`, `follows` |
| التحفيز | `achievements`, `user_achievements`, `streaks` |
| الأمان | `fraud_events`, `fraud_reviews`, `audit_logs`, `rate_limits` |
| النظام | `notifications`, `notification_preferences`, `plans`, `subscriptions`, `payments`, `settings`, `ai_requests` |

> تصحيحات v2: `scores` و`leaderboards` استُبدلا بـ `score_events` + `leaderboard_snapshots` + Redis (الأول للتدقيق، الثاني للتجميد). أُضيفت: `question_answer_keys`, `question_translations`, `question_reports`, `question_embeddings`, `question_stats`, `user_question_history`, `seasons`, `devices`, `privacy_settings`, `follows`, `streaks`, `fraud_reviews`, `countries`.

### 32. الأمان

Server-side validation لكل شيء؛ الإجابة الصحيحة لا تُرسل قبل التصحيح؛ العميل لا يحدد Score ولا Timer؛ RLS؛ تشفير النقل والسكون؛ توقيع طلبات الجولة؛ Play Integrity / App Attest؛ Rate Limiting؛ لا أسرار في العميل؛ فلتر محتوى للأسماء والمجموعات؛ Audit Logs؛ حماية الوسائط بروابط موقّعة.

### 33. الأداء

Indexes، Caching (الأسئلة المعتمدة بحسب التصنيف/الصعوبة في Redis/CDN Edge؛ الوسائط عبر CDN)، Pagination بالمؤشر (Keyset)، Partitioning، Background Jobs (الصعوبة الليلية، اللقطات، إغلاق الموسم، مسح الغش).
**أهداف:** بدء الجولة < 300ms، تصحيح الإجابة < 150ms (P95)، صفحة Leaderboard < 100ms، ثبات عند 10,000 جلسة متزامنة.

### 34. التحليلات

Question Accuracy، Question Difficulty، Average Time، Drop-off (بأي سؤال يترك المستخدم)، Popular Categories، Retention (D1/D7/D30)، DAU/WAU/MAU، Funnel (تثبيت → أول جولة → تحدٍّ → صديق). مجمّعة، بلا PII في لوحات الإدارة.

### 35. الاشتراكات

الخطط من `plans` بلا أسعار في الكود؛ حدود في `plans.limits` (جولات إضافية، مجموعات، إزالة إعلانات إن وُجدت، إحصائيات متقدمة). **قاعدة v2:** الاشتراك لا يمنح نقاطًا ولا يؤثر على الترتيب أبدًا (Pay-to-Win ممنوع). مزود الدفع خلف واجهة مجردة.

### 36. لوحة الإدارة

Questions (طوابير المراجعة، تعديل، إصدارات)، Categories، Users، Challenges/Seasons، Leaderboards (تجميد/إرجاع)، Reports، Fraud (طابور المراجعة)، Analytics، Moderation، Subscriptions، Settings (معاملات النقاط والحدود). أدوار: `super_admin | admin | reviewer | moderator | support`.

---

## الجزء السابع — الجودة والتسليم

### 37. معايير القبول (Definition of Done)

الميزة منجزة فقط إذا: كود بلا `TODO` · اختبارات تنجح في CI · لا منطق نقاط/وقت/تصحيح في العميل · RTL/LTR وDark Mode مفحوصة · Mobile/Tablet/Web · بلا Dummy data · موثقة في `PROJECT_STATUS.md`.

### 38. الاختبارات

Unit، Integration، Widget، E2E، Load، Security.
إلزامي: Scoring (المعادلة والسقوف)، Timer (الخادم يرفض ما بعد الموعد، Grace)، Tie Break (الحالات الثلاث)، Questions (تصحيح كل نوع + التطبيع العربي)، Challenges (Daily seed موحد، إغلاق الموسم)، Leaderboard (ترتيب مركّب، Pagination)، Anti-Cheat (Replay، تعدد جلسات، سرعة غير طبيعية، لا عقوبة تلقائية)، Auth، Payments (Webhooks)، Notifications، Load (10k جلسة متزامنة).

### 39. الإطلاق

Production config، Android/iOS Builds، Web Deployment، Migrations، Environment Variables (الملحق ب)، CI/CD، Monitoring، Crash Reporting، Runbook لإغلاق الموسم والطوارئ (إرجاع نقاط، تعطيل سؤال).

### 40. الممنوعات

Fake Leaderboard، Fake Points، Fake API، Dummy Questions في الإنتاج، Client-side scoring/timer، إرسال مفتاح الإجابة مسبقًا، Broken features، Placeholder pages، أسئلة AI بلا مراجعة، Pay-to-Win، عقوبات تلقائية غير مؤكدة.

### 41. مراحل التنفيذ

| المرحلة | المخرجات |
|---|---|
| 0 | المعمارية، Tokens، المخطط، CI، ADRs |
| 1 | محرك الأسئلة (12 نوعًا)، مسار التأليف والمراجعة، محرك الجودة والتكرار، الإدارة الأساسية، بذر 10k سؤال |
| 2 | الجولة بحكم الخادم، محرك النقاط، Streak، الإنجازات، الملف الشخصي، Practice Offline |
| 3 | المواسم والتحديات، Leaderboards (Redis)، المجموعات، الأصدقاء، الإشعارات |
| 4 | مكافحة الغش الكاملة، التحليلات، الاشتراكات، Load Testing، الكلمات المتقاطعة |
| 5 | Realtime 1v1، مولّد AI بواجهة إدارية، لغات إضافية |

---

## الملاحق

### (أ) الحالات الموحدة
```
question.status:     draft | in_review | approved | rejected | archived
quiz_session.status: active | completed | abandoned | expired
challenge.status:    scheduled | active | closing | closed
fraud_event.level:   low | medium | high
fraud_review:        pending | cleared | confirmed
friendship:          pending | accepted | blocked
```

### (ب) متغيرات البيئة
```
SUPABASE_URL=  SUPABASE_ANON_KEY=  SUPABASE_SERVICE_ROLE_KEY=(خادم فقط)
REDIS_URL=(خادم فقط)  REQUEST_SIGNING_SECRET=(خادم فقط)
AI_PROVIDER=  AI_API_KEY=(خادم فقط)  EMBEDDING_MODEL=
PAYMENT_PROVIDER=  PAYMENT_SECRET=(خادم فقط)  PAYMENT_WEBHOOK_SECRET=
FCM_KEY=  APNS_KEY=  SENTRY_DSN=  APP_ENV=(dev|staging|prod)
```

### (ج) ما يحتاج Credentials خارجية
Redis مُدار، Google/Apple Sign-In، Play Integrity + App Attest، FCM/APNs، مزود الدفع، مزود AI وEmbeddings، Sentry، Apple Developer + Google Play.

### (د) عقد `submit_answer` (Edge Function)
```
Request:  { session_id, question_id, answer_payload, client_answered_at, idempotency_key }
Checks:   session active ∧ question is current ∧ now ≤ deadline_at ∧ key unused ∧ signature valid
Response: { correct, points, explanation, source, next_question | round_summary }
```

### (هـ) التطبيع العربي قبل المقارنة والهاش
توحيد (أ إ آ → ا)، (ة → ه)، (ى → ي)، حذف التشكيل والتطويل، توحيد المسافات، خفض الحالة للأحرف اللاتينية، إزالة علامات الترقيم الطرفية.

### (و) ردود الرفض في محرك الجودة
- «السؤال بلا إجابة صحيحة محددة.» · «يوجد أكثر من إجابة صحيحة دون توضيح.» · «مكرر لسؤال معتمد (تشابه X%).» · «سؤال في تصنيف الدين بلا مصدر.»

### (ز) رسالة مرافقة لجلسة Claude Code
> الملف `docs/QUIZ_MASTER_DIRECTIVE_v2.md` يحل محل التوجيه السابق. **لا تبدأ من جديد.** الـDemo المنشور على GitHub Pages يبقى يعمل (ADR-006). اقرأ `PROJECT_STATUS.md` ثم اعمل Gap Analysis (موجود يُبقى / موجود يُعدَّل / جديد)، وأنشئ `docs/adr/` بالقرارات السبعة، وحدّث `ARCHITECTURE.md` و`ROADMAP.md`. أولوية التنفيذ: نقل كل منطق التصحيح/الوقت/النقاط من العميل إلى الخادم قبل أي ميزة جديدة. عند التعارض مع كود قائم: أصغر تعديل يحقق المتطلب مع توثيق السبب. حدّث `PROJECT_STATUS.md` نهاية الجلسة.

### (ح) سجل التغييرات عن v1.0
| النوع | التغيير |
|---|---|
| تصحيح | الوسائط والسيناريو خصائص لا أنواعًا؛ دمج Sequence مع Ordering؛ الكلمات المتقاطعة نمط لعب |
| تصحيح | Text Answer خارج التنافس (تصحيحه غير حاسم) |
| تصحيح | 120,000 سؤال هدف تشغيلي مرحلي؛ الإطلاق بـ 10,000 معتمد |
| تصحيح | `scores`/`leaderboards` → `score_events` + Redis + Snapshots |
| قرار | مفتاح الإجابة في جدول منفصل بصلاحية service_role |
| قرار | تحديات الأصدقاء غير متزامنة في v1.0؛ Realtime لاحقًا |
| قرار | الـDemo الثابت يبقى كوضع تدريب/معاينة |
| قرار | لا Pay-to-Win؛ الاشتراك لا يمس الترتيب |
| إضافة | معادلة النقاط بسقوف ومنع التضخم؛ كسر تعادل بثلاث مراحل؛ عدالة الموسم بحد جولات موحد |
| إضافة | عقد الجولة بحكم الخادم، Grace للشبكة، Idempotency، توقيع الطلبات، Attestation |
| إضافة | سياسة الحجب الصامت والمراجعة البشرية للغش؛ إرجاع النقاط عند ثبوت خطأ سؤال |
| إضافة | سياسة مصدر إلزامي لتصنيف الدين؛ التطبيع العربي؛ pgvector للتكرار |
| إضافة | DoD، أهداف أداء، Load Testing، الملاحق |
