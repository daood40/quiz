/**
 * Per-family answer input UIs. The family for a type comes from the server's
 * question-type registry (useTypeSpecs), so new server types render without
 * client changes as long as they map to a known family.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useI18n } from './i18n';
import type { TypeSpec } from './components';

export interface PlayableQuestion {
  id: string;
  type: string;
  difficulty: string;
  points: number;
  timeLimitSec: number;
  content: Record<string, unknown>;
  configuration: { media?: string; scored?: boolean };
}

interface Props {
  question: PlayableQuestion;
  spec: TypeSpec | undefined;
  onSubmit: (answer: unknown) => void;
  disabled: boolean;
}

const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function MediaBlock({ content }: { content: Record<string, unknown> }) {
  const media = content.media as { kind?: string; url?: string } | undefined;
  if (!media?.url) return null;
  if (media.kind === 'audio') return <audio controls src={media.url} style={{ width: '100%' }} />;
  if (media.kind === 'video') return <video controls src={media.url} style={{ width: '100%', borderRadius: 12 }} />;
  return <img src={media.url} alt="" style={{ maxWidth: '100%', borderRadius: 12 }} />;
}

function Passage({ content }: { content: Record<string, unknown> }) {
  const { pick } = useI18n();
  const passage = pick(content.passage);
  if (!passage) return null;
  return <div className="quiz-passage">{passage}</div>;
}

function SubmitBar({ onSubmit, canSubmit, disabled, children }: { onSubmit: () => void; canSubmit: boolean; disabled: boolean; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <button className="btn" onClick={onSubmit} disabled={!canSubmit || disabled}>{t('submit')}</button>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- families
const KEYS_EN = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const KEYS_AR = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];

function SingleChoice({ question, onSubmit, disabled, withConfidence }: Props & { withConfidence?: boolean }) {
  const { t, pick, lang } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(3);
  const options = arr(question.content.options);
  const keys = lang === 'ar' ? KEYS_AR : KEYS_EN;
  return (
    <div className="stack">
      {options.map((o, i) => (
        <button
          key={str(o.id)}
          className={`option ${selected === o.id ? 'selected' : ''}`}
          onClick={() => !disabled && setSelected(str(o.id))}
          disabled={disabled}
        >
          <span className="opt-key">{keys[i] ?? i + 1}</span>
          {o.media ? <img src={str((o.media as Record<string, unknown>).url)} alt="" style={{ maxHeight: 80, borderRadius: 8 }} /> : null}
          {pick(o.text)}
        </button>
      ))}
      {withConfidence && (
        <div className="row">
          <span className="muted">{t('confidence')}</span>
          <input type="range" min={1} max={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} style={{ maxWidth: 200 }} />
          <span className="badge primary">{confidence}/5</span>
        </div>
      )}
      <SubmitBar
        onSubmit={() => onSubmit(withConfidence ? { optionId: selected, confidence } : selected)}
        canSubmit={selected !== null}
        disabled={disabled}
      />
    </div>
  );
}

function MultiChoice({ question, onSubmit, disabled }: Props) {
  const { pick, lang } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const options = arr(question.content.options);
  const keys = lang === 'ar' ? KEYS_AR : KEYS_EN;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="stack">
      {options.map((o, i) => (
        <button key={str(o.id)} className={`option ${selected.has(str(o.id)) ? 'selected' : ''}`} onClick={() => !disabled && toggle(str(o.id))} disabled={disabled}>
          <span className="opt-key">{selected.has(str(o.id)) ? '✓' : keys[i] ?? i + 1}</span>
          {pick(o.text)}
        </button>
      ))}
      <SubmitBar onSubmit={() => onSubmit([...selected])} canSubmit={selected.size > 0} disabled={disabled} />
    </div>
  );
}

function TextAnswer({ onSubmit, disabled, numeric }: Props & { numeric?: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  return (
    <div className="stack">
      <input
        type={numeric ? 'text' : 'text'}
        inputMode={numeric ? 'decimal' : 'text'}
        placeholder={t('typeAnswer')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value.trim() && !disabled && onSubmit(value.trim())}
        disabled={disabled}
        autoFocus
      />
      <SubmitBar onSubmit={() => onSubmit(value.trim())} canSubmit={value.trim().length > 0} disabled={disabled} />
    </div>
  );
}

function SliderAnswer({ question, onSubmit, disabled }: Props) {
  const min = typeof question.content.min === 'number' ? question.content.min : 0;
  const max = typeof question.content.max === 'number' ? question.content.max : 100;
  const [value, setValue] = useState(Math.round((min + max) / 2));
  return (
    <div className="stack">
      <div className="row">
        <input type="range" min={min} max={max} value={value} onChange={(e) => setValue(Number(e.target.value))} disabled={disabled} style={{ flex: 1 }} />
        <span className="badge primary" style={{ fontSize: 16 }}>{value}</span>
      </div>
      <SubmitBar onSubmit={() => onSubmit(value)} canSubmit disabled={disabled} />
    </div>
  );
}

function Ordering({ question, onSubmit, disabled }: Props) {
  const { t, pick } = useI18n();
  const items = arr(question.content.items);
  const [order, setOrder] = useState<string[]>([]);
  const remaining = items.filter((i) => !order.includes(str(i.id)));
  const byId = useMemo(() => new Map(items.map((i) => [str(i.id), i])), [items]);
  return (
    <div className="stack">
      <p className="muted">{t('dragToOrder')}</p>
      {order.length > 0 && (
        <ol className="stack" style={{ margin: 0, paddingInlineStart: 24 }}>
          {order.map((id) => (
            <li key={id}>
              <span className="chip selected" onClick={() => !disabled && setOrder((o) => o.filter((x) => x !== id))}>
                {pick(byId.get(id)?.text)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="row">
        {remaining.map((i) => (
          <button key={str(i.id)} className="chip" onClick={() => !disabled && setOrder((o) => [...o, str(i.id)])} disabled={disabled}>
            {pick(i.text)}
          </button>
        ))}
      </div>
      <SubmitBar onSubmit={() => onSubmit(order)} canSubmit={order.length === items.length} disabled={disabled}>
        <button className="btn secondary sm" onClick={() => setOrder([])} disabled={disabled}>{t('reset')}</button>
      </SubmitBar>
    </div>
  );
}

function Matching({ question, onSubmit, disabled }: Props) {
  const { t, pick } = useI18n();
  const left = arr(question.content.left);
  const right = arr(question.content.right);
  const [map, setMap] = useState<Record<string, string>>({});
  return (
    <div className="stack">
      <p className="muted">{t('matchLeft')}</p>
      {left.map((l) => (
        <div className="row" key={str(l.id)}>
          <span style={{ minWidth: 120, fontWeight: 700 }}>{pick(l.text)}</span>
          <select value={map[str(l.id)] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [str(l.id)]: e.target.value }))} disabled={disabled} style={{ maxWidth: 240 }}>
            <option value="">—</option>
            {right.map((r) => (
              <option key={str(r.id)} value={str(r.id)}>{pick(r.text)}</option>
            ))}
          </select>
        </div>
      ))}
      <SubmitBar onSubmit={() => onSubmit(map)} canSubmit={left.every((l) => map[str(l.id)])} disabled={disabled} />
    </div>
  );
}

function Categorization({ question, onSubmit, disabled }: Props) {
  const { pick } = useI18n();
  const items = arr(question.content.items);
  const cats = arr(question.content.categories);
  const [map, setMap] = useState<Record<string, string>>({});
  return (
    <div className="stack">
      {items.map((i) => (
        <div className="row" key={str(i.id)}>
          <span style={{ minWidth: 120, fontWeight: 700 }}>{pick(i.text)}</span>
          <select value={map[str(i.id)] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [str(i.id)]: e.target.value }))} disabled={disabled} style={{ maxWidth: 240 }}>
            <option value="">—</option>
            {cats.map((c) => (
              <option key={str(c.id)} value={str(c.id)}>{pick(c.text)}</option>
            ))}
          </select>
        </div>
      ))}
      <SubmitBar onSubmit={() => onSubmit(map)} canSubmit={items.every((i) => map[str(i.id)])} disabled={disabled} />
    </div>
  );
}

function Hotspot({ question, onSubmit, disabled }: Props) {
  const { t } = useI18n();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const media = question.content.media as { url?: string } | undefined;
  return (
    <div className="stack">
      <p className="muted">{t('clickImage')}</p>
      <div
        className="hotspot-box"
        style={media?.url ? { backgroundImage: `url(${media.url})`, backgroundSize: 'cover' } : undefined}
        onClick={(e) => {
          if (disabled) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setPoint({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
        }}
        role="button"
        aria-label="hotspot target"
      >
        {point && <span className="hotspot-dot" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />}
      </div>
      <SubmitBar onSubmit={() => point && onSubmit(point)} canSubmit={point !== null} disabled={disabled} />
    </div>
  );
}

interface XwSlot {
  id: string;
  clue: unknown;
  row: number;
  col: number;
  length: number;
  direction: 'across' | 'down';
  number: number;
}

/**
 * Interactive crossword: a real letter grid built from positioned slots
 * (row/col/direction in content), with keyboard navigation, numbered cells,
 * and an across/down clue list. Arabic boards set content.rtl and the CSS
 * grid direction flips column order natively.
 */
