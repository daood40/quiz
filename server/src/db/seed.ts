/**
 * Seed data. Two layers:
 *  - CORE (idempotent, safe in production): categories, achievements, super admin.
 *  - DEV (skipped when NODE_ENV=production unless SEED_DEV=true): sample users
 *    and a starter question bank covering every question family.
 */
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { closePool, query } from './pool.js';
import { computeContentHash } from '../modules/questions/service.js';
import { registry } from '../modules/questions/engine/registry.js';

const CATEGORIES = [
  ['general', { en: 'General Knowledge', ar: 'معلومات عامة' }, '🌍'],
  ['science', { en: 'Science', ar: 'العلوم' }, '🔬'],
  ['history', { en: 'History', ar: 'التاريخ' }, '🏺'],
  ['geography', { en: 'Geography', ar: 'الجغرافيا' }, '🗺️'],
  ['sports', { en: 'Sports', ar: 'الرياضة' }, '⚽'],
  ['technology', { en: 'Technology', ar: 'التقنية' }, '💻'],
  ['islamic', { en: 'Islamic', ar: 'إسلاميات' }, '🕌'],
  ['literature', { en: 'Literature', ar: 'الأدب' }, '📚'],
  ['languages', { en: 'Languages', ar: 'اللغات' }, '🔤'],
  ['mathematics', { en: 'Mathematics', ar: 'الرياضيات' }, '➗'],
] as const;

const ACHIEVEMENTS: Array<[string, { en: string; ar: string }, { metric: string; gte: number }, number]> = [
  ['first-quiz', { en: 'First Quiz', ar: 'أول اختبار' }, { metric: 'quizzes_completed', gte: 1 }, 25],
  ['ten-quizzes', { en: '10 Quizzes', ar: '10 اختبارات' }, { metric: 'quizzes_completed', gte: 10 }, 50],
  ['hundred-quizzes', { en: '100 Quizzes', ar: '100 اختبار' }, { metric: 'quizzes_completed', gte: 100 }, 200],
  ['hundred-correct', { en: '100 Correct Answers', ar: '100 إجابة صحيحة' }, { metric: 'correct_total', gte: 100 }, 100],
  ['thousand-correct', { en: '1000 Correct Answers', ar: '1000 إجابة صحيحة' }, { metric: 'correct_total', gte: 1000 }, 500],
  ['perfect-quiz', { en: 'Perfect Quiz', ar: 'اختبار مثالي' }, { metric: 'perfect_quizzes', gte: 1 }, 75],
  ['week-streak', { en: '7-Day Streak', ar: 'سلسلة 7 أيام' }, { metric: 'current_streak', gte: 7 }, 100],
  ['month-streak', { en: '30-Day Streak', ar: 'سلسلة 30 يوم' }, { metric: 'current_streak', gte: 30 }, 500],
  ['level-10', { en: 'Level 10', ar: 'المستوى 10' }, { metric: 'level', gte: 10 }, 150],
  ['points-10k', { en: '10K Points', ar: '10 آلاف نقطة' }, { metric: 'total_points', gte: 10000 }, 250],
  ['points-100k', { en: 'Champion', ar: 'البطل' }, { metric: 'total_points', gte: 100000 }, 1000],
];

type SeedQuestion = {
  type: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  language: 'ar' | 'en';
  content: Record<string, unknown>;
  correct: unknown;
  config?: Record<string, unknown>;
  explanation?: Record<string, string>;
  tags?: string[];
};

const opts = (...texts: string[]) => texts.map((t, i) => ({ id: `o${i + 1}`, text: t }));

