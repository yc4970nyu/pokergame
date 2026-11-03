import { useSyncExternalStore } from 'react';

export type Speed = 'normal' | 'fast' | 'off';
interface Settings { speed: Speed; sound: boolean }

const load = (): Settings => {
  try {
    const s = JSON.parse(localStorage.getItem('dld.settings') ?? '{}');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return { speed: s.speed ?? (reduced ? 'off' : 'normal'), sound: s.sound ?? true };
  } catch {
    return { speed: 'normal', sound: true };
  }
};

let settings = load();
const subs = new Set<() => void>();
export const getSettings = () => settings;
export const setSettings = (patch: Partial<Settings>) => {
  settings = { ...settings, ...patch };
  try { localStorage.setItem('dld.settings', JSON.stringify(settings)); } catch { /* ignore */ }
  subs.forEach((f) => f());
};
export const useSettings = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSettings);

/** Multiplier applied to every animation duration / stagger */
export const speedFactor = (s: Speed) => (s === 'normal' ? 1 : s === 'fast' ? 0.5 : 0);

/** Spring presets scaled by the speed setting */
export const springs = (s: Speed) => {
  if (s === 'off') {
    const z = { duration: 0 };
    return { card: z, lift: z, land: z, deal: z, push: z, snap: z, flip: z, off: true };
  }
  const k = s === 'fast' ? 1.8 : 1;
  return {
    card: { type: 'spring' as const, stiffness: 260 * k, damping: 22, mass: 0.9 },
    lift: { type: 'spring' as const, stiffness: 520 * k, damping: 28 },
    land: { type: 'spring' as const, stiffness: 340 * k, damping: 16, mass: 0.8 },
    /** low damping on purpose: cards settle with a ~3° rotational overshoot */
    deal: { type: 'spring' as const, stiffness: 210 * k, damping: 15, mass: 0.9 },
    /** neighbours sliding out of the way of a dragged card — a bit of inertia */
    push: { type: 'spring' as const, stiffness: 300 * k, damping: 24, mass: 1.1 },
    /** dropped card snapping into its slot — magnetic, heavily damped */
    snap: { type: 'spring' as const, stiffness: 700 * k, damping: 38 },
    flip: { type: 'spring' as const, stiffness: 320 * k, damping: 26 },
    off: false,
  };
};

/** The spring presets for the current animation speed. */
export type Springs = ReturnType<typeof springs>;