function CrosswordBoard({ question, onSubmit, disabled, slots }: Props & { slots: XwSlot[] }) {
  const { t, pick } = useI18n();
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [active, setActive] = useState(slots[0]?.id ?? '');
  const rtl = question.content.rtl === true;

  const { cells, rows, cols } = useMemo(() => {
    const map = new Map<string, { r: number; c: number; slots: string[]; number?: number }>();
    let rMax = 0;
    let cMax = 0;
    for (const s of slots) {
      for (let i = 0; i < s.length; i++) {
        const r = s.direction === 'down' ? s.row + i : s.row;
        const c = s.direction === 'across' ? s.col + i : s.col;
        const key = `${r},${c}`;
        const cell = map.get(key) ?? { r, c, slots: [] };
        cell.slots.push(s.id);
        if (i === 0) cell.number = cell.number ?? s.number;
        map.set(key, cell);
        rMax = Math.max(rMax, r);
        cMax = Math.max(cMax, c);
      }
    }
    return { cells: map, rows: rMax + 1, cols: cMax + 1 };
  }, [slots]);

  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  const cellKeys = (s: XwSlot) =>
    Array.from({ length: s.length }, (_, i) =>
      s.direction === 'down' ? `${s.row + i},${s.col}` : `${s.row},${s.col + i}`);

  const focusCell = (key: string) => {
    const el = document.querySelector<HTMLInputElement>(`input[data-xw="${question.id}-${key}"]`);
    el?.focus();
    el?.select();
  };

  const step = (key: string, dir: 1 | -1) => {
    const s = slotById.get(active);
    if (!s) return;
    const ks = cellKeys(s);
    const next = ks[ks.indexOf(key) + dir];
    if (next) focusCell(next);
  };

  const onCellChange = (key: string, value: string) => {
    const ch = value.slice(-1);
    setLetters((m) => ({ ...m, [key]: ch }));
    if (ch) step(key, 1);
  };

  const onCellKey = (key: string, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !(e.target as HTMLInputElement).value) {
      e.preventDefault();
      step(key, -1);
      const s = slotById.get(active);
      if (s) {
        const ks = cellKeys(s);
        const prev = ks[ks.indexOf(key) - 1];
        if (prev) setLetters((m) => ({ ...m, [prev]: '' }));
      }
    }
  };

  const onCellFocus = (key: string) => {
    const cell = cells.get(key);
    if (cell && !cell.slots.includes(active)) setActive(cell.slots[0]);
  };

  const toggleDirection = (key: string) => {
    const cell = cells.get(key);
    if (cell && cell.slots.length > 1) {
      const idx = cell.slots.indexOf(active);
      setActive(cell.slots[(idx + 1) % cell.slots.length]);
    }
  };

  const entries = () => {
    const out: Record<string, string> = {};
    for (const s of slots) {
      const word = cellKeys(s).map((k) => letters[k] ?? '').join('');
      if (word.trim()) out[s.id] = word;
    }
    return out;
  };

  const activeCells = new Set(slotById.get(active) ? cellKeys(slotById.get(active)!) : []);
  const groups: Array<['across' | 'down', XwSlot[]]> = [
    ['across', slots.filter((s) => s.direction === 'across')],
    ['down', slots.filter((s) => s.direction === 'down')],
  ];

  return (
    <div className="stack">
      <div
        className="xw-grid"
        role="group"
        aria-label={pick(question.content.prompt)}
        dir={rtl ? 'rtl' : 'ltr'}
        style={{ gridTemplateColumns: `repeat(${cols}, var(--xw-cell))`, gridTemplateRows: `repeat(${rows}, var(--xw-cell))` }}
      >
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols);
          const c = i % cols;
          const key = `${r},${c}`;
          const cell = cells.get(key);
          if (!cell) return <div key={key} className="xw-block" aria-hidden="true" />;
          return (
            <div key={key} className={`xw-cell ${activeCells.has(key) ? 'active' : ''}`}>
              {cell.number != null && <span className="xw-num" aria-hidden="true">{cell.number}</span>}
              <input
                data-xw={`${question.id}-${key}`}
                value={letters[key] ?? ''}
                maxLength={2}
                autoComplete="off"
                aria-label={`${t(slotById.get(cell.slots[0])!.direction)} ${slotById.get(cell.slots[0])!.number}`}
                disabled={disabled}
                onChange={(e) => onCellChange(key, e.target.value)}
                onKeyDown={(e) => onCellKey(key, e)}
                onFocus={() => onCellFocus(key)}
                onClick={() => toggleDirection(key)}
              />
            </div>
          );
        })}
      </div>
      {groups.map(([dir, list]) =>
        list.length === 0 ? null : (
          <div key={dir} className="xw-clues">
            <span className="muted" style={{ fontWeight: 700 }}>{t(dir)}</span>
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`xw-clue ${active === s.id ? 'active' : ''}`}
                onClick={() => { setActive(s.id); focusCell(cellKeys(s)[0]); }}
                disabled={disabled}
              >
                <b>{s.number}.</b> {pick(s.clue)}
              </button>
            ))}
          </div>
        ),
      )}
      <SubmitBar onSubmit={() => onSubmit({ entries: entries() })} canSubmit={Object.keys(entries()).length > 0} disabled={disabled} />
    </div>
  );
}

