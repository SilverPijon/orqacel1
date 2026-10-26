import { useCallback, useEffect, useRef, useState } from "react";

// Loads one page of a list from a server function and appends the next page on demand.
export function usePagedList(fetcher, params = {}, pageSize = 20) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const key = JSON.stringify(params);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(
    async (nextCursor, append) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const parsed = JSON.parse(key);
        const result = await fetcherRef.current({
          data: { ...parsed, limit: pageSize, ...(nextCursor ? { cursor: nextCursor } : {}) },
        });
        const page = result?.items || [];
        setItems((previous) => (append ? [...previous, ...page] : page));
        setCursor(result?.nextCursor || null);
        setError(null);
      } catch (fetchError) {
        setError(fetchError);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [key, pageSize],
  );

  useEffect(() => {
    load(null, false);
  }, [load]);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: Boolean(cursor),
    loadMore: () => (cursor ? load(cursor, true) : Promise.resolve()),
    reload: () => load(null, false),
  };
}