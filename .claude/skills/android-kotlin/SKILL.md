---
name: android-kotlin
description: تطوير Android أصلي بـ Kotlin وJetpack Compose. استخدمها عند أي عمل على مشروع Android (Gradle، Compose، ViewModel، Room).
---

# Android Kotlin

- Compose أولًا؛ لا XML إلا لصيانة كود قديم.
- بنية MVVM: UI ← ViewModel (StateFlow) ← Repository ← DataSource.
- Hilt للحقن، Room للبيانات، Retrofit + kotlinx.serialization للشبكة، DataStore للإعدادات.
- الحالة: data class واحدة للشاشة (UiState) مع Loading/Success/Error.
- Coroutines: viewModelScope فقط في ViewModel، Dispatchers.IO للـ I/O.
- النصوص في strings.xml + مجلد values-ar، ودعم RTL بـ start/end وsupportsRtl=true.
- الأذونات: اطلبها عند الحاجة الفعلية مع شرح للمستخدم.
- الأداء: LazyColumn مع key، تجنب إعادة التركيب بـ remember/derivedStateOf.
- الأمان: EncryptedSharedPreferences للأسرار، لا مفاتيح في الكود، R8 مفعّل في release.
- الاختبار: JUnit للـ ViewModel، Compose UI test للشاشات الحرجة.
- قبل التسليم: `./gradlew lint testDebugUnitTest` ويجب أن ينجح.
