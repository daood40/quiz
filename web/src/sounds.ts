/** Gentle audio cues via WebAudio (no assets). Soft, short, low-volume —
 *  designed not to startle. User-toggleable; off when reduced-motion is set. */

let ctx: AudioContext | null = null;

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem('sounds') !== 'off';
  } catch {
    return true;
  }
}
export function setSoundsEnabled(on: boolean): void {
  try {
    localStorage.setItem('sounds', on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

function tone(freq: number, startAt: number, duration: number, volume: number): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + duration + 0.05);
}

function play(fn: () => void): void {
  if (!soundsEnabled()) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    fn();
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  correct: () => play(() => {
    tone(523.25, 0, 0.12, 0.05); // C5
    tone(659.25, 0.09, 0.16, 0.05); // E5
  }),
  wrong: () => play(() => tone(196, 0, 0.22, 0.045)), // soft low G3
  finish: () => play(() => {
    tone(523.25, 0, 0.1, 0.05);
    tone(659.25, 0.1, 0.1, 0.05);
    tone(783.99, 0.2, 0.22, 0.05);
  }),
};

/** Haptic cue (Android/Chrome); follows the sounds toggle and reduced-motion. */
export function haptic(kind: 'correct' | 'wrong' | 'tap'): void {
  if (!soundsEnabled()) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const pattern = kind === 'correct' ? [18] : kind === 'wrong' ? [40, 40, 40] : [8];
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
