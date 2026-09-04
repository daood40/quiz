/**
 * Question families — the interaction primitives behind all registered types.
 * Each family implements validate / score / present with real logic.
 */
import {
  EngineQuestion,
  PresentedQuestion,
  QuestionFamily,
  ScoreResult,
  ratioToResult,
} from './types';
import {
  NumericMatchConfig,
  TextMatchConfig,
  numericMatches,
  parseNumeric,
  textMatches,
} from './normalize';

type Opt = { id: string; text?: unknown; media?: unknown };

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function hasPrompt(content: Record<string, unknown>): boolean {
  const p = content.prompt;
  if (typeof p === 'string') return p.trim().length > 0;
  const o = asObj(p);
  return str(o.en).trim().length > 0 || str(o.ar).trim().length > 0;
}
function options(content: Record<string, unknown>): Opt[] {
  return asArray(content.options).map((o) => asObj(o) as Opt);
}
function optionIds(content: Record<string, unknown>): string[] {
  return options(content).map((o) => str(o.id));
}
function uniqueNonEmpty(ids: string[]): boolean {
  return ids.every((i) => i.length > 0) && new Set(ids).size === ids.length;
}
function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function optionTextsDuplicated(content: Record<string, unknown>): boolean {
  const texts = options(content)
    .map((o) => (typeof o.text === 'string' ? o.text.trim().toLowerCase() : JSON.stringify(o.text ?? o.media)))
    .filter((t) => t.length > 0);
  return new Set(texts).size !== texts.length;
}
function partialEnabled(q: EngineQuestion): boolean {
  return q.configuration.partialCredit === true;
}
function textCfg(q: EngineQuestion): TextMatchConfig {
  const c = asObj(q.configuration.matching);
  return {
    caseSensitive: c.caseSensitive === true,
    normalizeArabic: c.normalizeArabic !== false,
    typoTolerance: typeof c.typoTolerance === 'number' ? c.typoTolerance : 0,
    matchMode: c.matchMode === 'contains' ? 'contains' : 'exact',
  };
}
function acceptedAnswers(q: EngineQuestion): string[] {
  const ca = q.correctAnswer;
  if (typeof ca === 'string') return [ca];
  if (Array.isArray(ca)) return ca.filter((x): x is string => typeof x === 'string');
  const o = asObj(ca);
  if (Array.isArray(o.accepted)) return o.accepted.filter((x): x is string => typeof x === 'string');
  if (typeof o.value === 'string') return [o.value];
  return [];
}
function stripAnswers(content: Record<string, unknown>): Record<string, unknown> {
  const { correct: _c, correctAnswer: _ca, answer: _a, answers: _as, solution: _s, ...rest } = content;
  return rest;
}

// ---------------------------------------------------------------- single_choice
const singleChoice: QuestionFamily = {
  id: 'single_choice',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const ids = optionIds(q.content);
    if (ids.length < 2) errors.push('at least 2 options are required');
    if (!uniqueNonEmpty(ids)) errors.push('option ids must be unique and non-empty');
    if (optionTextsDuplicated(q.content)) errors.push('duplicate options are not allowed');
    const ca = typeof q.correctAnswer === 'string' ? q.correctAnswer : str(asObj(q.correctAnswer).optionId);
    if (!ca) errors.push('correct answer is required');
    else if (ids.length && !ids.includes(ca)) errors.push('correct answer must reference an existing option');
    return errors;
  },
  score(q, answer) {
    const ca = typeof q.correctAnswer === 'string' ? q.correctAnswer : str(asObj(q.correctAnswer).optionId);
    const given = typeof answer === 'string' ? answer : str(asObj(answer).optionId);
    return ratioToResult(given && given === ca ? 1 : 0, false);
  },
  present(q, rng) {
    const content = stripAnswers(q.content);
    if (q.configuration.shuffleOptions !== false) {
      content.options = shuffled(options(q.content), rng);
    }
    return { content, serverMeta: {} };
  },
};

