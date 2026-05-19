import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchGraph, fetchSnapshot, postCrawl } from "../api/client";
import type { GraphResponse, SourceSnapshot } from "../types";

type GraphCacheEntry = { data: GraphResponse; fetchedAt: number };

type SnapshotContextValue = {
  snapshot: SourceSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  triggerCrawl: () => Promise<void>;
  prefetchGraph: (limit?: number) => Promise<GraphResponse>;
  getCachedGraph: (limit: number) => GraphResponse | null;
};

const SnapshotContext = createContext<SnapshotContextValue | null>(null);

const GRAPH_CACHE_TTL_MS = 60 * 1000;
const graphCache = new Map<number, GraphCacheEntry>();
const inflight = new Map<number, Promise<GraphResponse>>();

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prefetchGraph = useCallback(async (limit = 80): Promise<GraphResponse> => {
    const cached = graphCache.get(limit);
    if (cached && Date.now() - cached.fetchedAt < GRAPH_CACHE_TTL_MS) {
      return cached.data;
    }
    const existing = inflight.get(limit);
    if (existing) return existing;

    const promise = fetchGraph(limit)
      .then((data) => {
        graphCache.set(limit, { data, fetchedAt: Date.now() });
        return data;
      })
      .finally(() => inflight.delete(limit));

    inflight.set(limit, promise);
    return promise;
  }, []);

  const getCachedGraph = useCallback((limit: number): GraphResponse | null => {
    const entry = graphCache.get(limit);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > GRAPH_CACHE_TTL_MS) return null;
    return entry.data;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSnapshot();
      setSnapshot(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerCrawl = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await postCrawl();
      setSnapshot(data);
      graphCache.clear();
      void prefetchGraph(80);
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失敗");
    } finally {
      setRefreshing(false);
    }
  }, [prefetchGraph]);

  useEffect(() => {
    void reload();
    // 在背景靜悄悄拉一份 graph,使用者切到 /graph 時就直接顯示
    void prefetchGraph(80).catch(() => {
      /* swallow; GraphPage 會自己 retry */
    });
  }, [reload, prefetchGraph]);

  const value = useMemo(
    () => ({
      snapshot,
      loading,
      refreshing,
      error,
      reload,
      triggerCrawl,
      prefetchGraph,
      getCachedGraph,
    }),
    [snapshot, loading, refreshing, error, reload, triggerCrawl, prefetchGraph, getCachedGraph],
  );

  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

export function useSnapshot() {
  const ctx = useContext(SnapshotContext);
  if (!ctx) throw new Error("useSnapshot must be used inside SnapshotProvider");
  return ctx;
}
