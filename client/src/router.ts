// 很小的路由：/  /me  /g/:id  /join/:code
import { useSyncExternalStore } from 'react';

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
window.addEventListener('popstate', emit);

export function navigate(to: string, replace = false) {
  if (location.pathname + location.search === to) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.scrollTo(0, 0);
  emit();
}

export type Route =
  | { name: 'home' }
  | { name: 'me' }
  | { name: 'privacy' }
  | { name: 'group'; id: string }
  | { name: 'join'; code: string };

const parse = (p: string): Route => {
  let m: RegExpExecArray | null;
  if (p === '/me') return { name: 'me' };
  if (p === '/privacy') return { name: 'privacy' };
  if ((m = /^\/g\/([\w-]+)\/?$/.exec(p))) return { name: 'group', id: m[1] };
  if ((m = /^\/join\/([\w-]+)\/?$/.exec(p))) return { name: 'join', code: m[1] };
  return { name: 'home' };
};

let cache: { path: string; route: Route } = { path: location.pathname, route: parse(location.pathname) };
const get = () => {
  if (cache.path !== location.pathname) cache = { path: location.pathname, route: parse(location.pathname) };
  return cache.route;
};
export const useRoute = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), get);