// ---------------------------------------------------------------- multi_choice
const multiChoice: QuestionFamily = {
  id: 'multi_choice',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const ids = optionIds(q.content);
    if (ids.length < 2) errors.push('at least 2 options are required');
    if (!uniqueNonEmpty(ids)) errors.push('option ids must be unique and non-empty');
    if (optionTextsDuplicated(q.content)) errors.push('duplicate options are not allowed');
    const ca = asArray(q.correctAnswer).filter((x): x is string => typeof x === 'string');
    if (ca.length === 0) errors.push('at least one correct option is required');
    if (ca.some((c) => !ids.includes(c))) errors.push('correct answers must reference existing options');
    if (new Set(ca).size !== ca.length) errors.push('correct answers must be unique');
    return errors;
  },
  score(q, answer) {
    const correct = new Set(asArray(q.correctAnswer).filter((x): x is string => typeof x === 'string'));
    const given = new Set(asArray(answer).filter((x): x is string => typeof x === 'string'));
    if (correct.size === 0) return ratioToResult(0, false);
    let hits = 0;
    for (const g of given) if (correct.has(g)) hits++;
    const wrong = given.size - hits;
    // each wrong selection cancels a hit (floor at 0) — standard negative marking
    const ratio = Math.max(0, hits - wrong) / correct.size;
    const detail = { hits, wrong, needed: correct.size };
    return ratioToResult(ratio, partialEnabled(q), detail);
  },
  present(q, rng) {
    const content = stripAnswers(q.content);
    if (q.configuration.shuffleOptions !== false) {
      content.options = shuffled(options(q.content), rng);
    }
    return { content, serverMeta: {} };
  },
};

// ---------------------------------------------------------------- text
const textFamily: QuestionFamily = {
  id: 'text',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    if (acceptedAnswers(q).filter((a) => a.trim().length > 0).length === 0)
      errors.push('at least one accepted answer is required');
    return errors;
  },
  score(q, answer) {
    const given = typeof answer === 'string' ? answer : str(asObj(answer).text);
    if (!given.trim()) return { outcome: 'skipped', ratio: 0 };
    const cfg = textCfg(q);
    const ok = acceptedAnswers(q).some((exp) => textMatches(exp, given, cfg));
    return ratioToResult(ok ? 1 : 0, false);
  },
  present(q) {
    return { content: stripAnswers(q.content), serverMeta: {} };
  },
};

// ---------------------------------------------------------------- numeric
const numericFamily: QuestionFamily = {
  id: 'numeric',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const ca = q.correctAnswer;
    const value = typeof ca === 'number' ? ca : parseNumeric(asObj(ca).value ?? ca);
    if (value === null || value === undefined) errors.push('numeric correct answer is required');
    return errors;
  },
  score(q, answer) {
    const caObj = asObj(q.correctAnswer);
    const expected =
      typeof q.correctAnswer === 'number' ? q.correctAnswer : parseNumeric(caObj.value ?? q.correctAnswer);
    if (expected === null) return ratioToResult(0, false);
    const raw = answer !== null && typeof answer === 'object' ? asObj(answer).value : answer;
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      return { outcome: 'skipped', ratio: 0 };
    }
    const given = parseNumeric(raw);
    if (given === null) return ratioToResult(0, false); // submitted but unparseable → incorrect
    const cfg: NumericMatchConfig = {
      tolerance: typeof caObj.tolerance === 'number' ? caObj.tolerance : (q.configuration.tolerance as number) ?? 0,
      tolerancePercent:
        typeof caObj.tolerancePercent === 'number'
          ? caObj.tolerancePercent
          : (q.configuration.tolerancePercent as number) ?? 0,
    };
    return ratioToResult(numericMatches(expected, given, cfg) ? 1 : 0, false);
  },
  present(q) {
    return { content: stripAnswers(q.content), serverMeta: {} };
  },
};

