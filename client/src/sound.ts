// Tiny synthesized sound kit — no audio files to ship.
import { getSettings } from './settings';

let ctx: AudioContext | null = null;
const ac = () => {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

function noise(dur: number, freq: number, gain: number, delay = 0) {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + delay);
}

function tone(freq: number, dur: number, gain: number, delay = 0, type: OscillatorType = 'sine') {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const on = () => getSettings().sound;

export const sfx = {
  /** unlock audio on first user gesture (iOS) */
  unlock: () => { if (on()) ac(); },
  select: () => on() && noise(0.04, 3200, 0.12),
  play: (n = 1) => { if (!on()) return; for (let i = 0; i < Math.min(n, 5); i++) noise(0.09, 1800, 0.35, i * 0.035); },
  pass: () => on() && tone(220, 0.12, 0.08, 0, 'triangle'),
  deal: () => { if (!on()) return; for (let i = 0; i < 8; i++) noise(0.05, 2400, 0.12, i * 0.06); },
  turn: () => on() && tone(880, 0.15, 0.06),
  error: () => on() && tone(160, 0.18, 0.1, 0, 'square'),
  win: () => { if (!on()) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, 0.1, i * 0.09)); },
  lose: () => { if (!on()) return; [392, 330].forEach((f, i) => tone(f, 0.35, 0.07, i * 0.12, 'triangle')); },
  tick: () => on() && tone(1400, 0.03, 0.04),
  /** soft landing on the table */
  thunk: () => { if (!on()) return; noise(0.07, 380, 0.5); tone(110, 0.08, 0.06); },
  flip: () => on() && noise(0.05, 4200, 0.14),
  /** ceramic chip clink: two short detuned partials */
  chip: (delay = 0) => { if (!on()) return; tone(2350 + Math.random() * 300, 0.06, 0.05, delay); tone(3900 + Math.random() * 400, 0.04, 0.03, delay + 0.005); },
  pickup: () => on() && noise(0.03, 2600, 0.1),
  /** one card snapped off the deck — short and quiet, it plays ~50 times in 3 s */
  dealCard: () => on() && noise(0.035, 2900 + Math.random() * 600, 0.07),
};
