---
name: react-native-expo
description: تطبيقات React Native مع Expo. استخدمها عند أي عمل على مشروع RN/Expo (Expo Router، EAS، Reanimated).
---

# React Native / Expo

- Expo managed + Expo Router + TypeScript صارم.
- الحالة: Zustand للمحلي، TanStack Query للخادم. لا Redux إلا إن كان موجودًا.
- التخزين: MMKV للسرعة، SecureStore للأسرار.
- القوائم: FlashList مع estimatedItemSize.
- الحركة: Reanimated + Gesture Handler، لا Animated القديمة.
- RTL: I18nManager.forceRTL عند تغيير اللغة + إعادة تشغيل، واستخدم start/end في الأنماط.
- الصور: expo-image مع placeholder وcachePolicy.
- الأخطاء: ErrorBoundary عام + Sentry.
- البناء: EAS Build بملفات eas.json لبيئتي preview وproduction، وEAS Update للإصلاحات السريعة.
- قبل التسليم: `npx tsc --noEmit` و`npx expo-doctor`.
