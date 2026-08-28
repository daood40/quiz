/** Text & number normalization used by answer matching. */

const ARABIC_DIACRITICS = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;

export interface TextMatchConfig {
  caseSensitive?: boolean;
  normalizeArabic?: boolean;
  /** Allowed Levenshtein distance (typo tolerance). */
  typoTolerance?: number;
  /** 'exact' (default) | 'contains' — contains: answer must include the expected token */
  matchMode?: 'exact' | 'contains';
}

export function normalizeText(input: string, cfg: TextMatchConfig = {}): string {
  let s = String(input).trim().replace(/\s+/g, ' ');
  if (!cfg.caseSensitive) s = s.toLowerCase();
  if (cfg.normalizeArabic !== false) {
    s = s
      .replace(ARABIC_DIACRITICS, '')
      .replace(TATWEEL, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه');
  }
  // strip common punctuation that shouldn't affect matching
  s = s.replace(/[.,;:!?؟،؛"'()[\]{}«»]/g, '');
  return s.trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function textMatches(expected: string, given: string, cfg: TextMatchConfig = {}): boolean {
  const e = normalizeText(expected, cfg);
  const g = normalizeText(given, cfg);
  if (cfg.matchMode === 'contains') return g.includes(e);
  if (e === g) return true;
  const tol = cfg.typoTolerance ?? 0;
  if (tol > 0 && levenshtein(e, g) <= tol) return true;
  return false;
}

export interface NumericMatchConfig {
  /** Absolute tolerance. */
  tolerance?: number;
  /** Relative tolerance, e.g. 0.05 = ±5%. */
  tolerancePercent?: number;
}

/** Parses "3/4", "75%", "1,5", "42" into a number; returns null if unparseable. */
export function parseNumeric(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/\s/g, '').replace(',', '.');
  // Arabic-Indic digits
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1);
  }
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  let n: number;
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    n = Number(frac[1]) / den;
  } else {
    n = Number(s);
  }
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

export function numericMatches(expected: number, given: number, cfg: NumericMatchConfig = {}): boolean {
  const abs = cfg.tolerance ?? 0;
  const rel = cfg.tolerancePercent ?? 0;
  const allowed = Math.max(abs, Math.abs(expected) * rel);
  return Math.abs(expected - given) <= allowed + 1e-9;
}