function sampleQuestions(): SeedQuestion[] {
  const qs: SeedQuestion[] = [
    // --- single choice ---
    { type: 'multiple_choice', category: 'geography', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'What is the capital of France?', ar: 'ما هي عاصمة فرنسا؟' }, options: opts('Paris', 'London', 'Berlin', 'Madrid') },
      correct: 'o1', explanation: { en: 'Paris has been the capital of France since 987 CE.', ar: 'باريس عاصمة فرنسا منذ عام 987م.' }, tags: ['capitals'] },
    { type: 'multiple_choice', category: 'science', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Which planet is known as the Red Planet?', ar: 'أي كوكب يُعرف بالكوكب الأحمر؟' }, options: opts('Mars', 'Venus', 'Jupiter', 'Mercury') },
      correct: 'o1', explanation: { en: 'Iron oxide on its surface gives Mars its red color.' }, tags: ['space'] },
    { type: 'multiple_choice', category: 'islamic', difficulty: 'easy', language: 'ar',
      content: { prompt: { ar: 'كم عدد أركان الإسلام؟', en: 'How many pillars of Islam are there?' }, options: opts('خمسة', 'أربعة', 'ستة', 'ثلاثة') },
      correct: 'o1', explanation: { ar: 'أركان الإسلام خمسة: الشهادتان والصلاة والزكاة والصوم والحج.' } },
    { type: 'multiple_choice', category: 'technology', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'What does "HTTP" stand for?' }, options: opts('HyperText Transfer Protocol', 'High Tech Transfer Process', 'Hyperlink Text Type Protocol', 'Home Tool Transfer Protocol') },
      correct: 'o1', tags: ['web'] },
    { type: 'true_false', category: 'science', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Water boils at 100°C at sea level.', ar: 'يغلي الماء عند 100 درجة مئوية عند مستوى سطح البحر.' }, options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] },
      correct: 'true' },
    { type: 'true_false', category: 'history', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'The Great Wall of China is visible from the Moon with the naked eye.' }, options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] },
      correct: 'false', explanation: { en: 'It is far too narrow to be seen from the Moon without aid.' } },
    { type: 'yes_no', category: 'general', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Is the Pacific the largest ocean on Earth?' }, options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
      correct: 'yes' },
    { type: 'odd_one_out', category: 'science', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Which one is NOT a mammal?' }, options: opts('Shark', 'Whale', 'Dolphin', 'Bat') },
      correct: 'o1', explanation: { en: 'Sharks are fish; whales, dolphins and bats are mammals.' } },
    { type: 'logic_puzzle', category: 'mathematics', difficulty: 'hard', language: 'en',
      content: { prompt: { en: 'All Bloops are Razzies. All Razzies are Lazzies. Which statement must be true?' }, options: opts('All Bloops are Lazzies', 'All Lazzies are Bloops', 'No Razzies are Bloops', 'Some Lazzies are not Razzies') },
      correct: 'o1' },
    { type: 'pattern_recognition', category: 'mathematics', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'What comes next: 2, 4, 8, 16, ...?' }, options: opts('32', '24', '20', '30') },
      correct: 'o1' },
    { type: 'scenario_question', category: 'technology', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Your app is slow only on the first page load. What is the MOST likely cause?' }, options: opts('Large uncached bundle', 'Database index missing', 'Memory leak', 'DNS outage') },
      correct: 'o1' },
    { type: 'comparison', category: 'geography', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Which river is longer?' }, options: opts('The Nile', 'The Danube') }, correct: 'o1' },
    { type: 'color_question', category: 'science', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Mixing blue and yellow paint gives which color?' }, options: opts('Green', 'Purple', 'Orange', 'Brown') },
      correct: 'o1' },
    // --- multi choice ---
    { type: 'multiple_select', category: 'science', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Select ALL noble gases.', ar: 'اختر جميع الغازات النبيلة.' }, options: opts('Helium', 'Neon', 'Oxygen', 'Argon', 'Nitrogen') },
      correct: ['o1', 'o2', 'o4'], config: { partialCredit: true } },
    { type: 'multiple_select', category: 'geography', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Which of these countries are in Africa?' }, options: opts('Kenya', 'Morocco', 'Peru', 'Ghana', 'Nepal') },
      correct: ['o1', 'o2', 'o4'], config: { partialCredit: true } },
    { type: 'select_from_grid', category: 'mathematics', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Select all even numbers.' }, options: opts('2', '4', '7', '9', '10', '13') },
      correct: ['o1', 'o2', 'o5'], config: { partialCredit: true } },
    // --- text ---
    { type: 'fill_blank', category: 'science', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'The chemical symbol for water is ____.' } },
      correct: { accepted: ['H2O', 'h2o'] } },
    { type: 'short_answer', category: 'history', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Who painted the Mona Lisa?' } },
      correct: { accepted: ['Leonardo da Vinci', 'da Vinci', 'Leonardo'] } },
    { type: 'short_answer', category: 'islamic', difficulty: 'easy', language: 'ar',
      content: { prompt: { ar: 'في أي مدينة يقع المسجد الحرام؟' } },
      correct: { accepted: ['مكة', 'مكة المكرمة'] } },
    { type: 'word_scramble', category: 'languages', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Unscramble the letters to form a fruit: PALEP' } },
      correct: { accepted: ['apple'] } },
    { type: 'anagram', category: 'languages', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Find an anagram of "LISTEN" that means quiet.' } },
      correct: { accepted: ['silent'] } },
    { type: 'spelling', category: 'languages', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Spell the word meaning "a person who writes books".' } },
      correct: { accepted: ['author'] } },
    { type: 'missing_letters', category: 'languages', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Complete the word: E_EP_ANT (a large animal)' } },
      correct: { accepted: ['elephant'] } },
    { type: 'hangman', category: 'geography', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Guess the country: _ _ _ _ _ (South American, capital Lima)' } },
      correct: { accepted: ['peru'] } },
    { type: 'sentence_completion', category: 'literature', difficulty: 'medium', language: 'en',
      content: { prompt: { en: '"To be, or not to be, that is the ____." — Shakespeare' } },
      correct: { accepted: ['question'] } },
    { type: 'code_question', category: 'technology', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'In JavaScript, what does `typeof null` return? (exact string)' } },
      correct: { accepted: ['object'] }, config: { matching: { caseSensitive: false } } },
    { type: 'formula_question', category: 'science', difficulty: 'medium', language: 'en',
      content: { prompt: { en: "State Einstein's mass–energy equivalence formula." } },
      correct: { accepted: ['E=mc2', 'E=mc^2', 'E = mc2', 'E = mc^2'] } },
    // --- numeric ---
    { type: 'numeric_answer', category: 'mathematics', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'How many continents are there on Earth?' } }, correct: 7 },
    { type: 'calculation', category: 'mathematics', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'What is 12 × 8?' } }, correct: 96 },
    { type: 'equation', category: 'mathematics', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Solve for x: 3x + 6 = 21' } }, correct: 5 },
    { type: 'fraction', category: 'mathematics', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'What is 1/2 + 1/4? (as a fraction or decimal)' } }, correct: { value: 0.75 } },
    { type: 'percentage', category: 'mathematics', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'What is 25% of 200?' } }, correct: 50 },
    { type: 'estimate', category: 'geography', difficulty: 'hard', language: 'en',
      content: { prompt: { en: 'Estimate the height of Mount Everest in meters (±10%).' } },
      correct: { value: 8849, tolerancePercent: 0.1 } },
    { type: 'slider_answer', category: 'science', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'At what temperature (°C) does water freeze?' }, min: -50, max: 50 }, correct: 0 },
    { type: 'scale_answer', category: 'science', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'On the pH scale of 0–14, what is the pH of pure water?' }, min: 0, max: 14 }, correct: 7 },
    // --- ordering ---
    { type: 'ordering', category: 'science', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Order the planets from closest to the Sun.' },
        items: [{ id: 'mercury', text: 'Mercury' }, { id: 'venus', text: 'Venus' }, { id: 'earth', text: 'Earth' }, { id: 'mars', text: 'Mars' }] },
      correct: ['mercury', 'venus', 'earth', 'mars'], config: { partialCredit: true } },
    { type: 'timeline', category: 'history', difficulty: 'hard', language: 'en',
      content: { prompt: { en: 'Order these events chronologically (earliest first).' },
        items: [{ id: 'pyramids', text: 'Great Pyramid built' }, { id: 'rome', text: 'Founding of Rome' }, { id: 'print', text: 'Printing press invented' }, { id: 'moon', text: 'Moon landing' }] },
      correct: ['pyramids', 'rome', 'print', 'moon'], config: { partialCredit: true } },
    { type: 'sequence', category: 'general', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Arrange the seasons starting from Spring.' },
        items: [{ id: 'spring', text: 'Spring' }, { id: 'summer', text: 'Summer' }, { id: 'autumn', text: 'Autumn' }, { id: 'winter', text: 'Winter' }] },
      correct: ['spring', 'summer', 'autumn', 'winter'], config: { partialCredit: true } },
    { type: 'sentence_ordering', category: 'languages', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Order the words to form a sentence.' },
        items: [{ id: 'w1', text: 'The' }, { id: 'w2', text: 'cat' }, { id: 'w3', text: 'sat' }, { id: 'w4', text: 'down' }] },
      correct: ['w1', 'w2', 'w3', 'w4'], config: { partialCredit: true } },
    { type: 'ranking', category: 'geography', difficulty: 'hard', language: 'en',
      content: { prompt: { en: 'Rank these countries by population (largest first).' },
        items: [{ id: 'india', text: 'India' }, { id: 'usa', text: 'USA' }, { id: 'brazil', text: 'Brazil' }, { id: 'egypt', text: 'Egypt' }] },
      correct: ['india', 'usa', 'brazil', 'egypt'], config: { partialCredit: true } },
    // --- matching / categorization ---
    { type: 'matching', category: 'geography', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Match each country to its capital.' },
        left: [{ id: 'jp', text: 'Japan' }, { id: 'eg', text: 'Egypt' }, { id: 'ca', text: 'Canada' }],
        right: [{ id: 'tokyo', text: 'Tokyo' }, { id: 'cairo', text: 'Cairo' }, { id: 'ottawa', text: 'Ottawa' }] },
      correct: { jp: 'tokyo', eg: 'cairo', ca: 'ottawa' }, config: { partialCredit: true } },
    { type: 'pairing', category: 'science', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Pair each scientist with their discovery.' },
        left: [{ id: 'newton', text: 'Newton' }, { id: 'curie', text: 'Curie' }, { id: 'darwin', text: 'Darwin' }],
        right: [{ id: 'gravity', text: 'Gravity' }, { id: 'radium', text: 'Radium' }, { id: 'evolution', text: 'Evolution' }] },
      correct: { newton: 'gravity', curie: 'radium', darwin: 'evolution' }, config: { partialCredit: true } },
    { type: 'categorization', category: 'science', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Sort each animal into its class.' },
        items: [{ id: 'eagle', text: 'Eagle' }, { id: 'salmon', text: 'Salmon' }, { id: 'lion', text: 'Lion' }, { id: 'frog', text: 'Frog' }],
        categories: [{ id: 'bird', text: 'Bird' }, { id: 'fish', text: 'Fish' }, { id: 'mammal', text: 'Mammal' }, { id: 'amphibian', text: 'Amphibian' }] },
      correct: { eagle: 'bird', salmon: 'fish', lion: 'mammal', frog: 'amphibian' }, config: { partialCredit: true } },
    { type: 'drag_drop', category: 'technology', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Drag each language to its main use.' },
        items: [{ id: 'sql', text: 'SQL' }, { id: 'css', text: 'CSS' }, { id: 'python', text: 'Python' }],
        categories: [{ id: 'db', text: 'Databases' }, { id: 'style', text: 'Styling' }, { id: 'scripting', text: 'Scripting' }] },
      correct: { sql: 'db', css: 'style', python: 'scripting' }, config: { partialCredit: true } },
    // --- hotspot / coordinates ---
    { type: 'coordinate_question', category: 'mathematics', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Click the point (0.5, 0.5) — the exact center of the grid.' } },
      correct: { regions: [{ shape: 'circle', x: 0.5, y: 0.5, r: 0.1 }] } },
    // --- grid puzzles ---
    { type: 'crossword', category: 'general', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Mini crossword: solve both clues.' },
        slots: [{ id: 'a1', clue: 'Opposite of day (5 letters)', length: 5 }, { id: 'a2', clue: 'Frozen water (3 letters)', length: 3 }] },
      correct: { entries: { a1: 'night', a2: 'ice' } }, config: { partialCredit: true } },
    { type: 'word_search', category: 'languages', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Find the three hidden animals.' },
        grid: ['CATXQ', 'ODOGR', 'WBIRD', 'XYZAB', 'LMNOP'] },
      correct: { words: ['cat', 'dog', 'bird'] }, config: { partialCredit: true } },
    { type: 'table_question', category: 'mathematics', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'Fill in the missing values of the multiplication table row for 7 (7×3 and 7×6).' },
        cells: [{ id: 'c1', label: '7 × 3' }, { id: 'c2', label: '7 × 6' }] },
      correct: { entries: { c1: '21', c2: '42' } }, config: { partialCredit: true } },
    // --- special ---
    { type: 'confidence_based', category: 'science', difficulty: 'hard', language: 'en',
      content: { prompt: { en: 'Which particle carries a negative charge?' }, options: opts('Electron', 'Proton', 'Neutron', 'Photon') },
      correct: 'o1' },
    { type: 'flashcard', category: 'languages', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'What is "book" in Arabic?' } }, correct: { back: 'كتاب (kitab)' } },
    // --- unscored ---
    { type: 'poll', category: 'general', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'Which quiz mode do you enjoy most?' }, options: opts('Practice', 'Timed', 'Challenges', 'Tournaments') },
      correct: null },
    { type: 'survey', category: 'general', difficulty: 'easy', language: 'en',
      content: { prompt: { en: 'How often do you play quizzes?' }, options: opts('Daily', 'Weekly', 'Occasionally') },
      correct: null },
    // --- submission ---
    { type: 'open_text', category: 'literature', difficulty: 'medium', language: 'en',
      content: { prompt: { en: 'In one sentence, what is the theme of "Romeo and Juliet"?' } },
      correct: { keywords: ['love'] }, config: { partialCredit: true } },
    // --- composite ---
    { type: 'reading_comprehension', category: 'literature', difficulty: 'medium', language: 'en',
      content: {
        prompt: { en: 'Read the passage and answer the questions.' },
        passage: { en: 'The honeybee is one of the most important pollinators on Earth. A single colony can contain up to 60,000 bees, and each worker bee produces about one-twelfth of a teaspoon of honey in its lifetime.' },
        parts: [
          { id: 'p1', type: 'multiple_choice', content: { prompt: { en: 'How many bees can a colony contain?' }, options: opts('Up to 60,000', 'Up to 6,000', 'Up to 600', 'Up to 6 million') } },
          { id: 'p2', type: 'true_false', content: { prompt: { en: 'A worker bee produces a full teaspoon of honey in its lifetime.' }, options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] }, configuration: { shuffleOptions: false } },
        ],
      },
      correct: { p1: 'o1', p2: 'false' }, config: { partialCredit: true } },
    { type: 'multi_part', category: 'mathematics', difficulty: 'hard', language: 'en',
      content: {
        prompt: { en: 'A rectangle is 8 cm long and 5 cm wide.' },
        parts: [
          { id: 'area', type: 'calculation', content: { prompt: { en: 'What is its area in cm²?' } } },
          { id: 'perimeter', type: 'calculation', content: { prompt: { en: 'What is its perimeter in cm?' } } },
        ],
      },
      correct: { area: 40, perimeter: 26 }, config: { partialCredit: true } },
  ];

  // generated arithmetic bank — bulk starter content
  const seedRandom = (n: number) => () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
  const rng = seedRandom(42);
  for (let i = 0; i < 60; i++) {
    const a = Math.floor(rng() * 90) + 10;
    const b = Math.floor(rng() * 90) + 10;
    const op = ['+', '-', '×'][i % 3];
    const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
    qs.push({
      type: 'calculation',
      category: 'mathematics',
      difficulty: op === '×' ? 'medium' : 'easy',
      language: i % 2 === 0 ? 'en' : 'ar',
      content: { prompt: { en: `What is ${a} ${op} ${b}?`, ar: `كم يساوي ${a} ${op} ${b}؟` } },
      correct: answer,
      tags: ['arithmetic', 'generated'],
    });
  }
  return qs;
}

