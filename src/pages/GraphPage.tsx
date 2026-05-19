import {
  Atom,
  ExternalLink,
  Maximize2,
  Minimize2,
  Network as NetworkIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KnowledgeGraphPanel,
  NODE_TYPE_COLORS,
  colorForGroup,
  type KnowledgeGraphHandle,
} from "../components/KnowledgeGraphPanel";
import { useSnapshot } from "../context/SnapshotContext";
import type { GraphNode, GraphResponse } from "../types";

const TYPE_LABELS: Record<string, string> = {
  post: "案例",
  keyword: "關鍵字",
  channel: "管道",
  account: "帳戶",
  platform: "平台",
  money: "金流",
};

export function GraphPage() {
  const { prefetchGraph, getCachedGraph } = useSnapshot();
  const [limit, setLimit] = useState(80);
  // 開啟頁面瞬間若 SnapshotProvider 已預先抓好,直接用 cache 避免 loading
  const [graph, setGraph] = useState<GraphResponse | null>(() => getCachedGraph(80));
  const [loading, setLoading] = useState(() => getCachedGraph(80) === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [physicsOn, setPhysicsOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const graphRef = useRef<KnowledgeGraphHandle>(null);

  useEffect(() => {
    void load(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  async function load(n: number) {
    const cached = getCachedGraph(n);
    if (cached) {
      setGraph(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await prefetchGraph(n);
      setGraph(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "圖譜載入失敗");
    } finally {
      setLoading(false);
    }
  }

  const allTypes = useMemo(() => {
    const types = new Set<string>();
    for (const n of graph?.nodes ?? []) types.add(n.group);
    return [...types].sort();
  }, [graph]);

  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    const term = search.trim().toLowerCase();
    return graph.nodes.filter((n) => {
      const okType = activeTypes.size === 0 || activeTypes.has(n.group);
      const okSearch = !term || n.label.toLowerCase().includes(term);
      return okType && okSearch;
    });
  }, [graph, search, activeTypes]);

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function focusNode(node: GraphNode) {
    setSelected(node);
    graphRef.current?.focusNode(node.id);
  }

  const containerClasses = fullscreen
    ? "fixed inset-0 z-50 bg-[#0f1b2e] p-6 overflow-y-auto"
    : "space-y-6";

  return (
    <div className={containerClasses}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">Knowledge Graph</p>
          <h1 className="mt-2 text-3xl font-bold">詐騙腳本知識圖譜</h1>
          <p className="mt-1 text-sm text-slate-300/80">
            來源:<span className="font-semibold text-cyan-200">{graph?.provider === "neo4j" ? "Neo4j 即時查詢" : "記憶體 fallback"}</span>
            {" · "}
            {graph?.stats.totalNodes ?? 0} 節點 / {graph?.stats.totalEdges ?? 0} 邊
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load(limit)}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
            title="重新載入"
          >
            <RefreshCw className="h-4 w-4" />
            重新載入
          </button>
          <button
            type="button"
            onClick={() => graphRef.current?.fit()}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
            title="自動縮放"
          >
            <Target className="h-4 w-4" />
            置中
          </button>
          <button
            type="button"
            onClick={() => {
              setPhysicsOn((p) => {
                const next = !p;
                graphRef.current?.togglePhysics(next);
                return next;
              });
            }}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${
              physicsOn
                ? "border-cyan-300/35 bg-cyan-400/15 text-cyan-100"
                : "border-white/10 bg-white/5 text-slate-200"
            }`}
            title="物理引擎"
          >
            <Atom className="h-4 w-4" />
            {physicsOn ? "物理 On" : "物理 Off"}
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {fullscreen ? "離開全螢幕" : "全螢幕"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.55fr_0.45fr]">
        <div className="space-y-3 rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(46,60,84,0.94)_0%,rgba(26,37,57,0.97)_100%)] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋節點(標題、關鍵字、實體名稱)"
                className="w-full rounded-full border border-white/10 bg-slate-950/40 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300/85">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              節點上限
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="rounded-full border border-white/10 bg-slate-950/50 px-3 py-1 text-xs text-slate-100 focus:border-cyan-300/40 focus:outline-none"
              >
                {[20, 40, 80, 120, 200].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.14em] text-slate-400">類型</span>
            {allTypes.map((type) => {
              const active = activeTypes.size === 0 || activeTypes.has(type);
              const palette = colorForGroup(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                    active ? "border-white/20 bg-white/8 text-white" : "border-white/8 bg-white/3 text-slate-500"
                  }`}
                  title={`點擊切換顯示「${TYPE_LABELS[type] ?? type}」`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.bg }} />
                  {TYPE_LABELS[type] ?? type}
                  <span className="text-[10px] opacity-70">({graph?.stats.typeBreakdown[type] ?? 0})</span>
                </button>
              );
            })}
            {activeTypes.size > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTypes(new Set())}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10"
              >
                顯示全部
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="flex h-[560px] items-center justify-center text-sm text-slate-300">圖譜載入中...</div>
          ) : (
            <KnowledgeGraphPanel
              ref={graphRef}
              nodes={graph?.nodes ?? []}
              edges={graph?.edges ?? []}
              height={fullscreen ? "calc(100vh - 320px)" : "560px"}
              onNodeClick={setSelected}
              highlightedTypes={activeTypes.size === 0 ? undefined : activeTypes}
              searchTerm={search}
            />
          )}

          <Legend />
        </div>

        <aside className="space-y-3 rounded-3xl border border-white/10 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
            <NetworkIcon className="h-4 w-4" />
            節點詳情
          </div>

          {selected ? (
            <NodeDetails node={selected} graph={graph} onJump={focusNode} />
          ) : (
            <p className="text-xs leading-6 text-slate-400/85">
              點擊圖中任何節點查看詳細資訊。
              <br />
              懸停會自動高亮鄰居關係。
            </p>
          )}

          <div className="border-t border-white/8 pt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/85">
              可見節點({visibleNodes.length})
            </p>
            <div className="mt-2 max-h-[300px] space-y-1 overflow-y-auto pr-1">
              {visibleNodes.map((n) => {
                const palette = colorForGroup(n.group);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => focusNode(n)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition hover:bg-white/8 ${
                      selected?.id === n.id ? "bg-cyan-400/15 ring-1 ring-cyan-300/40" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: palette.bg }}
                      />
                      <span className="truncate text-slate-200">{n.label}</span>
                    </span>
                    <span className="flex-shrink-0 rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] text-slate-300">
                      w{n.weight}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/8 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-300/85">
      <span className="text-slate-400">圖例:</span>
      {Object.entries(NODE_TYPE_COLORS)
        .filter(([k]) => k !== "default")
        .map(([key, color]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color.bg }} />
            <span>{TYPE_LABELS[key] ?? key}</span>
          </span>
        ))}
      <span className="ml-auto text-slate-400">點擊節點 · 懸停高亮鄰居 · 滾輪縮放</span>
    </div>
  );
}

