import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

const PRIVACY = {
  ar: [
    ['ما نجمعه', 'اسم المستخدم، البريد الإلكتروني، الدولة (اختياري)، ونتائج اللعب. لا نجمع بيانات حساسة ولا نبيع بياناتك.'],
    ['لماذا', 'لتشغيل الحساب، حساب النقاط والترتيب، وتحسين جودة الأسئلة (إحصاءات مجمّعة بلا هوية).'],
    ['التخزين', 'في نسخة المتصفح (Demo) تبقى بياناتك على جهازك فقط (localStorage). في النسخة الكاملة تُخزَّن على خوادمنا مشفّرة أثناء النقل والسكون.'],
    ['حقوقك', 'يمكنك تصدير بياناتك أو حذف حسابك نهائيًا من الإعدادات في أي وقت.'],
    ['الأطفال', 'الخدمة موجّهة لمن هم فوق 13 عامًا.'],
    ['تواصل', 'للاستفسارات: افتح مسألة على مستودع المشروع في GitHub.'],
  ],
  en: [
    ['What we collect', 'Username, email, optional country, and your play results. No sensitive data, and we never sell your data.'],
    ['Why', 'To run your account, compute points and rankings, and improve question quality (aggregated, anonymised statistics).'],
    ['Storage', 'In the browser demo your data stays on your device only (localStorage). In the full version it is stored on our servers, encrypted in transit and at rest.'],
    ['Your rights', 'Export your data or permanently delete your account from Settings at any time.'],
    ['Children', 'The service is intended for users aged 13 and over.'],
    ['Contact', 'Open an issue on the project GitHub repository.'],
  ],
};

const TERMS = {
  ar: [
    ['اللعب النظيف', 'الخادم هو الحكم: أي محاولة تلاعب بالنقاط أو الوقت أو إعادة إرسال الإجابات تُحجب من الترتيب وتُراجع بشريًا قبل أي عقوبة.'],
    ['الحساب', 'حساب واحد لكل شخص. اسم العرض يخضع لفلتر ألفاظ.'],
    ['المحتوى', 'الأسئلة تمر بمراجعة بشرية. إن وجدت خطأً، استخدم "الإبلاغ عن السؤال" وتُرجَع النقاط للمتضررين عند ثبوته.'],
    ['لا Pay-to-Win', 'أي اشتراك مستقبلي لا يمنح نقاطًا ولا يؤثر في الترتيب.'],
    ['الإتاحة', 'قد تتوقف الخدمة مؤقتًا للصيانة؛ لا نضمن الاستمرارية بلا انقطاع.'],
  ],
  en: [
    ['Fair play', 'The server is the referee: any attempt to manipulate points, timers or replay answers is hidden from rankings and reviewed by a human before any penalty.'],
    ['Account', 'One account per person. Display names go through a language filter.'],
    ['Content', 'Questions are human-reviewed. If you find an error use "Report question"; confirmed errors refund points to affected players.'],
    ['No pay-to-win', 'Any future subscription never grants points or affects rankings.'],
    ['Availability', 'The service may pause for maintenance; uninterrupted availability is not guaranteed.'],
  ],
};

function LegalDoc({ title, updated, rows }: { title: string; updated: string; rows: string[][] }) {
  return (
    <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1>{title}</h1>
      <p className="muted">{updated}</p>
      {rows.map(([h, p]) => (
        <section key={h} style={{ marginTop: 14 }}>
          <h3>{h}</h3>
          <p style={{ margin: 0 }}>{p}</p>
        </section>
      ))}
    </div>
  );
}

export function PrivacyPage() {
  const { lang, t } = useI18n();
  return <LegalDoc title={t('privacy')} updated={`${t('lastUpdated')}: 2026-09-02`} rows={PRIVACY[lang]} />;
}

export function TermsPage() {
  const { lang, t } = useI18n();
  return <LegalDoc title={t('terms')} updated={`${t('lastUpdated')}: 2026-09-02`} rows={TERMS[lang]} />;
}

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="card center" style={{ maxWidth: 520, margin: '6vh auto 0' }}>
      <div className="result-emoji">🧭</div>
      <h1>404</h1>
      <p className="muted">{t('notFound')}</p>
      <Link to="/" className="btn" style={{ marginTop: 12 }}>{t('home')}</Link>
    </div>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <Link to="/privacy">{t('privacy')}</Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms">{t('terms')}</Link>
      <Link to="/help">{t('help')}</Link>
      <span aria-hidden="true">·</span>
      <a href="https://github.com/daood40/quiz" target="_blank" rel="noreferrer">GitHub</a>
    </footer>
  );
}


