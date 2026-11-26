import { useQuery } from '@tanstack/react-query';
import MiniSearch from 'minisearch';
import { useMemo } from 'react';
import { get } from './http.common';
import type { CatalogueItem, Kit } from '../data/types';

/**
 * Product catalogue cached in the browser for instant search at the counter (NFR-01).
 * Refreshed every 60 s and after each saved bill, so stock figures stay close to live.
 */
export function useCatalogue() {
  const q = useQuery({
    queryKey: ['catalogue'],
    queryFn: () => get<{ at: string; products: CatalogueItem[] }>('/products/catalogue'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const index = useMemo(() => {
    const ms = new MiniSearch<CatalogueItem>({
      fields: ['name', 'code'],
      storeFields: ['id'],
      searchOptions: { prefix: true, fuzzy: (term) => (term.length > 3 ? 0.2 : false), boost: { code: 3 }, combineWith: 'AND' },
    });
    ms.addAll(q.data?.products ?? []);
    return ms;
  }, [q.data]);
  const byId = useMemo(() => new Map((q.data?.products ?? []).map((p) => [p.id, p])), [q.data]);
  const byCode = useMemo(() => {
    const m = new Map<string, CatalogueItem>();
    for (const p of q.data?.products ?? []) {
      m.set(p.code.toLowerCase(), p);
      if (p.barcode) m.set(p.barcode.toLowerCase(), p);
    }
    return m;
  }, [q.data]);

  /** Exact barcode or code first, then fuzzy name search. */
  const search = (text: string, limit = 12): CatalogueItem[] => {
    const t = text.trim();
    if (!t) return [];
    const exact = byCode.get(t.toLowerCase());
    const hits = index.search(t).slice(0, limit).map((h) => byId.get(h.id as number)!).filter(Boolean);
    return exact ? [exact, ...hits.filter((h) => h.id !== exact.id)].slice(0, limit) : hits;
  };

  return { ...q, products: q.data?.products ?? [], byId, byCode, search };
}

export function useKits() {
  return useQuery({ queryKey: ['kits'], queryFn: () => get<Kit[]>('/kits'), staleTime: 60_000 });
}