// ---------------------------------------------------------------- ordering
const ordering: QuestionFamily = {
  id: 'ordering',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const items = asArray(q.content.items).map((i) => str(asObj(i).id));
    if (items.length < 2) errors.push('at least 2 items are required');
    if (!uniqueNonEmpty(items)) errors.push('item ids must be unique and non-empty');
    const ca = asArray(q.correctAnswer).filter((x): x is string => typeof x === 'string');
    if (ca.length !== items.length || [...ca].sort().join('|') !== [...items].sort().join('|'))
      errors.push('correct order must be a permutation of the item ids');
    return errors;
  },
  score(q, answer) {
    const correct = asArray(q.correctAnswer).filter((x): x is string => typeof x === 'string');
    const given = asArray(answer).filter((x): x is string => typeof x === 'string');
    if (correct.length === 0) return ratioToResult(0, false);
    if (given.length === 0) return { outcome: 'skipped', ratio: 0 };
    let inPlace = 0;
    for (let i = 0; i < correct.length; i++) if (given[i] === correct[i]) inPlace++;
    const ratio = inPlace / correct.length;
    return ratioToResult(ratio, partialEnabled(q), { inPlace, total: correct.length });
  },
  present(q, rng) {
    const content = stripAnswers(q.content);
    const items = asArray(q.content.items);
    let mixed = shuffled(items, rng);
    // never present items already in the correct order
    const correct = asArray(q.correctAnswer).map(String).join('|');
    if (items.length > 1) {
      for (let tries = 0; tries < 5 && mixed.map((i) => str(asObj(i).id)).join('|') === correct; tries++) {
        mixed = shuffled(items, rng);
      }
      if (mixed.map((i) => str(asObj(i).id)).join('|') === correct) mixed = [...mixed].reverse();
    }
    content.items = mixed;
    return { content, serverMeta: {} };
  },
};

// ---------------------------------------------------------------- matching
const matching: QuestionFamily = {
  id: 'matching',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const left = asArray(q.content.left).map((i) => str(asObj(i).id));
    const right = asArray(q.content.right).map((i) => str(asObj(i).id));
    if (left.length < 2 || right.length < 2) errors.push('at least 2 pairs are required');
    if (!uniqueNonEmpty(left) || !uniqueNonEmpty(right)) errors.push('pair ids must be unique and non-empty');
    const ca = asObj(q.correctAnswer);
    for (const l of left) {
      const r = str(ca[l]);
      if (!r) errors.push(`missing match for item ${l}`);
      else if (!right.includes(r)) errors.push(`match for ${l} references unknown right item`);
    }
    return errors;
  },
  score(q, answer) {
    const ca = asObj(q.correctAnswer);
    const given = asObj(answer);
    const keys = Object.keys(ca);
    if (keys.length === 0) return ratioToResult(0, false);
    if (Object.keys(given).length === 0) return { outcome: 'skipped', ratio: 0 };
    let hits = 0;
    for (const k of keys) if (str(given[k]) === str(ca[k])) hits++;
    return ratioToResult(hits / keys.length, partialEnabled(q), { hits, total: keys.length });
  },
  present(q, rng) {
    const content = stripAnswers(q.content);
    content.right = shuffled(asArray(q.content.right), rng);
    return { content, serverMeta: {} };
  },
};

