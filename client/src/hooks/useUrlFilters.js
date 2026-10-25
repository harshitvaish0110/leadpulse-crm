import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filter state kept in the URL, so views can be bookmarked, shared and
 * survive a reload. Empty values are removed from the URL; any change other
 * than `page` itself sends the list back to page 1.
 *
 * @param {Record<string, string>} defaults
 * @returns {[Record<string, string>, (patch: Record<string, string|undefined>) => void]}
 */
export function useUrlFilters(defaults) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = params.get(key);
      if (value !== null) out[key] = value;
    }
    return out;
    // `defaults` is a constant object at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null || value === '' || value === defaults[key]) next.delete(key);
        else next.set(key, String(value));
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams]);

  return [filters, update];
}
