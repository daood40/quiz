---
name: web-frontend
description: معايير بناء واجهات الويب (HTML/CSS/JS/TS/React/Next.js) بجودة عالية مع دعم RTL وأداء وإمكانية وصول. استخدمها عند أي عمل على واجهة موقع أو تطبيق ويب.
---

# واجهات الويب

## قبل الكود
- افحص الإطار والأدوات الموجودة (package.json) والتزم بها.
- افحص نظام الألوان/الخطوط الحالي ولا تخترع أنماطًا جديدة إن وُجدت.

## HTML و CSS
- عناصر دلالية (header/nav/main/section/footer)؛ لا div-soup.
- CSS بالخصائص المنطقية (margin-inline, padding-block, inset-inline-start) لدعم RTL تلقائيًا.
- `dir` و`lang` على <html> حسب لغة الصفحة.
- Mobile-first، ووحدات rem، وclamp() للطباعة السائلة.
- prefers-reduced-motion وprefers-color-scheme محترمان.

## JavaScript / TypeScript
- TypeScript صارم (strict)، لا any إلا بتبرير في تعليق.
- التحقق من بيانات الخادم بـ zod قبل الاستخدام.
- لا innerHTML بنصوص من المستخدم.
- fetch مع AbortController ومعالجة أخطاء واضحة.

## React / Next.js
- مكونات صغيرة، حالة أقرب ما يمكن لمكان استخدامها.
- Server Components افتراضيًا في Next.js، "use client" فقط عند الحاجة.
- الصور عبر next/image، الخطوط عبر next/font.
- Metadata لكل صفحة (title/description/og).

## الجودة
- لكل عنصر تفاعلي: قابل للوصول بلوحة المفاتيح وله label.
- تباين ألوان ≥ 4.5:1.
- لا console.log في الكود النهائي.
- شغّل lint وtype-check قبل التسليم.
