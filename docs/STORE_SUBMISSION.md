# النشر على المتاجر — Google Play و App Store (خطوة بخطوة)

> الهدف: تطبيق يُقبل من أول مراجعة. كل ما يعتمد على حسابك أنت (مطوّر، توقيع، خادم) مذكور هنا بالضبط، وكل ما عداه جاهز في المستودع.

## 0) ما هو التطبيق تقنيًا
- غلاف أصلي (Capacitor 7) حول نفس تطبيق الويب المُختبَر (119 اختبار خادم، E2E كامل، axe 0). المشروعان: `web/android` و`web/ios`.
- ميزات أصلية: اهتزاز Taptic/Vibrator، مشاركة النتائج عبر لوحة النظام، تذكير يومي (إشعار محلي اختياري بلا Exact Alarm)، شريط حالة يتبع السمة، زر الرجوع، الروابط الخارجية في متصفح النظام، Deep links.
- لا تتبّع، لا إعلانات، لا SDK طرف ثالث، لا أذونات حساسة (INTERNET + VIBRATE + POST_NOTIFICATIONS فقط).
- المعرّف: `io.github.daood40.quiz`. الإصدار من `package.json` (1.1.0 → versionCode 10100).

## 1) قبل أي شيء: الخادم (إلزامي)
التطبيق يتصل بـ API حقيقي؛ بدونه لا يُقبل (شاشات فارغة/أخطاء = رفض).
1. انشر الخادم (docs/LAUNCH.md، Render blueprint).
2. في Render → Environment: `CORS_ORIGIN=https://<نطاقك>,https://localhost,capacitor://localhost` (الأصلان الأخيران هما التطبيق).
3. GitHub → Settings → Secrets and variables → Actions → **Variables**: `MOBILE_API_BASE = https://<رابط Render>/api/v1` و`SUPPORT_EMAIL = دعم@نطاقك`.
4. أنشئ حسابًا تجريبيًا للمراجعين (بريد + كلمة مرور) وضعه في ملاحظات المراجعة.

## 2) Google Play (Android)
### أ. الحسابات
- حساب مطوّر Google Play (25$ مرة واحدة) + التحقق من الهوية (فردي أو منظمة، يطلب Google وثائق وقد يطلب رقم D‑U‑N‑S للمنظمات).
- منذ 2024: الحسابات الفردية الجديدة تحتاج **اختبارًا مغلقًا بـ 12 مختبِرًا لمدة 14 يومًا** قبل الإنتاج. جهّز 12 بريدًا (أصدقاء/عائلة) في قائمة مختبِرين.

### ب. مفتاح الرفع (مرة واحدة، على جهازك)
```bash
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks > upload.b64   # على macOS: base64 -i upload.jks -o upload.b64
```
GitHub → Secrets: `ANDROID_KEYSTORE_BASE64` (محتوى upload.b64)، `ANDROID_KEYSTORE_PASSWORD`، `ANDROID_KEY_ALIAS=upload`، `ANDROID_KEY_PASSWORD`. **احتفظ بنسخة من upload.jks خارج الحاسوب**؛ ضياعه يعني طلب إعادة تعيين من Google.

### ج. البناء
Actions → **Mobile (Android AAB · iOS)** → Run workflow → نزّل الأداة `android-1.1.0` (يحوي `.aab` موقّعًا).

### د. Play Console
1. Create app → اسم: **Quiz Platform — منصة الأسئلة** → App/Game: **Game** → مجاني.
2. **App content** (كلها إلزامية):
   - Privacy policy: `https://daood40.github.io/quiz/privacy` (أو نطاقك).
   - App access: "All functionality is available without special access" ← لا؛ اختر **"All or some functionality is restricted"** وأضف الحساب التجريبي (لأن لوحة الصدارة تحتاج حسابًا).
   - Ads: **No ads**.
   - Content rating: استبيان IARC → فئة "Game"؛ أجب "لا" على العنف/الجنس/المخدرات/القمار/المشتريات؛ "نعم" على "المستخدمون يتفاعلون" (أسماء مستخدمين في لوحة الصدارة، بلا دردشة حرّة). النتيجة المتوقعة: Everyone / PEGI 3.
   - Target audience: **13+** (لا تختر أقل من 13 وإلا تدخل سياسة Families).
   - News app: No. COVID: No. Data safety: انظر الجدول أدناه. Government app: No. Financial features: No. Health: No.
   - **Account deletion**: "Yes, app lets users create accounts" → In-app deletion: Yes → رابط الحذف: `https://daood40.github.io/quiz/delete-account`.