function NodeDetails({
  node,
  graph,
  onJump,
}: {
  node: GraphNode;
  graph: GraphResponse | null;
  onJump: (next: GraphNode) => void;
}) {
  const palette = colorForGroup(node.group);
  const neighbors = useMemo(() => {
    if (!graph) return [];
    const ids = new Set<string>();
    for (const e of graph.edges) {
      if (e.from === node.id) ids.add(e.to);
      if (e.to === node.id) ids.add(e.from);
    }
    return graph.nodes.filter((n) => ids.has(n.id));
  }, [graph, node]);

  const isPost = node.id.startsWith("post:");

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
        <div className="flex items-start gap-2">
          <span className="mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: palette.bg }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white break-words">{node.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {TYPE_LABELS[node.group] ?? node.group} · weight {node.weight}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 break-all">{node.id}</p>
          </div>
        </div>
        {isPost ? (
          <p className="mt-2 text-xs leading-6 text-slate-300/85">
            這是一個案例節點,鄰居節點代表此案例中出現的關鍵字、管道、帳戶或平台。
          </p>
        ) : (
          <p className="mt-2 text-xs leading-6 text-slate-300/85">
            這是一個實體節點,被多個案例提及代表它在詐騙腳本中重複出現。
          </p>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/85">
          鄰居 ({neighbors.length})
        </p>
        <div className="space-y-1">
          {neighbors.map((n) => {
            const c = colorForGroup(n.group);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onJump(n)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-left text-xs hover:bg-white/10"
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.bg }} />
                  <span className="truncate">{n.label}</span>
                </span>
                <ExternalLink className="h-3 w-3 flex-shrink-0 text-slate-400" />
              </button>
            );
          })}
          {neighbors.length === 0 ? (
            <p className="text-[11px] text-slate-500">沒有相連節點。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
