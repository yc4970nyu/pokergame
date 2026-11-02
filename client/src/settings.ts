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
  if (s === 'off') return { card: { duration: 0 }, lift: { duration: 0 }, land: { duration: 0 } };
  const k = s === 'fast' ? 1.8 : 1;
  return {
    card: { type: 'spring' as const, stiffness: 260 * k, damping: 22, mass: 0.9 },
    lift: { type: 'spring' as const, stiffness: 520 * k, damping: 28 },
    land: { type: 'spring' as const, stiffness: 340 * k, damping: 16, mass: 0.8 },
  };
};