function GridPuzzle({ question, onSubmit, disabled }: Props) {
  const { pick } = useI18n();
  const slots = arr(question.content.slots).concat(arr(question.content.cells));
  const positioned = slots.length > 0 && slots.every(
    (s) => typeof s.row === 'number' && typeof s.col === 'number' &&
           typeof s.length === 'number' && (s.direction === 'across' || s.direction === 'down'),
  );
  if (positioned) {
    const xw = slots
      .map((s, i) => ({
        id: str(s.id), clue: s.clue, row: s.row as number, col: s.col as number,
        length: s.length as number, direction: s.direction as 'across' | 'down',
        number: typeof s.number === 'number' ? (s.number as number) : i + 1,
      }))
      .sort((a, b) => a.number - b.number);
    return <CrosswordBoard question={question} spec={undefined} onSubmit={onSubmit} disabled={disabled} slots={xw} />;
  }
  const gridRows = Array.isArray(question.content.grid) ? (question.content.grid as string[]) : [];
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [words, setWords] = useState('');
  const keyed = slots.length > 0;
  return (
    <div className="stack">
      {gridRows.length > 0 && (
        <pre style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 6, background: 'var(--surface-2)', padding: 12, borderRadius: 10, overflowX: 'auto' }}>
          {gridRows.join('\n')}
        </pre>
      )}
      {keyed ? (
        slots.map((s) => (
          <div className="row" key={str(s.id)}>
            <span style={{ minWidth: 160 }} className="muted">{pick(s.clue ?? s.label)}</span>
            <input value={entries[str(s.id)] ?? ''} onChange={(e) => setEntries((m) => ({ ...m, [str(s.id)]: e.target.value }))} disabled={disabled} style={{ maxWidth: 220 }} />
          </div>
        ))
      ) : (
        <input placeholder="word1, word2, …" value={words} onChange={(e) => setWords(e.target.value)} disabled={disabled} />
      )}
      <SubmitBar
        onSubmit={() => onSubmit(keyed ? { entries } : { found: words.split(/[,،]/).map((w) => w.trim()).filter(Boolean) })}
        canSubmit={keyed ? Object.values(entries).some((v) => v.trim()) : words.trim().length > 0}
        disabled={disabled}
      />
    </div>
  );
}