// ---------------------------------------------------------------- categorization
const categorization: QuestionFamily = {
  id: 'categorization',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const items = asArray(q.content.items).map((i) => str(asObj(i).id));
    const cats = asArray(q.content.categories).map((c) => str(asObj(c).id));
    if (items.length < 1) errors.push('at least 1 item is required');
    if (cats.length < 2) errors.push('at least 2 categories are required');
    if (!uniqueNonEmpty(items) || !uniqueNonEmpty(cats)) errors.push('ids must be unique and non-empty');
    const ca = asObj(q.correctAnswer);
    for (const it of items) {
      const c = str(ca[it]);
      if (!c) errors.push(`missing category for item ${it}`);
      else if (!cats.includes(c)) errors.push(`category for ${it} is unknown`);
    }
    return errors;
  },
  score(q, answer) {
    const ca = asObj(q.correctAnswer);
    const given = asObj(answer);
    const keys = Object.keys(ca);
    if (keys.length === 0) return ratioToResult(0, false);
    if (Object.keys(given).length === 0) return { outcome: 'skipped', ratio: 0 };
    let hits = 0;
    for (const k of keys) if (str(given[k]) === str(ca[k])) hits++;
    return ratioToResult(hits / keys.length, partialEnabled(q), { hits, total: keys.length });
  },
  present(q, rng) {
    const content = stripAnswers(q.content);
    content.items = shuffled(asArray(q.content.items), rng);
    return { content, serverMeta: {} };
  },
};

// ---------------------------------------------------------------- hotspot / map / coordinate
type Region =
  | { shape: 'rect'; x: number; y: number; w: number; h: number }
  | { shape: 'circle'; x: number; y: number; r: number };

function inRegion(px: number, py: number, region: Region): boolean {
  if (region.shape === 'rect')
    return px >= region.x && px <= region.x + region.w && py >= region.y && py <= region.y + region.h;
  const dx = px - region.x;
  const dy = py - region.y;
  return Math.sqrt(dx * dx + dy * dy) <= region.r;
}

const hotspot: QuestionFamily = {
  id: 'hotspot',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const regions = asArray(asObj(q.correctAnswer).regions);
    if (regions.length === 0) errors.push('at least one correct region is required');
    for (const r of regions) {
      const o = asObj(r);
      if (o.shape === 'rect') {
        if (![o.x, o.y, o.w, o.h].every((n) => typeof n === 'number')) errors.push('invalid rect region');
      } else if (o.shape === 'circle') {
        if (![o.x, o.y, o.r].every((n) => typeof n === 'number')) errors.push('invalid circle region');
      } else errors.push('region shape must be rect or circle');
    }
    return errors;
  },
  score(q, answer) {
    const a = asObj(answer);
    const px = typeof a.x === 'number' ? a.x : NaN;
    const py = typeof a.y === 'number' ? a.y : NaN;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return { outcome: 'skipped', ratio: 0 };
    const regions = asArray(asObj(q.correctAnswer).regions) as Region[];
    const hit = regions.some((r) => inRegion(px, py, r));
    return ratioToResult(hit ? 1 : 0, false);
  },
  present(q) {
    return { content: stripAnswers(q.content), serverMeta: {} };
  },
};

// ---------------------------------------------------------------- grid (crossword, word search, table...)
const grid: QuestionFamily = {
  id: 'grid',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const ca = asObj(q.correctAnswer);
    const entries = asObj(ca.entries);
    const words = asArray(ca.words).filter((w): w is string => typeof w === 'string');
    if (Object.keys(entries).length === 0 && words.length === 0)
      errors.push('correct answer must define entries (keyed) or words (list)');
    return errors;
  },
  score(q, answer) {
    const ca = asObj(q.correctAnswer);
    const cfg = textCfg(q);
    const entries = asObj(ca.entries);
    const entryKeys = Object.keys(entries);
    if (entryKeys.length > 0) {
      const given = asObj(asObj(answer).entries ?? answer);
      if (Object.keys(given).length === 0) return { outcome: 'skipped', ratio: 0 };
      let hits = 0;
      for (const k of entryKeys) {
        if (typeof given[k] === 'string' && textMatches(String(entries[k]), given[k] as string, cfg)) hits++;
      }
      return ratioToResult(hits / entryKeys.length, partialEnabled(q), { hits, total: entryKeys.length });
    }
    const words = asArray(ca.words).filter((w): w is string => typeof w === 'string');
    const found = asArray(asObj(answer).found ?? answer).filter((w): w is string => typeof w === 'string');
    if (found.length === 0) return { outcome: 'skipped', ratio: 0 };
    let hits = 0;
    for (const w of words) if (found.some((f) => textMatches(w, f, cfg))) hits++;
    return ratioToResult(words.length ? hits / words.length : 0, partialEnabled(q), { hits, total: words.length });
  },
  present(q) {
    return { content: stripAnswers(q.content), serverMeta: {} };
  },
};

