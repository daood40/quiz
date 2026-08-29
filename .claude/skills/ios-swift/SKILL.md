---
name: ios-swift
description: تطوير iOS أصلي بـ Swift وSwiftUI. استخدمها عند أي عمل على مشروع Xcode (SwiftUI، SwiftData، Combine، App Store).
---

# iOS Swift

- SwiftUI أولًا؛ UIKit فقط عند الحاجة الحقيقية.
- الحالة: @Observable للنماذج، @State للمحلي، Environment للمشترك.
- الشبكة: URLSession + async/await + Codable، ومعالجة أخطاء واضحة بـ enum.
- التخزين: SwiftData للبيانات، Keychain للأسرار، UserDefaults للإعدادات البسيطة فقط.
- التوطين: String(localized:) وملفات .xcstrings، وRTL يعمل تلقائيًا مع leading/trailing (لا left/right).
- الوصول: Dynamic Type، accessibilityLabel لكل عنصر تفاعلي.
- الخصوصية: كل استخدام حساس له مفتاح وصف في Info.plist.
- الأداء: LazyVStack للقوائم، تجنب الحسابات في body.
- الاختبار: XCTest للمنطق، اختبار UI لمسار الدخول فقط.
- النشر: زيادة build number، ملاحظات إصدار، التحقق من الأيقونات وشاشات الإطلاق.