function Flashcard({ question, onSubmit, disabled }: Props) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="stack center">
      {!revealed ? (
        <button className="btn lg" onClick={() => setRevealed(true)} disabled={disabled}>{t('reveal')}</button>
      ) : (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn" style={{ background: 'var(--success)' }} onClick={() => onSubmit({ knew: true })} disabled={disabled}>{t('knew')}</button>
          <button className="btn danger" onClick={() => onSubmit({ knew: false })} disabled={disabled}>{t('didntKnow')}</button>
        </div>
      )}
    </div>
  );
}

function Submission({ onSubmit, disabled }: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  return (
    <div className="stack">
      <textarea rows={5} placeholder={t('typeAnswer')} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled} />
      <SubmitBar onSubmit={() => onSubmit(value.trim())} canSubmit={value.trim().length > 0} disabled={disabled} />
    </div>
  );
}

function Composite({ question, spec, onSubmit, disabled, specs }: Props & { specs: Map<string, TypeSpec> }) {
  const { t, pick } = useI18n();
  const parts = arr(question.content.parts);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  return (
    <div className="stack">
      <Passage content={question.content} />
      {parts.map((p, idx) => {
        const pid = str(p.id);
        const sub: PlayableQuestion = {
          id: `${question.id}:${pid}`,
          type: str(p.type),
          difficulty: question.difficulty,
          points: 0,
          timeLimitSec: 0,
          content: (p.content ?? {}) as Record<string, unknown>,
          configuration: {},
        };
        return (
          <div className="card" key={pid} style={{ padding: 14 }}>
            <p style={{ fontWeight: 700, margin: '0 0 8px' }}>
              {idx + 1}. {pick((sub.content as Record<string, unknown>).prompt)}
            </p>
            {done.has(pid) ? (
              <span className="badge success">✓</span>
            ) : (
              <FamilyRenderer
                question={sub}
                spec={specs.get(sub.type)}
                specs={specs}
                disabled={disabled}
                onSubmit={(a) => {
                  setAnswers((m) => ({ ...m, [pid]: a }));
                  setDone((s) => new Set(s).add(pid));
                }}
              />
            )}
          </div>
        );
      })}
      <button className="btn" onClick={() => onSubmit(answers)} disabled={disabled || done.size === 0}>
        {t('submit')} ({done.size}/{parts.length})
      </button>
    </div>
  );
}