// ---------------------------------------------------------------- confidence-based
const confidence: QuestionFamily = {
  id: 'confidence',
  validate: (q) => singleChoice.validate(q),
  score(q, answer) {
    const a = asObj(answer);
    const base = singleChoice.score(q, a.optionId ?? answer);
    const rawConf = typeof a.confidence === 'number' ? a.confidence : 1;
    const conf = Math.max(0, Math.min(1, rawConf > 1 ? rawConf / 5 : rawConf)); // accept 0..1 or 1..5
    if (base.outcome !== 'correct') return base;
    const ratio = 0.5 + 0.5 * conf; // confident correct answers earn more
    return { outcome: ratio >= 1 ? 'correct' : 'partial', ratio, detail: { confidence: conf } };
  },
  present: (q, rng) => singleChoice.present(q, rng),
};

// ---------------------------------------------------------------- flashcard (self-assessment)
const flashcard: QuestionFamily = {
  id: 'flashcard',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    const back = asObj(q.correctAnswer);
    if (!str(back.back) && !str(back.value) && typeof q.correctAnswer !== 'string')
      errors.push('flashcard back text is required');
    return errors;
  },
  score(_q, answer) {
    const knew = asObj(answer).knew === true;
    return { outcome: knew ? 'correct' : 'incorrect', ratio: knew ? 1 : 0 };
  },
  present(q) {
    return { content: stripAnswers(q.content), serverMeta: {} };
  },
};

// ---------------------------------------------------------------- unscored (polls, surveys, personality)
const unscored: QuestionFamily = {
  id: 'unscored',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    return errors;
  },
  score(_q, answer) {
    const answered =
      answer !== null &&
      answer !== undefined &&
      !(typeof answer === 'string' && !answer.trim()) &&
      !(Array.isArray(answer) && answer.length === 0);
    return { outcome: answered ? 'correct' : 'skipped', ratio: answered ? 1 : 0 };
  },
  present(q, rng) {
    const content = stripAnswers(q.content);
    if (asArray(q.content.options).length && q.configuration.shuffleOptions === true) {
      content.options = shuffled(options(q.content), rng);
    }
    return { content, serverMeta: {} };
  },
};

// ---------------------------------------------------------------- submission (essays, voice, drawing, code)
const submission: QuestionFamily = {
  id: 'submission',
  validate(q) {
    const errors: string[] = [];
    if (!hasPrompt(q.content)) errors.push('prompt is required');
    return errors;
  },
  score(q, answer) {
    const given =
      typeof answer === 'string' ? answer : str(asObj(answer).text) || str(asObj(answer).mediaRef);
    if (!given.trim()) return { outcome: 'skipped', ratio: 0 };
    // auto-score only when the author provided accepted answers / keywords
    const accepted = acceptedAnswers(q);
    const keywords = asArray(asObj(q.correctAnswer).keywords).filter((k): k is string => typeof k === 'string');
    const cfg = textCfg(q);
    if (accepted.length > 0) {
      return ratioToResult(accepted.some((e) => textMatches(e, given, cfg)) ? 1 : 0, false);
    }
    if (keywords.length > 0) {
      let hits = 0;
      for (const k of keywords) if (textMatches(k, given, { ...cfg, matchMode: 'contains' })) hits++;
      return ratioToResult(hits / keywords.length, partialEnabled(q), { hits, total: keywords.length });
    }
    // no auto-scoring rule → stored for human review, participation credit
    return { outcome: 'correct', ratio: 1, detail: { manualReview: true } };
  },
  present(q) {
    return { content: stripAnswers(q.content), serverMeta: {} };
  },
};

