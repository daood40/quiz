import { Link } from 'react-router-dom';
import { useI18n, type TKey } from '../i18n';
import { usePageMeta } from '../components';

/** Section pairs (heading key, paragraph key) — every visible string comes from i18n.tsx. */
const PRIVACY_SECTIONS: Array<[TKey, TKey]> = [
  ['privacy_collect_h', 'privacy_collect_p'],
  ['privacy_technical_h', 'privacy_technical_p'],
  ['privacy_why_h', 'privacy_why_p'],
  ['privacy_storage_h', 'privacy_storage_p'],
  ['privacy_local_h', 'privacy_local_p'],
  ['privacy_retention_h', 'privacy_retention_p'],
  ['privacy_rights_h', 'privacy_rights_p'],
  ['privacy_mobile_h', 'privacy_mobile_p'],
  ['privacy_children_h', 'privacy_children_p'],
  ['privacy_changes_h', 'privacy_changes_p'],
];

const TERMS_SECTIONS: Array<[TKey, TKey]> = [
  ['terms_eligibility_h', 'terms_eligibility_p'],
  ['terms_fairplay_h', 'terms_fairplay_p'],
  ['terms_content_h', 'terms_content_p'],
  ['terms_conduct_h', 'terms_conduct_p'],
  ['terms_noPay_h', 'terms_noPay_p'],
  ['terms_availability_h', 'terms_availability_p'],
];

const DELETION_SECTIONS: Array<[TKey, TKey]> = [
  ['deletion_inApp_h', 'deletion_inApp_p'],
  ['deletion_deleted_h', 'deletion_deleted_p'],
  ['deletion_kept_h', 'deletion_kept_p'],
];

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;

function LegalDoc({ title, updated, rows, contact }: { title: string; updated: string; rows: string[][]; contact?: string }) {
  const { t } = useI18n();
  usePageMeta(title, t('metaDescLegal'));
  return (
    <div className="card legal-doc">
      <h1>{title}</h1>
      <p className="muted">{updated}</p>
      {rows.map(([h, p]) => (
        <section key={h} style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 16 }}>{h}</h2>
          <p style={{ margin: 0 }}>{p}</p>
        </section>
      ))}
      {contact && (
        <p className="muted" style={{ marginTop: 18 }}>
          {contact.split('{email}')[0]}<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{contact.split('{email}')[1]}
        </p>
      )}
    </div>
  );
}

function sections(t: (k: TKey) => string, list: Array<[TKey, TKey]>): string[][] {
  return list.map(([h, p]) => [t(h), t(p)]);
}

export function PrivacyPage() {
  const { t } = useI18n();
  return <LegalDoc title={t('privacy')} updated={`${t('lastUpdated')}: 2026-09-09`} rows={sections(t, PRIVACY_SECTIONS)} contact={SUPPORT_EMAIL ? t('legal_contact_email') : undefined} />;
}

export function TermsPage() {
  const { t } = useI18n();
  return <LegalDoc title={t('terms')} updated={`${t('lastUpdated')}: 2026-09-09`} rows={sections(t, TERMS_SECTIONS)} contact={SUPPORT_EMAIL ? t('legal_contact_email') : undefined} />;
}

/** Public account-deletion instructions (required by Google Play and App Store review). */
export function AccountDeletionPage() {
  const { t } = useI18n();
  const rows = sections(t, DELETION_SECTIONS);
  rows.push([t('deletion_noAccess_h'), SUPPORT_EMAIL ? t('deletion_noAccess_p').replace('{email}', SUPPORT_EMAIL) : t('deletion_noAccess_fallback')]);
  return <LegalDoc title={t('deleteAccountPage')} updated={`${t('lastUpdated')}: 2026-09-09`} rows={rows} />;
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
      <Link to="/delete-account">{t('deleteAccountPage')}</Link>
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
    a: { en: 'Settings → Delete account: type your username and password, then confirm (personal data is anonymised at once). Settings → Download my data gives you a JSON export.',
         ar: 'الإعدادات → حذف الحساب: اكتب اسم المستخدم وكلمة المرور ثم أكّد (تُجهَّل بياناتك الشخصية فورًا). الإعدادات → نزّل بياناتي يعطيك ملف JSON.' } },
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