function FamilyRenderer(props: Props & { specs: Map<string, TypeSpec> }) {
  const family = props.spec?.family ?? 'single_choice';
  switch (family) {
    case 'single_choice':
      return <SingleChoice {...props} />;
    case 'confidence':
      return <SingleChoice {...props} withConfidence />;
    case 'multi_choice':
      return <MultiChoice {...props} />;
    case 'text':
      return <TextAnswer {...props} />;
    case 'numeric':
      return props.question.type === 'slider_answer' || props.question.type === 'scale_answer' ? (
        <SliderAnswer {...props} />
      ) : (
        <TextAnswer {...props} numeric />
      );
    case 'ordering':
      return <Ordering {...props} />;
    case 'matching':
      return <Matching {...props} />;
    case 'categorization':
      return <Categorization {...props} />;
    case 'hotspot':
      return <Hotspot {...props} />;
    case 'grid':
      return <GridPuzzle {...props} />;
    case 'flashcard':
      return <Flashcard {...props} />;
    case 'submission':
      return <Submission {...props} />;
    case 'composite':
      return <Composite {...props} specs={props.specs} />;
    case 'unscored':
      return arr(props.question.content.options).length > 0 ? <SingleChoice {...props} /> : <Submission {...props} />;
    default:
      return <SingleChoice {...props} />;
  }
}

export function QuestionRenderer({ question, specs, onSubmit, disabled }: { question: PlayableQuestion; specs: Map<string, TypeSpec>; onSubmit: (a: unknown) => void; disabled: boolean }) {
  const { pick } = useI18n();
  return (
    <div>
      <Passage content={question.content} />
      <MediaBlock content={question.content} />
      <p className="quiz-question">{pick(question.content.prompt)}</p>
      <FamilyRenderer question={question} spec={specs.get(question.type)} specs={specs} onSubmit={onSubmit} disabled={disabled} />
    </div>
  );
}
