import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'ar' | 'en';

const dict = {
  appName: { en: 'Quiz Platform', ar: 'منصة الأسئلة' },
  home: { en: 'Home', ar: 'الرئيسية' },
  play: { en: 'Play', ar: 'العب' },
  leaderboard: { en: 'Leaderboard', ar: 'المتصدرون' },
  challenges: { en: 'Challenges', ar: 'التحديات' },
  tournaments: { en: 'Tournaments', ar: 'البطولات' },
  groups: { en: 'Groups', ar: 'المجموعات' },
  profile: { en: 'Profile', ar: 'الملف الشخصي' },
  stats: { en: 'Statistics', ar: 'الإحصائيات' },
  achievements: { en: 'Achievements', ar: 'الإنجازات' },
  notifications: { en: 'Notifications', ar: 'الإشعارات' },
  admin: { en: 'Admin', ar: 'الإدارة' },
  login: { en: 'Log in', ar: 'تسجيل الدخول' },
  register: { en: 'Create account', ar: 'إنشاء حساب' },
  logout: { en: 'Log out', ar: 'تسجيل الخروج' },
  guest: { en: 'Try as guest', ar: 'جرّب كزائر' },
  email: { en: 'Email', ar: 'البريد الإلكتروني' },
  username: { en: 'Username', ar: 'اسم المستخدم' },
  emailOrUsername: { en: 'Email or username', ar: 'البريد أو اسم المستخدم' },
  password: { en: 'Password', ar: 'كلمة المرور' },
  displayName: { en: 'Display name', ar: 'الاسم الظاهر' },
  forgotPassword: { en: 'Forgot password?', ar: 'نسيت كلمة المرور؟' },
  resetPassword: { en: 'Reset password', ar: 'إعادة تعيين كلمة المرور' },
  changePassword: { en: 'Change password', ar: 'تغيير كلمة المرور' },
  greeting: { en: 'Welcome back', ar: 'مرحبًا بعودتك' },
  level: { en: 'Level', ar: 'المستوى' },
  points: { en: 'Points', ar: 'النقاط' },
  streak: { en: 'Streak', ar: 'السلسلة' },
  days: { en: 'days', ar: 'يوم' },
  dailyChallenge: { en: 'Daily Quiz', ar: 'اختبار اليوم' },
  monthlyChallenge: { en: 'Monthly Challenge', ar: 'التحدي الشهري' },
  quickQuiz: { en: 'Quick Quiz', ar: 'اختبار سريع' },
  categories: { en: 'Categories', ar: 'التصنيفات' },
  recentResults: { en: 'Recent Results', ar: 'النتائج الأخيرة' },
  startQuiz: { en: 'Start Quiz', ar: 'ابدأ الاختبار' },
  category: { en: 'Category', ar: 'التصنيف' },
  anyCategory: { en: 'Any category', ar: 'أي تصنيف' },
  difficulty: { en: 'Difficulty', ar: 'الصعوبة' },
  anyDifficulty: { en: 'Any difficulty', ar: 'أي صعوبة' },
  easy: { en: 'Easy', ar: 'سهل' },
  medium: { en: 'Medium', ar: 'متوسط' },
  hard: { en: 'Hard', ar: 'صعب' },
  expert: { en: 'Expert', ar: 'خبير' },
  questions: { en: 'Questions', ar: 'الأسئلة' },
  question: { en: 'Question', ar: 'سؤال' },
  mode: { en: 'Mode', ar: 'النمط' },
  practice: { en: 'Practice', ar: 'تدريب' },
  timed: { en: 'Timed', ar: 'موقّت' },
  submit: { en: 'Submit', ar: 'إرسال' },
  skip: { en: 'Skip', ar: 'تخطّي' },
  next: { en: 'Next', ar: 'التالي' },
  finish: { en: 'Finish', ar: 'إنهاء' },
  score: { en: 'Score', ar: 'النتيجة' },
  correct: { en: 'Correct', ar: 'صحيحة' },
  incorrect: { en: 'Wrong', ar: 'خاطئة' },
  timeout: { en: 'Timed out', ar: 'انتهى الوقت' },
  skipped: { en: 'Skipped', ar: 'متخطّاة' },
  partial: { en: 'Partial', ar: 'جزئية' },
  accuracy: { en: 'Accuracy', ar: 'الدقة' },
  totalTime: { en: 'Total time', ar: 'الوقت الكلي' },
  rank: { en: 'Rank', ar: 'الترتيب' },
  reviewAnswers: { en: 'Review Answers', ar: 'مراجعة الإجابات' },
  tryAgain: { en: 'Try Again', ar: 'حاول مجددًا' },
  share: { en: 'Share Result', ar: 'مشاركة النتيجة' },
  yourAnswer: { en: 'Your answer', ar: 'إجابتك' },
  correctAnswer: { en: 'Correct answer', ar: 'الإجابة الصحيحة' },
  explanation: { en: 'Explanation', ar: 'الشرح' },
  global: { en: 'Global', ar: 'عالمي' },
  country: { en: 'Country', ar: 'الدولة' },
  friends: { en: 'Friends', ar: 'الأصدقاء' },
  daily: { en: 'Daily', ar: 'يومي' },
  weekly: { en: 'Weekly', ar: 'أسبوعي' },
  monthly: { en: 'Monthly', ar: 'شهري' },
  createChallenge: { en: 'Create Challenge', ar: 'أنشئ تحديًا' },
  joinByCode: { en: 'Join with code', ar: 'انضم برمز' },
  join: { en: 'Join', ar: 'انضم' },
  start: { en: 'Start', ar: 'ابدأ' },
  invite: { en: 'Invite', ar: 'دعوة' },
  code: { en: 'Code', ar: 'الرمز' },
  status: { en: 'Status', ar: 'الحالة' },
  participants: { en: 'Participants', ar: 'المشاركون' },
  createGroup: { en: 'Create Group', ar: 'أنشئ مجموعة' },
  members: { en: 'Members', ar: 'الأعضاء' },
  leave: { en: 'Leave', ar: 'مغادرة' },
  name: { en: 'Name', ar: 'الاسم' },
  description: { en: 'Description', ar: 'الوصف' },
  public: { en: 'Public', ar: 'عامة' },
  search: { en: 'Search', ar: 'بحث' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  language: { en: 'Language', ar: 'اللغة' },
  theme: { en: 'Theme', ar: 'المظهر' },
  light: { en: 'Light', ar: 'فاتح' },
  dark: { en: 'Dark', ar: 'داكن' },
  save: { en: 'Save', ar: 'حفظ' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  error: { en: 'Something went wrong', ar: 'حدث خطأ ما' },
  retry: { en: 'Retry', ar: 'إعادة المحاولة' },
  reportQuestion: { en: 'Report question', ar: 'الإبلاغ عن السؤال' },
  timeLeft: { en: 'Time left', ar: 'الوقت المتبقي' },
  best: { en: 'Best', ar: 'الأفضل' },
  quizzes: { en: 'Quizzes', ar: 'الاختبارات' },
  answered: { en: 'Answered', ar: 'أُجيبت' },
  avgTime: { en: 'Avg time', ar: 'متوسط الوقت' },
  bestCategory: { en: 'Best category', ar: 'أفضل تصنيف' },
  weakestCategory: { en: 'Weakest category', ar: 'أضعف تصنيف' },
  activity: { en: 'Activity', ar: 'النشاط' },
  played: { en: 'Played', ar: 'لعبت' },
  xp: { en: 'XP', ar: 'الخبرة' },
  perfect: { en: 'Perfect!', ar: 'مثالي!' },
  levelUp: { en: 'Level up!', ar: 'مستوى جديد!' },
  newAchievement: { en: 'Achievement unlocked', ar: 'إنجاز جديد' },
  noData: { en: 'Nothing here yet', ar: 'لا يوجد شيء بعد' },
  confirm: { en: 'Confirm', ar: 'تأكيد' },
  delete: { en: 'Delete', ar: 'حذف' },
  deleteAccount: { en: 'Delete account', ar: 'حذف الحساب' },
  guestBanner: { en: 'You are playing as a guest — create an account to save your progress.', ar: 'أنت تلعب كزائر — أنشئ حسابًا لحفظ تقدمك.' },
  played1: { en: 'quizzes played', ar: 'اختبارًا لعبت' },
  won: { en: 'Winner', ar: 'الفائز' },
  round: { en: 'Round', ar: 'الجولة' },
  match: { en: 'Match', ar: 'المباراة' },
  champion: { en: 'Champion', ar: 'البطل' },
  playMatch: { en: 'Play your match', ar: 'العب مباراتك' },
  registration: { en: 'Registration open', ar: 'التسجيل مفتوح' },
  running: { en: 'Running', ar: 'جارية' },
  completed: { en: 'Completed', ar: 'مكتملة' },
  expired: { en: 'Expired', ar: 'منتهية' },
  open: { en: 'Open', ar: 'مفتوح' },
  confidence: { en: 'How confident are you?', ar: 'ما مدى ثقتك؟' },
  knew: { en: 'I knew it', ar: 'كنت أعرفها' },
  didntKnow: { en: "I didn't know", ar: 'لم أعرفها' },
  reveal: { en: 'Reveal answer', ar: 'اكشف الإجابة' },
  across: { en: 'Across', ar: 'أفقي' },
  spinWheel: { en: 'Spin for a random category', ar: 'دوّر العجلة لتصنيف عشوائي' },
  modeSpeed: { en: 'Speed', ar: 'سرعة' },
  modeSpeedDesc: { en: '10s per question · double speed bonus', ar: '10 ثوانٍ للسؤال · مكافأة سرعة أعلى' },
  modeSurvival: { en: 'Survival', ar: 'البقاء' },
  modeSurvivalDesc: { en: 'One wrong answer ends the run', ar: 'خطأ واحد ينهي الجولة' },
  modeKnowledge: { en: 'Knowledge', ar: 'معرفة' },
  modeKnowledgeDesc: { en: 'Hard questions · 60s · no speed bonus', ar: 'أسئلة صعبة · 60 ثانية · بلا مكافأة سرعة' },
  survivalOver: { en: 'Run over — one wrong answer', ar: 'انتهت الجولة — إجابة خاطئة' },
  largeText: { en: 'Large text', ar: 'نص كبير' },
  autoAdvance: { en: 'Auto-advance', ar: 'انتقال تلقائي' },
  shareImage: { en: 'Share as image', ar: 'مشاركة كصورة' },
  keyboardHint: { en: 'Keys 1–4 answer · Enter submits', ar: 'مفاتيح 1–4 للإجابة · Enter للإرسال' },
  down: { en: 'Down', ar: 'رأسي' },
  typeAnswer: { en: 'Type your answer…', ar: 'اكتب إجابتك…' },
  dragToOrder: { en: 'Tap items in the correct order', ar: 'اضغط العناصر بالترتيب الصحيح' },
  reset: { en: 'Reset', ar: 'إعادة' },
  matchLeft: { en: 'Match each item', ar: 'طابق كل عنصر' },
  clickImage: { en: 'Click the correct location', ar: 'اضغط على الموقع الصحيح' },
  offline: { en: 'You appear to be offline — answers will fail until connection returns.', ar: 'يبدو أنك غير متصل — لن تُرسل الإجابات حتى عودة الاتصال.' },
  modePractice: { en: 'Practice', ar: 'تدريب' },
  modePracticeDesc: { en: 'Untimed · instant feedback', ar: 'بلا وقت · تصحيح فوري' },
  modeTimed: { en: 'Timed', ar: 'موقّت' },
  modeTimedDesc: { en: 'Speed bonus · power-ups', ar: 'مكافأة سرعة · مساعدات' },
  modeReview: { en: 'Review mistakes', ar: 'راجع أخطاءك' },
  modeReviewDesc: { en: 'Replay what you missed', ar: 'أعد ما أخطأت فيه' },
  untimed: { en: 'Untimed', ar: 'بلا مؤقّت' },
  feedbackCorrect: { en: 'Correct!', ar: 'إجابة صحيحة!' },
  feedbackWrong: { en: 'Not quite', ar: 'ليست صحيحة' },
  addFriend: { en: 'Add friend', ar: 'أضف صديقًا' },
  friendRequests: { en: 'Friend requests', ar: 'طلبات الصداقة' },
  accept: { en: 'Accept', ar: 'قبول' },
  decline: { en: 'Decline', ar: 'رفض' },
  remove: { en: 'Remove', ar: 'إزالة' },
  sound: { en: 'Sound effects', ar: 'المؤثرات الصوتية' },
  playedToday: { en: "Today's quiz done ✓", ar: 'أنجزت اختبار اليوم ✓' },
  streakFreezes: { en: 'Streak freezes', ar: 'حماية السلسلة' },
  avatarPick: { en: 'Choose your avatar', ar: 'اختر صورتك الرمزية' },
  sameForAll: { en: 'Same questions for everyone today', ar: 'نفس الأسئلة للجميع اليوم' },
  demoBanner: {
    en: 'Live demo — runs fully in your browser. Competitions, friends and admin need the full server (see the repo).',
    ar: 'نسخة تجريبية مباشرة — تعمل كاملة في متصفحك. المنافسات والأصدقاء والإدارة تتطلب الخادم الكامل (انظر المستودع).',
  },
} as const;

export type TKey = keyof typeof dict;

interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: (key: TKey) => string;
  /** picks localized value from {ar, en} objects coming from the API */
  pick: (obj: unknown) => string;
  setLang: (l: Lang) => void;
}

const I18nContext = createContext<I18n>(null as never);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('lang') as Lang) || 'en');
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const value = useMemo<I18n>(
    () => ({
      lang,
      dir,
      t: (key) => dict[key]?.[lang] ?? dict[key]?.en ?? key,
      pick: (obj) => {
        if (typeof obj === 'string') return obj;
        if (obj && typeof obj === 'object') {
          const o = obj as Record<string, string>;
          return o[lang] || o.en || o.ar || '';
        }
        return '';
      },
      setLang: (l) => {
        localStorage.setItem('lang', l);
        setLangState(l);
      },
    }),
    [lang, dir],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
