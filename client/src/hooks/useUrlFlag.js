import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * An on/off state kept in the URL as `?name=1`, so a link can open a dialog
 * (the command palette's "New contact" goes to `/contacts?new=1`).
 * @param {string} name
 * @returns {[boolean, (on: boolean) => void]}
 */
export function useUrlFlag(name) {
  const [params, setParams] = useSearchParams();
  const set = useCallback((on) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (on) next.set(name, '1');
      else next.delete(name);
      return next;
    }, { replace: true });
  }, [name, setParams]);
  return [params.get(name) === '1', set];
}