export async function seed(): Promise<void> {
  // ---------- CORE ----------
  for (let i = 0; i < CATEGORIES.length; i++) {
    const [slug, name, icon] = CATEGORIES[i];
    await query(
      `INSERT INTO categories (slug, name, icon, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, JSON.stringify(name), icon, i],
    );
  }
  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    const [slug, name, criteria, xp] = ACHIEVEMENTS[i];
    await query(
      `INSERT INTO achievements (slug, name, description, criteria, xp_reward, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING`,
      [slug, JSON.stringify(name), JSON.stringify(name), JSON.stringify(criteria), xp, i],
    );
  }

  // super admin — password from env or generated & printed once
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@quiz.local';
  const existing = await query('SELECT 1 FROM users WHERE email = $1', [adminEmail]);
  if (!existing.rowCount) {
    const password = process.env.SEED_ADMIN_PASSWORD ?? `Admin!${Math.random().toString(36).slice(2, 10)}`;
    const hash = await bcrypt.hash(password, env.bcryptRounds);
    const { rows } = await query(
      `INSERT INTO users (email, username, display_name, password_hash, role, email_verified_at)
       VALUES ($1, 'admin', 'Administrator', $2, 'super_admin', now()) RETURNING id`,
      [adminEmail, hash],
    );
    await query('INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
    console.log(`Created super admin ${adminEmail} — password: ${password}`);
    if (!process.env.SEED_ADMIN_PASSWORD) console.log('(set SEED_ADMIN_PASSWORD to control this; change it after first login)');
  }

  // ---------- DEV ----------
  if (env.isProd && process.env.SEED_DEV !== 'true') {
    console.log('Production: skipping dev sample data');
    return;
  }
  const cats = await query('SELECT id, slug FROM categories');
  const catMap = new Map<string, string>(cats.rows.map((c) => [c.slug, c.id]));

  let inserted = 0;
  for (const q of sampleQuestions()) {
    const errors = registry.validate(q.type, {
      type: q.type,
      content: q.content,
      correctAnswer: q.correct,
      configuration: q.config ?? {},
    });
    if (errors.length) {
      console.warn(`Seed question skipped (${q.type}): ${errors.join('; ')}`);
      continue;
    }
    const hash = computeContentHash(q.type, q.content, q.correct);
    const dupe = await query('SELECT 1 FROM questions WHERE content_hash = $1', [hash]);
    if (dupe.rowCount) continue;
    const { rows } = await query(
      `INSERT INTO questions (type, category_id, difficulty, language, content, correct_answer, configuration,
         explanation, tags, status, content_hash, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10,'seed') RETURNING id`,
      [
        q.type, catMap.get(q.category) ?? null, q.difficulty, q.language,
        JSON.stringify(q.content), JSON.stringify(q.correct ?? null), JSON.stringify(q.config ?? {}),
        JSON.stringify(q.explanation ?? {}), q.tags ?? [], hash,
      ],
    );
    await query('INSERT INTO question_stats (question_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
    inserted++;
  }
  console.log(`Seeded ${inserted} questions`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  seed()
    .then(() => closePool())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