3. **Store listing**: النصوص في §4. لقطات: 2–8 لهاتف (1080×1920 أو 1080×2340) + أيقونة 512×512 (`web/assets/icon-only.png` مصغّرة) + رسم مميز 1024×500.
4. Testing → Closed testing → track → ارفع الـ AAB → أضف قائمة المختبِرين (12) → انشر → انتظر 14 يومًا → "Apply for production access".
5. Production → Create release → نفس الـ AAB → مراجعة (عادة 1–7 أيام).

### هـ. Data safety (الإجابات الصحيحة)
| البيان | يُجمع؟ | مشارَك؟ | إلزامي؟ | الغرض |
|---|---|---|---|---|
| Email address | نعم | لا | اختياري (ضيف بلا بريد) | Account management |
| User IDs (اسم المستخدم) | نعم | لا | اختياري | Account management, App functionality |
| Name (الاسم الظاهر) | نعم | لا | اختياري | App functionality |
| Other user-generated content (إجابات/تقارير أسئلة) | نعم | لا | اختياري | App functionality |
| App interactions (نتائج اللعب) | نعم | لا | نعم | App functionality, Analytics (داخلية) |
| Crash logs / Diagnostics | لا (لا SDK) | — | — | — |
| Location, Contacts, Photos, Device IDs, Financial | لا | — | — | — |
- "Is all of the user data collected by your app encrypted in transit?" **Yes** (HTTPS فقط).
- "Do you provide a way for users to request that their data is deleted?" **Yes** (في التطبيق + صفحة الحذف).
- لا يُشارَك أي بيان مع أطراف ثالثة. لا تتبّع. لا Advertising ID (تأكد أن `com.google.android.gms.permission.AD_ID` غير موجود في الـ manifest المدمج — غير موجود).

## 3) App Store (iOS)
### أ. الحسابات
- Apple Developer Program (99$/سنة). للأفراد يكفي Apple ID مع التحقق؛ للمنظمات D‑U‑N‑S.
- App Store Connect → New app → Bundle ID `io.github.daood40.quiz` (سجّله أولًا في developer.apple.com → Identifiers → App IDs، بلا Capabilities إضافية).

### ب. التوقيع (على Mac أو عبر Xcode Cloud/CI)
1. Certificates → **Apple Distribution** (.cer) → صدّره من Keychain كـ `.p12` بكلمة مرور.
2. Profiles → **App Store Connect** profile للـ Bundle ID → `.mobileprovision`.
3. GitHub Secrets: `IOS_CERT_P12_BASE64`، `IOS_CERT_PASSWORD`، `IOS_PROVISION_PROFILE_BASE64`، `IOS_TEAM_ID` (10 أحرف).
4. Actions → Mobile → Run → أداة `ios-1.1.0` (`.ipa`) → ارفعه بـ **Transporter** (Mac) أو `xcrun altool`. (بديل: افتح `web/ios/App/App.xcworkspace` في Xcode → Product → Archive → Distribute.)

### ج. App Store Connect — ما يسأل عنه المراجع
- **App Privacy** (Nutrition labels): Data Linked to You: Email, User ID, Name, Gameplay Content, Product Interaction — Purpose: App Functionality. Tracking: **No**. (يطابق `PrivacyInfo.xcprivacy` في المشروع.)
- **Age rating**: كل الأسئلة "None" → 4+. (المسابقات بين اللاعبين ليست "Unrestricted Web Access".)
- **Sign in**: لا يوجد تسجيل دخول بطرف ثالث → **لا يلزم Sign in with Apple** (القاعدة 4.8 تنطبق فقط عند وجود Google/Facebook login). لا تضف تسجيل Google لاحقًا دون Sign in with Apple.
- **Account deletion (5.1.1 v)**: موجود داخل التطبيق (الإعدادات) + صفحة الويب.
- **4.2 Minimum functionality**: التطبيق ليس موقعًا مغلّفًا فقط: يعمل دون اتصال في وضع الضيف؟ لا — لذلك اذكر في Review Notes الميزات الأصلية (اهتزاز، مشاركة، تذكيرات، وضع داكن، 80 نوع سؤال) وأنه لعبة كاملة. حزمة الويب مضمّنة داخل التطبيق (لا تحميل عن بُعد).
- **Export compliance**: `ITSAppUsesNonExemptEncryption = false` مضبوط (HTTPS فقط).
- **Review notes** (انسخ): "Demo account: <email> / <password>. The app is a bilingual (Arabic/English) quiz game with 80 question types, competitions and a leaderboard. Native features: haptic feedback, system share sheet for result cards, optional daily local reminder, dark mode. Religious content category is hidden until reviewed by a specialist. No ads, no tracking, no third-party SDKs."
- **Support URL**: `https://daood40.github.io/quiz/help` — **Privacy URL**: `https://daood40.github.io/quiz/privacy`.
- لقطات: iPhone 6.7" (1290×2796) و6.5" (1284×2778) إلزامية؛ iPad 13" (2064×2752) إن دعمت iPad (المشروع يدعمه؛ يمكنك إزالة iPad من Xcode → Deployment Info لتفادي لقطاته).