// ---------------------------------------------------------------- composite (multi-part, passages, branching)
export type ScoreDelegate = (type: string, q: EngineQuestion, answer: unknown) => ScoreResult;
export type ValidateDelegate = (type: string, q: EngineQuestion) => string[];
export type PresentDelegate = (type: string, q: EngineQuestion, rng: () => number) => PresentedQuestion;

export function makeCompositeFamily(
  scoreDelegate: ScoreDelegate,
  validateDelegate: ValidateDelegate,
  presentDelegate: PresentDelegate,
): QuestionFamily {
  return {
    id: 'composite',
    validate(q) {
      const errors: string[] = [];
      const parts = asArray(q.content.parts).map(asObj);
      if (parts.length === 0) errors.push('at least one part is required');
      const ca = asObj(q.correctAnswer);
      const ids = new Set<string>();
      for (const part of parts) {
        const id = str(part.id);
        const type = str(part.type);
        if (!id) {
          errors.push('every part needs an id');
          continue;
        }
        if (ids.has(id)) errors.push(`duplicate part id ${id}`);
        ids.add(id);
        if (type === 'composite' || asArray(asObj(part.content).parts).length > 0) {
          errors.push(`part ${id}: nested composite parts are not allowed`);
          continue;
        }
        const sub: EngineQuestion = {
          type,
          content: asObj(part.content),
          correctAnswer: ca[id],
          configuration: asObj(part.configuration),
        };
        try {
          for (const e of validateDelegate(type, sub)) errors.push(`part ${id}: ${e}`);
        } catch {
          errors.push(`part ${id}: unknown question type "${type}"`);
        }
      }
      return errors;
    },
    score(q, answer) {
      const parts = asArray(q.content.parts).map(asObj);
      const ca = asObj(q.correctAnswer);
      const given = asObj(answer);
      if (parts.length === 0) return ratioToResult(0, false);
      let total = 0;
      const details: Record<string, ScoreResult> = {};
      let answeredAny = false;
      for (const part of parts) {
        const id = str(part.id);
        const weight = typeof part.weight === 'number' && part.weight > 0 ? part.weight : 1;
        const sub: EngineQuestion = {
          type: str(part.type),
          content: asObj(part.content),
          correctAnswer: ca[id],
          configuration: asObj(part.configuration),
        };
        let res: ScoreResult;
        try {
          res = scoreDelegate(str(part.type), sub, given[id]);
        } catch {
          res = { outcome: 'incorrect', ratio: 0 };
        }
        if (res.outcome !== 'skipped') answeredAny = true;
        details[id] = res;
        total += res.ratio * weight;
      }
      const weightSum = parts.reduce(
        (s, p) => s + (typeof p.weight === 'number' && p.weight > 0 ? p.weight : 1),
        0,
      );
      if (!answeredAny) return { outcome: 'skipped', ratio: 0, detail: details };
      return ratioToResult(total / weightSum, true, details);
    },
    present(q, rng) {
      const content = stripAnswers(q.content);
      content.parts = asArray(q.content.parts).map((p) => {
        const part = asObj(p);
        let inner: Record<string, unknown>;
        try {
          inner = presentDelegate(
            str(part.type),
            {
              type: str(part.type),
              content: asObj(part.content),
              correctAnswer: null,
              configuration: asObj(part.configuration),
            },
            rng,
          ).content;
        } catch {
          inner = stripAnswers(asObj(part.content));
        }
        return { id: part.id, type: part.type, content: inner, configuration: part.configuration ?? {} };
      });
      return { content, serverMeta: {} };
    },
  };
}

export const baseFamilies: QuestionFamily[] = [
  singleChoice,
  multiChoice,
  textFamily,
  numericFamily,
  ordering,
  matching,
  categorization,
  hotspot,
  grid,
  confidence,
  flashcard,
  unscored,
  submission,
];