const FAQ: Array<{ q: { en: string; ar: string }; a: { en: string; ar: string } }> = [
  { q: { en: 'How are points calculated?', ar: 'كيف تُحسب النقاط؟' },
    a: { en: 'Only ranked modes (timed, speed, survival, knowledge, daily, challenges) count. Base points depend on difficulty, plus a speed bonus and an in-round streak bonus. Practice never affects rankings.',
         ar: 'تُحتسب الأنماط التنافسية فقط (موقّت، سرعة، بقاء، معرفة، اليومي، التحديات). النقاط الأساسية بحسب الصعوبة، مع مكافأة سرعة ومكافأة تتابع داخل الجولة. التدريب لا يؤثر على الترتيب.' } },
  { q: { en: 'Why did a question I answered correctly count as wrong?', ar: 'لماذا حُسبت إجابتي الصحيحة خاطئة؟' },
    a: { en: 'Report it from the review screen (⚑). If the answer key is confirmed wrong, the question is archived and the points of everyone affected this season are refunded automatically.',
         ar: 'بلّغ عنها من شاشة المراجعة (⚑). إن ثبت خطأ الإجابة النموذجية تُؤرشف ويُعاد تلقائيًا نقاط كل المتضررين في هذا الموسم.' } },
  { q: { en: 'Can I play without an account?', ar: 'هل ألعب بلا حساب؟' },
    a: { en: 'Yes, as a guest. Guest progress is temporary; register to keep your points, streaks and achievements.',
         ar: 'نعم كزائر. تقدّم الزائر مؤقت؛ سجّل حسابًا لتحفظ نقاطك وسلاسلك وإنجازاتك.' } },
  { q: { en: 'How do I delete my account or download my data?', ar: 'كيف أحذف حسابي أو أحمّل بياناتي؟' },
    a: { en: 'Settings → Danger zone deletes the account (personal data is anonymised). Settings → Download my data gives you a JSON export.',
         ar: 'الإعدادات → منطقة الخطر لحذف الحساب (تُجهَّل البيانات الشخصية). الإعدادات → تنزيل بياناتي يعطيك ملف JSON.' } },
  { q: { en: 'Does it work offline?', ar: 'هل يعمل دون اتصال؟' },
    a: { en: 'The demo plays fully offline once installed. The full app needs a connection because the server referees every answer; the timer pauses while you are offline.',
         ar: 'النسخة التجريبية تعمل دون اتصال بعد تثبيتها. التطبيق الكامل يحتاج اتصالًا لأن الخادم يحكّم كل إجابة؛ ويتوقف العدّاد أثناء الانقطاع.' } },
];

export function HelpPage() {
  const { t, lang } = useI18n();
  const support = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;
  return (
    <div className="page narrow">
      <h1>❓ {t('help')}</h1>
      <div className="card">
        {FAQ.map((f, i) => (
          <details key={i} style={{ padding: '8px 0', borderBottom: i < FAQ.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{f.q[lang]}</summary>
            <p className="muted" style={{ margin: '6px 0 0' }}>{f.a[lang]}</p>
          </details>
        ))}
      </div>
      <div className="card">
        <h2>{t('contactSupport')}</h2>
        <p className="muted">{t('contactHint')}</p>
        <div className="row">
          {support && <a className="btn" href={`mailto:${support}?subject=${encodeURIComponent('Quiz Platform')}`}>✉️ {support}</a>}
          <a className="btn secondary" href="https://github.com/daood40/quiz/issues" target="_blank" rel="noreferrer">🐞 {t('reportBug')}</a>
          <a className="btn secondary" href={`${(import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/api\/v1$/, '') ?? ''}/ready`} target="_blank" rel="noreferrer">📡 {t('systemStatus')}</a>
        </div>
      </div>
    </div>
  );
}
