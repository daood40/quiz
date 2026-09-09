# memory/TEST_RESULTS.md   (يُكتب بعد تشغيل حقيقي فقط)
## 2026-09-09 (مساءً) — محلي (حاوية Linux) بعد تمرير 121 مهارة
`npm run lint` (tsc server+web + eslint): 0 أخطاء · `vitest`: 153/153 (10 ملفات، 26.6 ثانية) · `npm run build`: نجاح (index 110 kB, vendor 165 kB) · E2E كامل على :3002 (تسجيل → جولة → صدارة → إدارة): 11/11 · دخان Demo (`VITE_DEMO=1 VITE_BASE=/quiz/`) + axe: 17/17 · لقطات AR جوال 390×844 لثماني شاشات: بلا أخطاء JS.
لم يُشغَّل هنا: gradle/xcodebuild (CI فقط) · جهاز حقيقي · اختبار حمل.
## 2026-09-09 — GitHub Actions: CI run #27 (ci.yml) على 724db14 — أخضر
الأوامر: `npm run lint` (tsc + eslint) · `npm test` (vitest على PostgreSQL 16) · `npm run build` · `npm audit --audit-level=high` · دخان Playwright (Demo) · E2E كامل (API + PG + متصفح) · تمرين استرجاع نسخة احتياطية
النتيجة: 119 نجحت / 0 فشلت · دخان 17 فحصًا (بما فيها axe) · E2E كامل 11 فحصًا
## 2026-09-09 — GitHub Actions: Mobile run #3 (mobile.yml) على 7fac407 — أخضر
android: `./gradlew bundleRelease assembleRelease` → أداة android-1.1.0 (AAB + APK غير موقّع، 7.7 MB)
ios: `cap sync ios` + `xcodebuild -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build` → نجاح؛ لم يُصدَّر IPA (لا أسرار)
## 2026-09-09 — محلي (حاوية Linux)
`vitest`: 119/119 · `npm run lint`: 0 أخطاء · E2E كامل على :3002: 11/11 · دخان Demo: 17/17 · axe (62 مسحًا، 17 مسارًا × لغتين × عرضين): 0 مخالفات
لم يُشغَّل هنا: gradle/xcodebuild (تنزيلات Google محجوبة في الحاوية) → يُنفَّذ في GitHub Actions فقط · اختبار على جهاز حقيقي