## 4) نصوص المتجر (AR/EN)
**الاسم:** Quiz Platform — منصة الأسئلة
**العنوان الفرعي (iOS، ≤30):** العب، نافس، وتصدّر / Play, compete, climb
**وصف قصير (Play، ≤80):** لعبة أسئلة ثنائية اللغة: 80 نوع سؤال، تحديات يومية، ولوحة صدارة.

**الوصف الكامل (AR):**
منصة أسئلة ومسابقات بالعربية والإنجليزية. اختر التصنيف والصعوبة، والعب جولات موقّتة أو تدريبًا هادئًا، وتحدَّ أصدقاءك في التحديات والبطولات، وتصدّر لوحة المتصدرين الأسبوعية.
• 80 نوع سؤال: اختيار، صح/خطأ، ترتيب، مطابقة، كلمات متقاطعة، حسابات، والمزيد.
• تحدٍّ يومي واحد للجميع، وتحدٍّ شهري.
• مساعدات: 50:50، وقت إضافي، اسأل الجمهور.
• إحصاءات دقيقة، إنجازات، سلاسل يومية، ومشاركة بطاقة النتيجة.
• وضع داكن، خط كبير، تحكّم بالصوت والاهتزاز، ودعم كامل للغة العربية.
• بلا إعلانات وبلا تتبّع. حذف الحساب من الإعدادات في أي وقت.

**Full description (EN):**
A bilingual (Arabic/English) quiz game. Pick a category and difficulty, play timed rounds or calm practice, challenge friends in duels and tournaments, and climb the weekly leaderboard.
• 80 question types: choice, true/false, ordering, matching, crosswords, calculations and more.
• One daily quiz for everyone, plus a monthly challenge.
• Power-ups: 50:50, extra time, ask the audience.
• Detailed statistics, achievements, daily streaks and shareable result cards.
• Dark mode, large text, sound and haptics controls, full right-to-left support.
• No ads, no tracking. Delete your account from Settings at any time.

**الكلمات المفتاحية (iOS، ≤100 حرف):** quiz,trivia,أسئلة,مسابقات,ثقافة,challenge,brain,العاب ذكاء,leaderboard

## 5) القوانين واللوائح — ما يغطيه المشروع
- **GDPR/UK GDPR/CCPA:** سياسة خصوصية واضحة، تصدير البيانات (`/users/me/export`)، حذف الحساب فورًا، لا بيع بيانات، الحد الأدنى من البيانات، تشفير النقل والسكون، الاحتفاظ محدود (ضيوف 30 يومًا، سجلات 30 يومًا).
- **COPPA/الأطفال:** الفئة المستهدفة 13+ في المتجرين؛ سياسة الخصوصية تنص على ذلك.
- **Apple 5.1.1 / Play User Data:** حذف داخل التطبيق + رابط ويب.
- **الوصول (ADA/EN 301 549):** WCAG AA — axe 0 مخالفات، تباين ≥4.5:1، لوحة مفاتيح كاملة، Dynamic Type/خط كبير.
- **المحتوى الديني:** التصنيف مخفي حتى المراجعة المتخصصة (SOURCE_LOCK) — لا شكاوى محتوى.
- **الأمان:** HTTPS فقط، لا مفاتيح في التطبيق، JWT قصير + تدوير، حد للمحاولات، CSP.
- **الملكية الفكرية:** الأسئلة أصلية/عامة؛ الخط Cairo برخصة OFL؛ لا علامات تجارية لأطراف أخرى في الاسم أو الأيقونة.
- **الترخيص:** اذكر نوع الترخيص في `LICENSE` قبل النشر (Apple تطلب عدم تعارض).

## 6) فحص ما قبل الرفع (5 دقائق)
- [ ] Actions → Mobile أخضر، وملخص الوظيفة يقول "Signed" (Android) و"IPA exported" (iOS).
- [ ] فتح التطبيق على جهاز حقيقي: تسجيل، جولة، لوحة الصدارة، مشاركة نتيجة، تفعيل التذكير، حذف حساب تجريبي.
- [ ] `https://<API>/ready` يعيد `ok:true`، وCORS يقبل `capacitor://localhost` (جرّب من التطبيق).
- [ ] رابطا الخصوصية والحذف يفتحان علنًا بلا تسجيل.
- [ ] الحساب التجريبي يعمل ومذكور في ملاحظات المراجعة.

## 7) ما لا أستطيع فعله نيابةً عنك
إنشاء حسابات المطوّرين ودفع رسومها، التحقق من الهوية، توليد مفاتيح التوقيع (يجب أن تبقى بحوزتك)، رفع اللقطات، والضغط على "Submit for review". كل ما عدا ذلك موجود في المستودع ويُبنى تلقائيًا.
